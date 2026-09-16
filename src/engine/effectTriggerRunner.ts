/**
 * Диспетчер срабатываний эффекта: один исполнитель вместо отдельного на каждое
 * поле.
 *
 * На границе хода (`processTurnEffects`) и при входе или выходе из зоны и ауры
 * (`applyEntryEffect`) эффекты читаются как срабатывания
 * (`collectEffectTriggers`), и действия выполняются одними функциями: спасбросок,
 * урон и лечение по гейтам, снятие эффекта, длящаяся копия. Порядок и итоги те
 * же, что у прежних интерпретаторов полей, — их фиксируют
 * `tests/effectTriggerBaseline.test.mjs` и `tests/effectSaves.test.mjs`.
 */

import type { EffectDuration } from '@vtt/shared';

import type { ActiveEffect, EffectSaveTiming } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type {
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerApplyTagAction,
  EffectTriggerAttackRole,
  EffectTriggerEvent,
  EffectTriggerSave,
} from './effectTriggerTypes.js';
import type { SaveDamageDefense } from './saveDamage.js';
import type { TriggerEventData } from './triggerConditions.js';
import type {
  EffectSaveSpec,
  EntryEffectOptions,
  EntryEffectResult,
  TurnDamageOutcome,
  TurnEffectsOptions,
  TurnEffectsResult,
  TurnHealingOutcome,
  TurnSaveOutcome,
} from './turnEffects.js';

import { generateId } from '@vtt/shared';

import {
  ACTIVE_EFFECT_ID_PREFIX,
  isEffectDormant,
  listLiveEffects,
  removeOrSwitchOffEffects,
} from './activeEffectTypes.js';
import { buildConditionActiveEffect } from './conditionTemplates.js';
import { findFirstDiceTerm, rollDamageFormula } from './diceFormula.js';
import {
  hasLastingEffectPayload,
  isImmuneToCondition,
  mergeAppliedEffects,
} from './effectAutomation.js';
import {
  getEntityConditionImmunities,
  listTraitEffects,
  resolveActorStats,
} from './effectPipeline.js';
import {
  isClientAttackRollTrigger,
  isLegacyTrigger,
  listEffectEventTriggers,
  listEffectListTriggers,
  readEffectLandingTrigger,
  resolveGateScale,
  resolveTriggerActionGate,
  turnTriggerEventOf,
} from './effectTriggers.js';
import {
  DEFAULT_TRIGGER_ATTACK_ROLE,
  DEFAULT_TRIGGER_REST_TYPE,
  MAX_HP_REDUCTION_NEVER_ENDS,
  PRESENCE_TRIGGER_EVENTS,
} from './effectTriggerTypes.js';
import {
  buildTriggerUsageScope,
  takeTriggerUse,
} from './effectTriggerUsage.js';
import {
  buildFormulaContext,
  evaluateFormula,
  substituteFormulaVariables,
} from './formulaParser.js';
import {
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
  writeEntityHitPoints,
} from './hitPoints.js';
import { countEffectTag, isTriggerConditionMet } from './triggerConditions.js';
import {
  applyDamageToEntity,
  applyTurnHealing,
  buildApplySaveSpec,
  buildEffectSavingThrowContext,
  resolveEffectMagicCircumstances,
  rollEffectDamage,
  rollEffectHealing,
  rollEffectSaveOutcome,
  rollEffectSaveWithContext,
  stampAppliedEffect,
  withInitializedDuration,
} from './turnEffects.js';

/** Срабатывание на субъекте вместе с эффектом, откуда оно пришло */
export interface EffectTriggerSource {
  effect: ActiveEffect;
  trigger: EffectTrigger;
  /** Аура чужого токена: самого эффекта на субъекте нет */
  ambient: boolean;
  /**
   * Эффект лежит на субъекте (`activeEffects`) — его можно снять. У черты
   * существа, ауры и эффекта зоны при входе экземпляра нет.
   */
  instance: boolean;
  /** Источник эффекта для счётчика лимита */
  scope: string;
}

/**
 * Срабатывание хода, чей спасбросок спросят у игрока. Этап: урон ждёт ответа
 * (`damage`) либо снятие и наложение (`effects`).
 */
export interface DeferredTurnTrigger extends EffectTriggerSource {
  stage: 'damage' | 'effects';
}

/**
 * Пропускает ли событие срабатывание: условие выполняется, и лимит не
 * исчерпан. Условие проверяется первым — невыполненное условие не тратит
 * «раз в ход».
 *
 * @param entity - субъект срабатывания
 * @param source - срабатывание с источником
 * @param eventData - данные события для условия
 * @param inCombat - идёт ли у субъекта бой (лимит хода и раунда)
 * @returns `true`, если срабатывание выполняется
 */
export function admitTrigger(
  entity: DnDSceneEntity,
  source: EffectTriggerSource,
  eventData: TriggerEventData = {},
  inCombat?: boolean,
): boolean {
  return (
    isTriggerConditionMet(entity, source.trigger, {
      ...eventData,
      sourceId: source.effect.sourceActorId,
    }) && takeTriggerUse(entity, source.scope, source.trigger, inCombat)
  );
}

/**
 * Есть ли у срабатывания что-то кроме урона: снятие или наложение.
 *
 * @param trigger - срабатывание
 * @returns `true`, если есть действие не урона
 */
export function triggerHasEffects(trigger: EffectTrigger): boolean {
  return trigger.actions.some((action) => action.type !== 'damage');
}

/** Событие, чьи данные читает Сл срабатывания формулой */
export interface TriggerSaveEvent {
  /** Кто бросает: формула читает и его лист */
  entity: DnDSceneEntity;
  /** Данные события */
  eventData: TriggerEventData;
}

/**
 * Сл спасброска срабатывания: формулой от урона события, если она есть и
 * событие несёт урон, иначе число.
 *
 * @param save - спасбросок срабатывания
 * @param event - кто бросает и данные события
 * @returns сложность
 */
export function resolveTriggerSaveDc(
  save: EffectTriggerSave,
  event?: TriggerSaveEvent,
): number {
  const damage = event?.eventData.damage;

  if (!save.dcFormula || !event || !damage) {
    return save.dc;
  }

  try {
    const value = evaluateFormula(save.dcFormula, {
      ...buildFormulaContext(event.entity),
      event: { damage: damage.amount },
    });

    return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : save.dc;
  } catch {
    // Автор ошибся в формуле — спасбросок всё равно бросается, против числа
    return save.dc;
  }
}

/**
 * Что бросать для спасброска срабатывания. Спасбросок, от которого зависит
 * только урон, — не против состояния: состояние им не накладывается и не
 * снимается.
 *
 * @param effect - эффект
 * @param trigger - его срабатывание
 * @param event - кто бросает и данные события (Сл формулой)
 * @returns спецификация либо `null`, если спасброска нет
 */
export function buildTriggerSaveSpec(
  effect: ActiveEffect,
  trigger: EffectTrigger,
  event?: TriggerSaveEvent,
): EffectSaveSpec | null {
  if (!trigger.save) {
    return null;
  }

  // Спасбросок концентрации — не против магии: «Мантия сопротивления
  // заклинаниям» его не облегчает, «Боевой заклинатель» — да
  const base = {
    effectName: effect.name,
    ability: trigger.save.ability,
    dc: resolveTriggerSaveDc(trigger.save, event),
    ...(trigger.save.mode ? { mode: trigger.save.mode } : {}),
    ...(effect.concentration
      ? { againstMagic: false, againstConcentration: true }
      : resolveEffectMagicCircumstances(effect)),
  };

  return triggerHasEffects(trigger)
    ? { ...base, againstCondition: effect.conditionKey }
    : base;
}

/**
 * Исход спасброска срабатывания для применения и чата. У спасброска против
 * урона в исходе записано, что даёт успех.
 *
 * @param trigger - срабатывание
 * @param save - брошенный спасбросок
 * @returns исход
 */
export function toTriggerSaveOutcome(
  trigger: EffectTrigger,
  save: TurnSaveOutcome,
): TurnSaveOutcome {
  if (!trigger.save || triggerHasEffects(trigger)) {
    return save;
  }

  const halfOnSave = trigger.actions.some(
    (action) => action.type === 'damage' && action.halfOnSave === true,
  );

  return { ...save, damageOnSuccess: halfOnSave ? 'half' : 'negate' };
}

/**
 * Доля действия при исходе спасброска: 0 — не выполняется, 0.5 — половина урона,
 * 1 — полностью.
 *
 * @param trigger - срабатывание
 * @param action - действие
 * @param passed - пройден ли спасбросок (без спасброска — нет)
 * @param defense - защиты бросившего («Увёртливость»)
 * @returns доля
 */
export function resolveTriggerActionScale(
  trigger: EffectTrigger,
  action: EffectTriggerAction,
  passed: boolean,
  defense?: SaveDamageDefense,
): number {
  return resolveGateScale(
    resolveTriggerActionGate(trigger, action),
    passed,
    action.type === 'damage' && action.halfOnSave === true,
    defense,
  );
}

/**
 * Катает урон срабатывания по исходу спасброска; урон не применяется —
 * вызывающий списывает хиты одним изменением.
 *
 * @param entity - субъект
 * @param effect - эффект
 * @param trigger - срабатывание
 * @param passed - пройден ли спасбросок
 * @param stats - resolved-статы субъекта (защиты от урона)
 * @returns исход урона либо `null`
 */
export function rollTriggerDamage(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  trigger: EffectTrigger,
  passed: boolean,
  stats: ReturnType<typeof resolveActorStats>,
): TurnDamageOutcome | null {
  let outcome: TurnDamageOutcome | null = null;

  const defense = trigger.save
    ? {
        flags: stats.activeFlags,
        ability: trigger.save.ability,
        againstMagic: resolveEffectMagicCircumstances(effect).againstMagic,
      }
    : undefined;

  for (const action of trigger.actions) {
    if (action.type !== 'damage') {
      continue;
    }

    const scale = resolveTriggerActionScale(trigger, action, passed, defense);

    if (scale <= 0) {
      continue;
    }

    const rolled = rollEffectDamage(effect.name, action.parts, stats, entity, {
      scale,
    });

    if (!rolled) {
      continue;
    }

    outcome = outcome
      ? {
          effectName: outcome.effectName,
          total: outcome.total + rolled.total,
          types: [...new Set([...outcome.types, ...rolled.types])],
          values: [...outcome.values, ...rolled.values],
        }
      : rolled;
  }

  return outcome;
}

/**
 * Катает лечение срабатывания: лечащие части урона не зависят от спасброска
 * («Регенерация» лечит и без броска).
 *
 * @param effect - эффект
 * @param trigger - срабатывание
 * @returns исход лечения либо `null`
 */
export function rollTriggerHealing(
  effect: ActiveEffect,
  trigger: EffectTrigger,
): TurnHealingOutcome | null {
  const parts = trigger.actions.flatMap((action) =>
    action.type === 'damage' ? action.parts : [],
  );

  return parts.length > 0 ? rollEffectHealing(effect.name, parts) : null;
}

/**
 * Действия срабатывания, которые источник может выполнить: снять эффект можно,
 * только если он лежит на субъекте.
 *
 * @param source - срабатывание с источником
 * @returns действия
 */
function listSourceActions(source: EffectTriggerSource): EffectTriggerAction[] {
  return source.trigger.actions.filter(
    (action) =>
      (action.type !== 'removeSelf' && action.type !== 'endCast')
      || source.instance,
  );
}

/**
 * Есть ли у источника урон или лечение.
 *
 * @param source - срабатывание с источником
 * @returns `true`, если есть действие урона
 */
function sourceHasDamage(source: EffectTriggerSource): boolean {
  return listSourceActions(source).some((action) => action.type === 'damage');
}

/**
 * Есть ли у источника выполнимые действия кроме урона.
 *
 * @param source - срабатывание с источником
 * @returns `true`, если есть снятие или наложение
 */
function sourceHasEffects(source: EffectTriggerSource): boolean {
  return listSourceActions(source).some((action) => action.type !== 'damage');
}

/**
 * Источник эффекта для счётчика лимита: копия эффекта зоны считается по зоне —
 * тогда вход в зону и начало хода в ней делят один лимит.
 *
 * @param effect - эффект на субъекте
 * @returns источник
 */
export function resolveEffectUsageScope(effect: ActiveEffect): string {
  return effect.origin === 'area' && effect.originId
    ? buildTriggerUsageScope('area', effect.originId)
    : effect.id;
}

/** Откуда у субъекта эффект со срабатываниями */
export interface EffectTriggerSourceKind {
  /** Аура чужого токена */
  ambient: boolean;
  /** Эффект лежит на субъекте — его можно снять */
  instance: boolean;
  /**
   * Источник для счётчика лимита.
   *
   * @param effect - эффект
   * @returns источник
   */
  scopeOf: (effect: ActiveEffect) => string;
}

/** Виды источников срабатываний у субъекта */
export const EFFECT_TRIGGER_SOURCE_KINDS = {
  /** Эффект на самом субъекте */
  instance: {
    ambient: false,
    instance: true,
    scopeOf: resolveEffectUsageScope,
  },
  /** Черта существа */
  trait: {
    ambient: false,
    instance: false,
    scopeOf: (effect) => buildTriggerUsageScope('trait', effect.id),
  },
  /** Работающий предмет */
  item: {
    ambient: false,
    instance: false,
    scopeOf: (effect) => buildTriggerUsageScope('item', effect.id),
  },
  /** Аура чужого токена «пока внутри» */
  aura: {
    ambient: true,
    instance: false,
    scopeOf: (effect) => buildTriggerUsageScope('aura', effect.id),
  },
} satisfies Record<string, EffectTriggerSourceKind>;

/**
 * Срабатывания эффектов одного вида источника.
 *
 * @param effects - эффекты
 * @param kind - откуда эффекты у субъекта
 * @param triggersOf - какие срабатывания эффекта нужны
 * @returns срабатывания с источником
 */
export function buildTriggerSources(
  effects: readonly ActiveEffect[],
  kind: EffectTriggerSourceKind,
  triggersOf: (effect: ActiveEffect) => readonly EffectTrigger[],
): EffectTriggerSource[] {
  return effects.flatMap((effect) =>
    triggersOf(effect).map((trigger) => ({
      effect,
      trigger,
      ambient: kind.ambient,
      instance: kind.instance,
      scope: kind.scopeOf(effect),
    })),
  );
}

/**
 * Снимает с сущности эффекты по id одной записью.
 *
 * @param entity - сущность (мутируется)
 * @param effectIds - id снимаемых эффектов
 */
export function removeEffectsById(
  entity: DnDSceneEntity,
  effectIds: ReadonlySet<string>,
): void {
  if (effectIds.size === 0) {
    return;
  }

  entity.activeEffects = removeOrSwitchOffEffects(
    entity.activeEffects ?? [],
    (effect) => effectIds.has(effect.id),
  );
}

/**
 * Срабатывания, переносимые на копию эффекта: срабатывание, которое накладывает
 * саму копию или реагирует на вход, выход и наложение, принадлежит источнику —
 * на копии оно повторяло бы наложение на каждом ходу.
 *
 * @param effect - исходный эффект
 * @returns срабатывания копии либо `undefined`
 */
function listCopiedTriggers(effect: ActiveEffect): EffectTrigger[] | undefined {
  const kept = (effect.triggers ?? []).filter(
    (trigger) =>
      !PRESENCE_TRIGGER_EVENTS.includes(trigger.event)
      && trigger.event !== 'applied'
      && !trigger.actions.some((action) => action.type === 'applySelf'),
  );

  return kept.length > 0 ? kept : undefined;
}

/**
 * Длящаяся копия эффекта на субъекте: своя длительность, без разовой нагрузки и
 * без ауры источника.
 *
 * @param effect - эффект, чью нагрузку накладывают
 * @param sourceAreaId - зона заклинания, из которой пришёл эффект
 * @returns копия
 */
function buildEffectStatusCopy(
  effect: ActiveEffect,
  sourceAreaId: string | undefined,
): ActiveEffect {
  return withInitializedDuration({
    ...effect,
    id: generateId(ACTIVE_EFFECT_ID_PREFIX),
    origin: 'condition',
    originId: undefined,
    areaTrigger: undefined,
    transfer: false,
    // Своя длительность: копия не должна делить счётчик с эффектом зоны
    duration: { ...effect.duration },
    // Разовая нагрузка уже отыграна — на длящейся копии её не оставляем
    damageParts: undefined,
    // Концентрацию держит заклинатель, а не копия на субъекте
    concentration: undefined,
    applySave: undefined,
    // Аура остаётся у источника: без сброса цель сама начала бы её излучать
    // (у копии нет `areaTrigger`, и она стала бы постоянной аурой)
    aura: undefined,
    effectTarget: undefined,
    triggers: listCopiedTriggers(effect),
    // Статус от зоны заклинания кончается вместе с заклинанием — с зоной
    endsWithAreaId: effect.magical && sourceAreaId ? sourceAreaId : undefined,
  });
}

/** Срок отметки по умолчанию: до начала следующего хода носителя */
const DEFAULT_TAG_DURATION: EffectDuration = {
  type: 'turn',
  turnAnchor: 'carrier',
  turnTiming: 'start',
};

/**
 * Отметка на субъекте: эффект без нагрузки с ключом, который читают условия.
 *
 * @param action - действие «Отметка»
 * @returns эффект отметки
 */
function buildTagEffect(action: EffectTriggerApplyTagAction): ActiveEffect {
  return withInitializedDuration({
    id: generateId(ACTIVE_EFFECT_ID_PREFIX),
    name: action.label ?? action.tag,
    description: '',
    disabled: false,
    origin: 'condition',
    transfer: false,
    duration: action.duration ?? DEFAULT_TAG_DURATION,
    changes: [],
    flags: [],
    tag: action.tag,
  });
}

/**
 * Привязка наложенного к касту и зоне источника: состояние или отметка от
 * эффекта заклинания уходят вместе с его кастом и зоной, как и копия эффекта.
 *
 * @param status - наложенное срабатыванием
 * @param effect - эффект, чьё срабатывание наложило
 * @param options - зона заклинания, из которой пришёл эффект, и отвязка от каста
 * @returns наложенное с привязкой
 */
function bindStatusToSource(
  status: ActiveEffect,
  effect: ActiveEffect,
  options: EntryEffectOptions,
): ActiveEffect {
  const { sourceAreaId } = options;

  return {
    ...status,
    ...(effect.castId && !options.detachFromCast
      ? { castId: effect.castId }
      : {}),
    ...(effect.magical ? { magical: effect.magical } : {}),
    ...(effect.magical && sourceAreaId ? { endsWithAreaId: sourceAreaId } : {}),
  };
}

/** Действие срабатывания, которое кладёт на субъекта длящийся эффект */
type StatusTriggerAction = Extract<
  EffectTriggerAction,
  { type: 'applySelf' | 'applyTag' | 'applyCondition' | 'reduceMaxHp' }
>;

/** Ключ метки «Максимум хитов уменьшен»: уменьшения складываются в неё */
export const MAX_HP_REDUCTION_TAG = 'maxHpReduction';

/** Имя метки уменьшения максимума хитов в списке эффектов */
const MAX_HP_REDUCTION_LABEL = 'Максимум хитов уменьшен';

/** Приоритет строки уменьшения максимума: после прибавок эффектов */
const MAX_HP_REDUCTION_PRIORITY = 50;

/**
 * На сколько уменьшается максимум: число, кости, формула с `@damage` или всё
 * вместе («1к6 + @damage»). Кости бросаются после подстановки токенов — разбор
 * формул костей не знает; формула без костей считается целиком, с функциями.
 *
 * @param entity - получатель
 * @param amount - строка действия
 * @param eventDamage - урон события
 * @returns неотрицательное число
 */
function resolveMaxHpReduction(
  entity: DnDSceneEntity,
  amount: string,
  eventDamage: number | undefined,
): number {
  const formulaContext = {
    ...buildFormulaContext(entity),
    event: { damage: eventDamage ?? 0 },
  };

  let value = 0;

  try {
    const substituted = substituteFormulaVariables(amount, formulaContext);

    value = findFirstDiceTerm(substituted)
      ? rollDamageFormula(substituted).total
      : evaluateFormula(amount, formulaContext);
  } catch {
    // Автор ошибся в формуле — максимум не трогаем
    value = 0;
  }

  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Метка уменьшения максимума хитов: прежнее уменьшение плюс новое.
 *
 * @param entity - получатель
 * @param action - действие
 * @param eventDamage - урон события
 * @returns метка либо `null`, если уменьшать нечего
 */
function buildMaxHpReduction(
  entity: DnDSceneEntity,
  action: Extract<EffectTriggerAction, { type: 'reduceMaxHp' }>,
  eventDamage: number | undefined,
): ActiveEffect | null {
  const reduction = resolveMaxHpReduction(entity, action.amount, eventDamage);

  if (reduction <= 0) {
    return null;
  }

  const previous = (entity.activeEffects ?? [])
    .filter((effect) => effect.tag === MAX_HP_REDUCTION_TAG)
    .flatMap((effect) => effect.changes)
    .reduce((total, change) => total - Number(change.value), 0);

  const endsOnRest = action.endsOnRest ?? DEFAULT_TRIGGER_REST_TYPE;

  return {
    ...buildTagEffect({
      type: 'applyTag',
      tag: MAX_HP_REDUCTION_TAG,
      label: MAX_HP_REDUCTION_LABEL,
      duration: { type: 'permanent' },
    }),
    changes: [
      {
        key: 'hitPoints.max',
        mode: 'add',
        value: String(-(previous + reduction)),
        priority: MAX_HP_REDUCTION_PRIORITY,
      },
    ],
    ...(endsOnRest === MAX_HP_REDUCTION_NEVER_ENDS
      ? {}
      : {
          triggers: [
            {
              id: 'trigger_restore_max_hp',
              event: 'rest',
              ...(endsOnRest === DEFAULT_TRIGGER_REST_TYPE
                ? {}
                : { restType: endsOnRest }),
              actions: [{ type: 'removeSelf' }],
            },
          ],
        }),
  };
}

/**
 * Отметка действия: у счётчика — на ступень больше прежней.
 *
 * @param entity - получатель
 * @param action - действие «Отметка»
 * @returns отметка
 */
function buildActionTag(
  entity: DnDSceneEntity,
  action: EffectTriggerApplyTagAction,
): ActiveEffect {
  const tag = buildTagEffect(action);

  if (!action.stack) {
    return tag;
  }

  return { ...tag, tagStacks: countEffectTag(entity, action.tag) + 1 };
}

/**
 * Что кладёт на субъекта действие наложения: копию эффекта, отметку или
 * состояние.
 *
 * @param entity - получатель
 * @param action - действие наложения
 * @param effect - эффект, чьё срабатывание выполняется
 * @param options - откуда пришли наложения
 * @returns длящийся эффект либо `null`, если класть нечего
 */
function buildActionStatus(
  entity: DnDSceneEntity,
  action: StatusTriggerAction,
  effect: ActiveEffect,
  options: EntryEffectOptions,
): ActiveEffect | null {
  if (action.type === 'applySelf') {
    const copy = buildEffectStatusCopy(effect, options.sourceAreaId);

    // Копия без срабатываний входа и выхода может остаться пустой
    return hasLastingEffectPayload(copy) ? copy : null;
  }

  if (action.type === 'applyTag') {
    return bindStatusToSource(buildActionTag(entity, action), effect, options);
  }

  if (action.type === 'reduceMaxHp') {
    return buildMaxHpReduction(entity, action, options.eventDamage);
  }

  const condition = buildConditionActiveEffect(action.conditionKey, {
    duration: action.duration,
  });

  if (!condition) {
    return null;
  }

  return bindStatusToSource(
    withInitializedDuration(
      action.recurringSave
        ? { ...condition, recurringSave: action.recurringSave }
        : condition,
    ),
    effect,
    options,
  );
}

/**
 * Выполняет действия срабатывания, кроме урона: накладывает копию эффекта,
 * состояние (с проверкой иммунитета) или отметку и сообщает, снимается ли сам
 * эффект.
 * Снятие вызывающий делает сам — на границе хода оно идёт одной записью.
 *
 * Наложенное помнит наложившего исходный эффект: «до конца хода источника» и
 * ход наложившего у копии считаются от него, а не от носителя.
 *
 * @param entity - субъект
 * @param source - срабатывание с источником
 * @param passed - пройден ли спасбросок
 * @param options - откуда пришли наложения и чей сейчас ход
 * @returns снимается ли эффект и было ли наложение
 */
export function applyTriggerEffectActions(
  entity: DnDSceneEntity,
  source: EffectTriggerSource,
  passed: boolean,
  options: EntryEffectOptions = {},
): { removes: boolean; applied: boolean } {
  let removes = false;
  let applied = false;

  for (const action of listSourceActions(source)) {
    if (
      action.type === 'damage'
      || resolveTriggerActionScale(source.trigger, action, passed) <= 0
    ) {
      continue;
    }

    if (action.type === 'removeSelf') {
      removes = true;

      continue;
    }

    // Каст заканчивает ядро по всем существам; сам эффект снимается здесь же
    if (action.type === 'endCast') {
      removes = true;
      options.endCast?.(source.effect);

      continue;
    }

    if (action.type === 'setHp') {
      writeEntityHitPoints(entity, {
        current: Math.min(action.value, resolveEntityMaxHp(entity)),
        temp: resolveEntityTempHp(entity),
      });

      applied = true;

      continue;
    }

    const status = buildActionStatus(entity, action, source.effect, options);

    // Иммунитет к состоянию — как при наложении атакой: срабатывание — такой
    // же путь наложения, и обходить статблок оно не должно
    const blocked =
      status?.conditionKey !== undefined
      && isImmuneToCondition(
        getEntityConditionImmunities(entity, options.ambientEffects ?? []),
        status.conditionKey,
      );

    if (!status || blocked) {
      continue;
    }

    // Правило PHB 2024 «Combining Game Effects»: одноимённый статус не
    // стакается — повторное наложение обновляет его, а не плодит копии
    entity.activeEffects = mergeAppliedEffects(entity.activeEffects ?? [], [
      stampAppliedEffect(status, {
        carrierId: entity.id,
        sourceId: source.effect.sourceActorId,
        activeTurnActorId: options.activeTurnActorId,
      }),
    ]);

    // Хиты не выше уменьшенного максимума
    if (action.type === 'reduceMaxHp') {
      writeEntityHitPoints(entity, {
        current: Math.min(
          resolveEntityCurrentHp(entity),
          resolveEntityMaxHp(entity),
        ),
        temp: resolveEntityTempHp(entity),
      });
    }

    applied = true;
  }

  return { removes, applied };
}

/**
 * Срабатывания эффекта на событие хода: на ходу носителя — его собственные, на
 * ходу наложившего (`options.sourceTurnActorId`) — «ход наложившего» эффектов,
 * наложенных этим участником.
 *
 * «Ход наложившего», чей наложивший неизвестен или не в бою, идёт на ходу
 * носителя: его ход не наступит, и срабатывание молчало бы всегда.
 *
 * @param effect - эффект
 * @param event - начало или конец хода
 * @param options - чей ход и участие наложившего в бою
 * @returns срабатывания
 */
function listTurnTriggers(
  effect: ActiveEffect,
  event: EffectTriggerEvent,
  options: Pick<TurnEffectsOptions, 'sourceTurnActorId' | 'isSourceInCombat'>,
): EffectTrigger[] {
  const sourceId = effect.sourceActorId;
  const { sourceTurnActorId } = options;

  const triggers = listEffectListTriggers(effect).filter(
    (trigger) => trigger.event === event,
  );

  if (sourceTurnActorId !== undefined) {
    return sourceId === sourceTurnActorId
      ? triggers.filter((trigger) => trigger.turnOf === 'source')
      : [];
  }

  const sourceTurnComes =
    sourceId !== undefined && (options.isSourceInCombat?.(sourceId) ?? false);

  return triggers.filter(
    (trigger) => trigger.turnOf !== 'source' || !sourceTurnComes,
  );
}

/**
 * Прогоняет срабатывания сущности на границе хода (начало/конец): сперва урон и
 * лечение (со спасброском против урона, если он задан), затем снятие и
 * наложение (повторный спасбросок снимает эффект, «Зловоние» накладывает
 * «Отравленный»).
 *
 * Источники: эффекты на самой сущности, черты существа и ауры чужих токенов
 * «пока внутри». На ходу наложившего (`options.sourceTurnActorId`) — только
 * срабатывания «ход наложившего» его эффектов и аур. Условие и лимит «не чаще
 * N раз» проверяются перед срабатыванием.
 * Спасбросок, который надо спросить у игрока, не бросается: срабатывание уходит
 * в отложенные (`deferredTriggers` и прежние списки эффектов).
 *
 * Мутирует `entity.activeEffects`, `entity.system.hitPoints` и счётчики лимитов.
 *
 * @param entity - сущность, чей момент хода обрабатывается
 * @param timing - момент: начало или конец хода
 * @param options - какие спасброски отложить, ауры чужих токенов, чей ход
 * @returns урон, исходы бросков и были ли изменения
 */
export function processTurnEffects(
  entity: DnDSceneEntity,
  timing: EffectSaveTiming,
  options: TurnEffectsOptions = {},
): TurnEffectsResult {
  const event = turnTriggerEventOf(timing);
  const ambientEffects = options.ambientEffects ?? [];

  /**
   * Срабатывания эффекта на эту границу хода.
   *
   * @param effect - эффект
   * @returns срабатывания
   */
  const turnTriggersOf = (effect: ActiveEffect): EffectTrigger[] =>
    listTurnTriggers(effect, event, options);

  const sources: EffectTriggerSource[] = [
    ...buildTriggerSources(
      entity.activeEffects ?? [],
      EFFECT_TRIGGER_SOURCE_KINDS.instance,
      turnTriggersOf,
    ),
    ...buildTriggerSources(
      listTraitEffects(entity),
      EFFECT_TRIGGER_SOURCE_KINDS.trait,
      turnTriggersOf,
    ),
    // Аура «пока внутри» срабатывает на ходу того, кто в ней стоит
    ...buildTriggerSources(
      ambientEffects.filter(
        (effect) => (effect.areaTrigger ?? 'stay') === 'stay',
      ),
      EFFECT_TRIGGER_SOURCE_KINDS.aura,
      turnTriggersOf,
    ),
  ];

  const result: TurnEffectsResult = {
    changed: false,
    damageTotal: 0,
    saveOutcomes: [],
    damageOutcomes: [],
    healingOutcomes: [],
    deferredSaveEffects: [],
    deferredDamageSaveEffects: [],
    deferredAmbientDamageSaveEffects: [],
    deferredTriggers: [],
  };

  if (sources.length === 0) {
    return result;
  }

  const stats = resolveActorStats(entity, [...ambientEffects]);

  let savingThrowContext = buildEffectSavingThrowContext(
    entity,
    ambientEffects,
  );

  /** Спасброски этапа урона — наложение того же срабатывания идёт по ним */
  const damageStageSaves = new Map<EffectTrigger, TurnSaveOutcome>();
  const deferredSources = new Set<EffectTrigger>();
  const allowedTriggers = new Set<EffectTrigger>();
  const blockedTriggers = new Set<EffectTrigger>();

  let usageChanged = false;

  /**
   * Проходит ли срабатывание по лимиту: первое прохождение отмечается в
   * счётчике, проверка того же срабатывания на втором этапе — нет.
   *
   * @param source - срабатывание с источником
   * @returns `true`, если срабатывание выполняется
   */
  const allowTrigger = (source: EffectTriggerSource): boolean => {
    if (allowedTriggers.has(source.trigger)) {
      return true;
    }

    if (blockedTriggers.has(source.trigger) || !admitTrigger(entity, source)) {
      blockedTriggers.add(source.trigger);

      return false;
    }

    allowedTriggers.add(source.trigger);
    usageChanged ||= source.trigger.limit !== undefined;

    return true;
  };

  let healedTotal = 0;
  let tempHpGranted = 0;

  // 1. Урон и лечение
  for (const source of sources) {
    const { effect, trigger, ambient, instance } = source;

    // Отключённый эффект не действует — значит, и не бьёт. Своя аура без
    // «действует и на носителя» бьёт других, а не того, кто её излучает
    if (
      isEffectDormant(effect)
      || !sourceHasDamage(source)
      || (instance && effect.aura && !effect.aura.applyToSelf)
      || !allowTrigger(source)
    ) {
      continue;
    }

    const healing = rollTriggerHealing(effect, trigger);

    if (healing) {
      result.healingOutcomes.push(healing);
      healedTotal += healing.healed;
      tempHpGranted = Math.max(tempHpGranted, healing.tempHp);
    }

    let save: TurnSaveOutcome | null = null;

    const spec = buildTriggerSaveSpec(effect, trigger);

    if (spec) {
      // Спасбросок спросят у игрока: урон ждёт ответа
      if (options.deferRecurringDamageSave?.(effect)) {
        if (ambient) {
          result.deferredAmbientDamageSaveEffects.push(effect);
        } else if (instance) {
          result.deferredDamageSaveEffects.push(effect);
        }

        result.deferredTriggers.push({ ...source, stage: 'damage' });
        deferredSources.add(trigger);

        continue;
      }

      save = toTriggerSaveOutcome(
        trigger,
        rollEffectSaveWithContext(spec, stats, savingThrowContext),
      );

      result.saveOutcomes.push(save);
      damageStageSaves.set(trigger, save);
    }

    const damage = rollTriggerDamage(
      entity,
      effect,
      trigger,
      save?.passed ?? false,
      stats,
    );

    if (damage) {
      result.damageTotal += damage.total;
      result.damageOutcomes.push(damage);
    }
  }

  if (result.damageTotal > 0) {
    applyDamageToEntity(entity, result.damageTotal);
    // Урон мог опустить хиты — спасброски снятия считаются уже по новому
    // состоянию сущности
    savingThrowContext = buildEffectSavingThrowContext(entity, ambientEffects);
  }

  const healingApplied =
    (healedTotal > 0 || tempHpGranted > 0)
    && applyTurnHealing(entity, healedTotal, tempHpGranted);

  // 2. Снятие и наложение
  const removedIds = new Set<string>();

  let appliedAny = false;

  for (const source of sources) {
    const { effect, trigger, instance } = source;

    // Отключённый эффект не действует — и сам себя спасброском не снимает
    if (
      isEffectDormant(effect)
      || !sourceHasEffects(source)
      || deferredSources.has(trigger)
      || (instance && removedIds.has(effect.id))
      || !allowTrigger(source)
    ) {
      continue;
    }

    let save = damageStageSaves.get(trigger) ?? null;

    const spec = buildTriggerSaveSpec(effect, trigger);

    if (!save && spec) {
      // Спасбросок спросят у игрока: до ответа эффект держится
      if (options.deferRecurringSave?.(effect)) {
        if (instance) {
          result.deferredSaveEffects.push(effect);
        }

        result.deferredTriggers.push({ ...source, stage: 'effects' });

        continue;
      }

      save = toTriggerSaveOutcome(
        trigger,
        rollEffectSaveWithContext(spec, stats, savingThrowContext),
      );

      result.saveOutcomes.push(save);
    }

    const { removes, applied } = applyTriggerEffectActions(
      entity,
      source,
      save?.passed ?? false,
      {
        ambientEffects,
        activeTurnActorId: options.sourceTurnActorId ?? entity.id,
        endCast: options.endCast,
      },
    );

    appliedAny ||= applied;

    if (removes) {
      removedIds.add(effect.id);

      // Снятый этой же серией эффект больше не даёт кубик следующим спасброскам
      savingThrowContext = {
        ...savingThrowContext,
        effects: savingThrowContext.effects.filter(
          (activeEffect) => activeEffect.id !== effect.id,
        ),
      };
    }
  }

  removeEffectsById(entity, removedIds);

  result.changed =
    result.damageTotal > 0
    || removedIds.size > 0
    || healingApplied
    || appliedAny
    || usageChanged;

  return result;
}

/**
 * Применяет разовый эффект области/ауры (`enter`/`exit`) по УЖЕ известному
 * исходу спасброска: наносит урон и, если у эффекта есть длящаяся нагрузка
 * (флаги/changes/состояние), вешает её копию как самостоятельный эффект со своей
 * длительностью.
 *
 * Что даёт успех спасброска, решают гейты разового срабатывания
 * (`readEffectLandingTrigger`) — те же, что у эффекта, наложенного атакой:
 * половина урона без эффекта, «эффект даже при успехе», «только при успехе».
 *
 * Спасбросок отделён от применения: его бросает сервер (авто-спасброски) или
 * игрок по запросу, и применение одно на оба пути.
 *
 * Мутирует `entity.system.hitPoints` (урон) и `entity.activeEffects` (статус).
 *
 * @param entity - сущность, на которую действует эффект
 * @param effect - эффект области/ауры
 * @param saveOutcome - исход спасброска эффекта; `null` — спасброска нет
 * @param options - откуда пришёл эффект
 * @returns исходы урона и спасброска для подписи в чате
 */
export function applyEntryEffect(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  saveOutcome: TurnSaveOutcome | null,
  options: EntryEffectOptions = {},
): EntryEffectResult {
  const ambientEffects = options.ambientEffects ?? [];
  const stats = resolveActorStats(entity, [...ambientEffects]);

  const source: EffectTriggerSource = {
    effect,
    trigger: readEffectLandingTrigger(effect, 'enter'),
    ambient: false,
    instance: false,
    scope: effect.id,
  };

  // Эффект области «приземлился» всегда: промаха у зоны нет, её защита —
  // только собственный спасбросок эффекта
  const passed = effect.applySave ? saveOutcome?.passed === true : false;

  const rolled = rollTriggerDamage(
    entity,
    effect,
    source.trigger,
    passed,
    stats,
  );

  if (rolled) {
    applyDamageToEntity(entity, rolled.total);
  }

  const { applied } = applyTriggerEffectActions(entity, source, passed, {
    ambientEffects,
    sourceAreaId: options.sourceAreaId,
    activeTurnActorId: options.activeTurnActorId,
  });

  return { damageOutcome: rolled, saveOutcome, statusApplied: applied };
}

/**
 * Срабатывание разового эффекта области/ауры, спасбросок которого бросает сам
 * сервер: у сущности авто-спасброски, либо ядро не умеет спросить игрока.
 *
 * @param entity - сущность, на которую действует эффект
 * @param effect - эффект области/ауры (с `areaTrigger` `enter`/`exit`)
 * @param options - откуда пришёл эффект
 * @returns исходы урона и спасброска для подписи в чате
 */
export function resolveEntryEffect(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  options: EntryEffectOptions = {},
): EntryEffectResult {
  const saveOutcome = effect.applySave
    ? rollEffectSaveOutcome(
        entity,
        buildApplySaveSpec(effect, effect.applySave),
        options.ambientEffects,
      )
    : null;

  return applyEntryEffect(entity, effect, saveOutcome, options);
}

/**
 * Явные срабатывания эффекта на вход или выход из зоны. Разовое срабатывание
 * старых полей (`areaTrigger`, спасбросок и урон эффекта) идёт своим путём —
 * `applyEntryEffect`.
 *
 * @param effect - эффект зоны
 * @param event - вход или выход
 * @param scope - источник для счётчика лимита (`area:<зона>`)
 * @returns срабатывания с источником
 */
export function listPresenceTriggerSources(
  effect: ActiveEffect,
  event: 'enter' | 'exit',
  scope: string,
): EffectTriggerSource[] {
  return listEffectListTriggers(effect)
    .filter((trigger) => !isLegacyTrigger(trigger) && trigger.event === event)
    .map((trigger) => ({
      effect,
      trigger,
      ambient: false,
      instance: false,
      scope,
    }));
}

/**
 * Бросает на сервере спасбросок срабатывания.
 *
 * @param entity - кто бросает
 * @param source - срабатывание с источником
 * @param ambientEffects - ауры чужих токенов
 * @param eventData - данные события (Сл формулой)
 * @returns исход либо `null`, если спасброска нет
 */
export function rollTriggerSave(
  entity: DnDSceneEntity,
  source: EffectTriggerSource,
  ambientEffects: readonly ActiveEffect[] = [],
  eventData: TriggerEventData = {},
): TurnSaveOutcome | null {
  const spec = buildTriggerSaveSpec(source.effect, source.trigger, {
    entity,
    eventData,
  });

  return spec
    ? toTriggerSaveOutcome(
        source.trigger,
        rollEffectSaveOutcome(entity, spec, ambientEffects),
      )
    : null;
}

/**
 * Выполняет срабатывание входа или выхода по известному исходу спасброска:
 * урон, лечение и наложения.
 *
 * @param entity - субъект
 * @param source - срабатывание с источником
 * @param save - исход спасброска; `null` — спасброска нет
 * @param options - откуда пришли наложения
 * @returns исходы для чата
 */
export function settlePresenceTrigger(
  entity: DnDSceneEntity,
  source: EffectTriggerSource,
  save: TurnSaveOutcome | null,
  options: EntryEffectOptions = {},
): EntryEffectResult {
  return settleTriggerOutcome(entity, entity, source, save, options);
}

/**
 * Выполняет срабатывания на самой сущности без второй стороны и без окна
 * броска: условие и лимит, спасбросок броском системы, действия. Так идут
 * «при включении» и «после отдыха».
 *
 * @param entity - субъект (меняется)
 * @param sources - срабатывания с источниками
 */
export function settleSelfTriggerSources(
  entity: DnDSceneEntity,
  sources: readonly EffectTriggerSource[],
): void {
  for (const source of sources) {
    if (admitTrigger(entity, source)) {
      settlePresenceTrigger(entity, source, rollTriggerSave(entity, source));
    }
  }
}

/**
 * Выполняет срабатывание по известному исходу спасброска: урон, лечение и
 * наложения достаются получателю, снятие — эффекту субъекта, если эффект лежит
 * на нём сам.
 *
 * @param subject - субъект: на нём эффект
 * @param recipient - получатель действий (субъект или другая сторона)
 * @param source - срабатывание с источником
 * @param save - исход спасброска получателя; `null` — спасброска нет
 * @param options - откуда пришли наложения и чей сейчас ход
 * @returns исходы для чата
 */
export function settleTriggerOutcome(
  subject: DnDSceneEntity,
  recipient: DnDSceneEntity,
  source: EffectTriggerSource,
  save: TurnSaveOutcome | null,
  options: EntryEffectOptions = {},
): EntryEffectResult {
  const ambientEffects = options.ambientEffects ?? [];
  const stats = resolveActorStats(recipient, [...ambientEffects]);
  const passed = save?.passed ?? false;

  const damage = rollTriggerDamage(
    recipient,
    source.effect,
    source.trigger,
    passed,
    stats,
  );

  if (damage) {
    applyDamageToEntity(recipient, damage.total);
  }

  const healing = rollTriggerHealing(source.effect, source.trigger);

  const healed =
    healing !== null
    && applyTurnHealing(recipient, healing.healed, healing.tempHp);

  const { applied, removes } = applyTriggerEffectActions(
    recipient,
    source,
    passed,
    options,
  );

  const removed =
    removes
    && (subject.activeEffects ?? []).some(
      (effect) => effect.id === source.effect.id,
    );

  if (removed) {
    removeEffectsById(subject, new Set([source.effect.id]));
  }

  return {
    damageOutcome: damage,
    saveOutcome: save,
    statusApplied: applied || healed || removed,
  };
}

/** Что известно о броске атаки одной стороне */
export interface AttackRollTriggerOptions {
  /** Сторона участвует в идущем бою */
  inCombat?: boolean;
  /** Чей сейчас ход: срок наложенного состояния считается от него */
  activeTurnActorId?: string | null;
  /** Другая сторона: цель для атакующего, атакующий для цели */
  other?: DnDSceneEntity;
  /** Режим броска атаки */
  roll?: TriggerEventData['roll'];
}

/** Итог срабатываний на броске атаки */
export interface AttackRollTriggersResult {
  /** Сущность изменилась: сняты или наложены эффекты, записан счётчик */
  changed: boolean;
  /** Изменились счётчики лимитов (`system.effectUsage`) */
  usageChanged: boolean;
}

/** Где выполняется срабатывание броска атаки */
export type AttackRollTriggerPlace = 'client' | 'server';

/**
 * Срабатывания броска атаки стороны на её собственных эффектах: те, что клиент
 * выполняет до броска, либо те, что после броска выполняет сервер.
 *
 * @param entity - сторона атаки
 * @param role - атакующий или цель
 * @param place - где выполняется срабатывание
 * @returns срабатывания с источником
 */
export function listAttackRollSources(
  entity: DnDSceneEntity,
  role: EffectTriggerAttackRole,
  place: AttackRollTriggerPlace,
): EffectTriggerSource[] {
  return buildTriggerSources(
    listLiveEffects(entity),
    EFFECT_TRIGGER_SOURCE_KINDS.instance,
    (effect) =>
      listEffectEventTriggers(effect, 'attackRoll').filter(
        (trigger) =>
          (trigger.role ?? DEFAULT_TRIGGER_ATTACK_ROLE) === role
          && isClientAttackRollTrigger(trigger) === (place === 'client'),
      ),
  );
}

/**
 * Срабатывания на броске атаки у одной стороны: атакующего (`attacker`, «своя
 * следующая атака») или цели (`target`, «следующая атака по носителю»).
 *
 * Бросок атаки делает клиент, поэтому спасброска и урона тут нет: срабатывание
 * со спасброском пропускается, из действий выполняются снятие и наложения.
 * Мутирует сущность.
 *
 * @param entity - сторона атаки
 * @param role - роль стороны
 * @param options - бой, другая сторона и режим броска для условий
 * @param options.inCombat - сторона участвует в идущем бою
 * @param options.activeTurnActorId - чей сейчас ход
 * @param options.other - другая сторона атаки
 * @param options.roll - режим броска атаки
 * @returns что изменилось
 */
export function runAttackRollTriggers(
  entity: DnDSceneEntity,
  role: EffectTriggerAttackRole,
  options: AttackRollTriggerOptions = {},
): AttackRollTriggersResult {
  const usageBefore = JSON.stringify(entity.system.effectUsage ?? null);
  const removedIds = new Set<string>();

  const eventData: TriggerEventData = {
    other: options.other,
    roll: options.roll,
  };

  let applied = false;

  for (const source of listAttackRollSources(entity, role, 'client')) {
    if (!admitTrigger(entity, source, eventData, options.inCombat)) {
      continue;
    }

    const result = applyTriggerEffectActions(entity, source, false, {
      activeTurnActorId: options.activeTurnActorId,
    });

    if (result.removes) {
      removedIds.add(source.effect.id);
    }

    applied ||= result.applied;
  }

  removeEffectsById(entity, removedIds);

  const usageChanged =
    JSON.stringify(entity.system.effectUsage ?? null) !== usageBefore;

  return {
    changed: removedIds.size > 0 || applied || usageChanged,
    usageChanged,
  };
}
