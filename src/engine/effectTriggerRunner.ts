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

import type { EffectDuration, EquipmentCategory } from '@vtt/shared';

import type { ActiveEffect, EffectSaveTiming } from './activeEffectTypes.js';
import type { DnDGameItem, DnDSceneEntity } from './dndEntities.js';
import type {
  EffectTempHpMode,
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerApplyTagAction,
  EffectTriggerAttackRole,
  EffectTriggerDispelAction,
  EffectTriggerEvent,
  EffectTriggerKillAction,
  EffectTriggerMoveAction,
  EffectTriggerMoveAreaAction,
  EffectTriggerNotifyAction,
  EffectTriggerRestoreAction,
  EffectTriggerReviveAction,
  EffectTriggerSave,
  EffectTriggerSaveMode,
  EffectTriggerTempHpAction,
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
import { resolveAreaShift } from './areaShift.js';
import { combineRollMode } from './attackUtils.js';
import { DEATH_CONDITION_KEY } from './conditionKeys.js';
import {
  buildConditionActiveEffect,
  clampExhaustionLevel,
  getEntityExhaustionLevel,
} from './conditionTemplates.js';
import {
  findFirstDiceTerm,
  formatDiceFormula,
  rollDamageFormula,
} from './diceFormula.js';
import {
  hasLastingEffectPayload,
  isImmuneToCondition,
  mergeAppliedEffects,
} from './effectAutomation.js';
import { advanceEffectChangeSteps } from './effectChangeSteps.js';
import {
  getEntityConditionImmunities,
  listTraitEffects,
  resolveActorStats,
} from './effectPipeline.js';
import { advanceEffectStage, formatEffectStageLabel } from './effectStages.js';
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
  CHOICE_TRIGGER_RECIPIENT,
  DEFAULT_CAST_OWNER,
  DEFAULT_NOTIFY_TARGET,
  DEFAULT_TEMP_HP_MODE,
  DEFAULT_TRIGGER_ATTACK_ROLE,
  DEFAULT_TRIGGER_REST_TYPE,
  MAX_HP_REDUCTION_NEVER_ENDS,
  MIN_REVIVE_HP,
  PRESENCE_TRIGGER_EVENTS,
  triggerAsksPermission,
  triggerChanceHolds,
} from './effectTriggerTypes.js';
import {
  buildTriggerUsageScope,
  takeEffectCharge,
  takeTriggerUse,
} from './effectTriggerUsage.js';
import {
  findSceneToken,
  resolveForcedMoveOrigin,
  resolveForcedMovePosition,
} from './forcedMovement.js';
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
import { MIN_SPELL_SLOT_LEVEL } from './spellSlotTable.js';
import {
  countEffectTag,
  isTriggerConditionMet,
  withCombatRound,
} from './triggerConditions.js';
import {
  applyDamageToEntity,
  applyTurnHealing,
  buildApplySaveSpec,
  buildEffectSavingThrowContext,
  resolveEffectMagicCircumstances,
  restoreEntityHitPoints,
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
  stage: 'damage' | 'effects' | 'choice' | 'ask';
  /**
   * Данные события границы хода: спасбросок, который спросят у игрока, считает
   * по ним режим «если…» так же, как бросок сервера
   */
  eventData: TriggerEventData;
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
  // Порядок проверок — от самой дешёвой отмены к самой дорогой: невыполненное
  // условие не должно тратить ни «раз в ход», ни заряд эффекта
  return (
    isTriggerConditionMet(entity, source.trigger, {
      ...eventData,
      sourceId: source.effect.sourceActorId,
    })
    && triggerChanceHolds(source.trigger)
    && takeTriggerUse(entity, source.scope, source.trigger, inCombat)
    && (!source.instance || takeEffectCharge(entity, source.effect.id))
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

/** Кость автоматического успеха спасброска — условная */
const AUTO_SAVE_SUCCESS_ROLL = 20;

/** Кость автоматического провала спасброска — условная */
const AUTO_SAVE_FAILURE_ROLL = 1;

/**
 * Режим спасброска срабатывания: постоянный вместе с теми, что дают
 * выполненные условия.
 *
 * Преимущество и помеха гасят друг друга — то же правило, что у бросающего,
 * поэтому два правила с разными исходами дают обычный бросок.
 *
 * @param save - спасбросок срабатывания
 * @param event - кто бросает и данные события
 * @returns режим либо `undefined`, если бросок обычный
 */
function resolveTriggerSaveMode(
  save: EffectTriggerSave,
  event?: TriggerSaveEvent,
): EffectTriggerSaveMode | undefined {
  const modes = [
    ...(save.mode ? [save.mode] : []),
    ...(save.modeIf ?? [])
      .filter(
        (rule) =>
          event !== undefined
          && isTriggerConditionMet(
            event.entity,
            { condition: rule.condition },
            event.eventData,
          ),
      )
      .map((rule) => rule.mode),
  ];

  const mode = combineRollMode(
    modes.includes('advantage'),
    modes.includes('disadvantage'),
  );

  return mode === 'normal' ? undefined : mode;
}

/**
 * Автоматический исход спасброска срабатывания: провал главнее успеха —
 * «автопровал» состояний и здесь считается первым.
 *
 * @param save - спасбросок срабатывания
 * @param event - кто бросает и данные события
 * @returns `true`/`false` — готовый исход; `null` — бросать по-настоящему
 */
export function resolveTriggerAutoSaveOutcome(
  save: EffectTriggerSave,
  event?: TriggerSaveEvent,
): boolean | null {
  if (!event) {
    return null;
  }

  /**
   * Выполнено ли условие автоматического исхода.
   *
   * @param condition - условие строкой словаря
   * @returns `true`, если условие выполнено
   */
  const met = (condition: string | undefined): boolean =>
    condition !== undefined
    && isTriggerConditionMet(event.entity, { condition }, event.eventData);

  if (met(save.autoFailIf)) {
    return false;
  }

  return met(save.autoSuccessIf) ? true : null;
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

  const mode = resolveTriggerSaveMode(trigger.save, event);

  // Спасбросок концентрации — не против магии: «Мантия сопротивления
  // заклинаниям» его не облегчает, «Боевой заклинатель» — да
  const base = {
    effectName: effect.name,
    ability: trigger.save.ability,
    dc: resolveTriggerSaveDc(trigger.save, event),
    ...(mode ? { mode } : {}),
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
          rolls: [...outcome.rolls, ...rolled.rolls],
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
 * Срабатывание-счётчик: оно только ставит отметки. Отметку этого события
 * считают пороги `self.tagCount[...]` у урона того же события, поэтому такие
 * срабатывания выполняются до этапа урона.
 *
 * @param source - срабатывание с источником
 * @returns `true`, если все выполнимые действия — постановка отметки
 */
function sourceOnlyCountsTags(source: EffectTriggerSource): boolean {
  const actions = listSourceActions(source);

  return (
    actions.length > 0 && actions.every((action) => action.type === 'applyTag')
  );
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

/** Флаг «максимум хитов нельзя уменьшать» */
export const MAX_HP_REDUCTION_BLOCKED_FLAG = 'hitPoints.maxReductionBlocked';

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
    // «Максимум хитов нельзя уменьшать» («Аура жизни»): уменьшение просто не
    // ложится — снимать потом было бы нечего
    if (
      resolveActorStats(entity).activeFlags.has(MAX_HP_REDUCTION_BLOCKED_FLAG)
    ) {
      return null;
    }

    return buildMaxHpReduction(entity, action, options.eventDamage);
  }

  // Истощение не заменяется, а растёт: правила дают «одну степень», и поверх
  // имеющейся это следующая. Без степени состояние легло бы первой и сняло бы
  // уже накопленное
  const exhaustionLevel =
    action.conditionKey === 'exhaustion'
      ? clampExhaustionLevel(getEntityExhaustionLevel(entity.activeEffects) + 1)
      : undefined;

  const condition = buildConditionActiveEffect(action.conditionKey, {
    duration: action.duration,
    ...(exhaustionLevel === undefined ? {} : { exhaustionLevel }),
  });

  if (!condition) {
    return null;
  }

  return bindStatusToSource(
    withInitializedDuration({
      ...condition,
      // Собственные срабатывания состояния: «Сон» кладёт «Бессознательного»,
      // который снимает сам себя от урона. Заканчивать каст нельзя — он снял
      // бы сон со всех целей сразу
      ...(action.triggers ? { triggers: action.triggers } : {}),
      ...(action.recurringSave ? { recurringSave: action.recurringSave } : {}),
      // Запертое состояние снимает только то, что его наложило
      ...(action.locked ? { conditionLocked: true as const } : {}),
      // «Спадает при выходе из зоны»: без зоны выходить не из чего, и пометка
      // не ставится — состояние живёт обычным сроком
      ...(action.endsOnExit && options.sourceAreaId
        ? { endsOnExitAreaId: options.sourceAreaId }
        : {}),
    }),
    effect,
    options,
  );
}

/**
 * Адрес сообщения наложившему в сводке. Носителю адрес — его имя: он и есть
 * субъект срабатывания
 */
const NOTIFY_SOURCE_ADDRESS = 'наложившему';

/**
 * Строка действия «Сообщить» для сводки чата: кому, что и (если просили)
 * результат броска по таблице поведения.
 *
 * @param entity - субъект срабатывания
 * @param effect - эффект, чьё срабатывание идёт
 * @param action - действие «Сообщить»
 * @returns строка сводки
 */
function formatNotifyNote(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  action: EffectTriggerNotifyAction,
): string {
  const address =
    (action.to ?? DEFAULT_NOTIFY_TARGET) === 'subject'
      ? entity.name
      : NOTIFY_SOURCE_ADDRESS;

  const { roll } = action;
  const rolled = roll ? rollDamageFormula(roll) : null;

  const suffix =
    roll && rolled ? ` (${formatDiceFormula(roll)}: ${rolled.total})` : '';

  return `${effect.name} — ${address}: ${action.text}${suffix}`;
}

/**
 * Переводит эффект носителя на следующую ступень.
 *
 * Ступени меняют сам эффект на сущности, поэтому эффект ищется на ней по id:
 * снимок черты или чужой ауры переводить некуда.
 *
 * @param entity - носитель эффекта
 * @param effect - эффект, чьё срабатывание идёт
 * @param options - куда складывать строку сводки
 * @returns `true`, если ступень сменилась
 */
function advanceCarrierStage(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  options: EntryEffectOptions,
): boolean {
  const effects = entity.activeEffects ?? [];
  const current = effects.find((entry) => entry.id === effect.id);

  if (!current) {
    return false;
  }

  const advanced = advanceEffectStage(current);

  if (!advanced) {
    return false;
  }

  entity.activeEffects = effects.map((entry) =>
    entry.id === advanced.id ? advanced : entry,
  );

  const label = formatEffectStageLabel(advanced);

  if (label) {
    options.collectNote?.(`${advanced.name} — ${label}`);
  }

  return true;
}

/**
 * Снимает с получателя состояния: одно по ключу или все.
 *
 * Снимается не метка, а эффект, который её несёт, — иначе состояние вернулось
 * бы на следующем тике источника. Запертое состояние
 * (`applyCondition.locked`) так не снимается: его снимает только то, что его
 * наложило.
 *
 * @param entity - получатель (меняется)
 * @param conditionKey - какое состояние; нет - все
 * @returns `true`, если что-то сняли
 */
function removeEntityConditions(
  entity: DnDSceneEntity,
  conditionKey: string | undefined,
): boolean {
  const effects = entity.activeEffects ?? [];

  const kept = effects.filter(
    (effect) =>
      effect.conditionKey === undefined
      || effect.conditionLocked === true
      || (conditionKey !== undefined && effect.conditionKey !== conditionKey),
  );

  if (kept.length === effects.length) {
    return false;
  }

  entity.activeEffects = kept;

  return true;
}

/**
 * Убивает получателя или возвращает его к жизни.
 *
 * @param entity - получатель (меняется)
 * @param action - действие «Убить» или «Вернуть к жизни»
 * @returns `true`, если состояние изменилось
 */
function applyLifeAction(
  entity: DnDSceneEntity,
  action: EffectTriggerKillAction | EffectTriggerReviveAction,
): boolean {
  if (action.type === 'kill') {
    const dead = buildConditionActiveEffect(DEATH_CONDITION_KEY);

    if (!dead) {
      return false;
    }

    writeEntityHitPoints(entity, { current: 0, temp: 0 });

    entity.activeEffects = mergeAppliedEffects(entity.activeEffects ?? [], [
      dead,
    ]);

    return true;
  }

  const temp = resolveEntityTempHp(entity);
  const maxHp = resolveEntityMaxHp(entity);

  entity.activeEffects = (entity.activeEffects ?? []).filter(
    (effect) => effect.conditionKey !== DEATH_CONDITION_KEY,
  );

  writeEntityHitPoints(entity, {
    current: action.full ? maxHp : Math.min(action.hp ?? MIN_REVIVE_HP, maxHp),
    temp,
  });

  return true;
}

/**
 * Меняет временные хиты получателя.
 *
 * По правилам временные хиты не складываются, поэтому «Поставить» берёт
 * большее. «Прибавить» и «Потратить» нужны там, где правила говорят иначе:
 * щит из временных хитов, который расходуется.
 *
 * @param entity - получатель (меняется)
 * @param action - действие «Временные хиты»
 * @param options - урон события для `@damage`
 * @returns `true`, если временные хиты изменились
 */
function applyTempHpAction(
  entity: DnDSceneEntity,
  action: EffectTriggerTempHpAction,
  options: EntryEffectOptions,
): boolean {
  const amount = resolveMaxHpReduction(
    entity,
    action.amount,
    options.eventDamage,
  );

  const current = resolveEntityTempHp(entity);
  const next = resolveNextTempHp(current, amount, action.mode);

  if (next === current) {
    return false;
  }

  writeEntityHitPoints(entity, {
    current: resolveEntityCurrentHp(entity),
    temp: next,
  });

  return true;
}

/**
 * Сколько станет временных хитов.
 *
 * @param current - сколько их сейчас
 * @param amount - число действия
 * @param mode - что делает действие; нет - поставить
 * @returns новое число временных хитов
 */
function resolveNextTempHp(
  current: number,
  amount: number,
  mode: EffectTempHpMode | undefined,
): number {
  switch (mode ?? DEFAULT_TEMP_HP_MODE) {
    case 'add':
      return current + amount;
    case 'spend':
      return Math.max(0, current - amount);
    default:
      // Правило PHB: временные хиты не складываются, остаётся большее
      return Math.max(current, amount);
  }
}

/**
 * Надетое, а не удерживаемое: доспех, щит, кольцо, одежда, чудесные предметы
 * (плащ, сапоги, амулет). Их не роняют — доспех и щит снимают действием и
 * дольше, а кольцо с плащом в руках не держат.
 */
const WORN_EQUIPMENT_CATEGORIES: ReadonlySet<EquipmentCategory> = new Set([
  'light',
  'medium',
  'heavy',
  'shield',
  'ring',
  'clothing',
  'wondrous',
]);

/**
 * Держит ли существо предмет в руках: оружие, жезл, фокус, факел.
 *
 * Снаряжение без категории считается надетым: снять доспех по ошибке хуже,
 * чем не уронить неизвестную вещь.
 *
 * @param item - предмет снаряжения
 * @returns `true`, если предмет в руках
 */
function isItemHeld(item: DnDGameItem): boolean {
  // Отметка «надет», а не «надет и не кончился»: кончившиеся метательные
  // кинжалы в руке тоже роняют
  if (!item.equipped) {
    return false;
  }

  if (item.type !== 'equipment') {
    return true;
  }

  return (
    item.equipmentCategory !== undefined
    && !WORN_EQUIPMENT_CATEGORIES.has(item.equipmentCategory)
  );
}

/**
 * Получатель роняет то, что держит в руках: удерживаемое снимается, надетое
 * остаётся.
 *
 * @param entity - получатель (меняется)
 * @returns `true`, если что-то сняли
 */
function dropHeldItems(entity: DnDSceneEntity): boolean {
  const equipment = entity.equipment ?? [];

  let dropped = false;

  entity.equipment = equipment.map((item) => {
    if (!isItemHeld(item)) {
      return item;
    }

    dropped = true;

    return { ...item, equipped: false };
  });

  return dropped;
}

/**
 * Возвращает получателю потраченный ресурс: ячейку заклинания или счётчик
 * листа.
 *
 * @param entity - получатель (меняется)
 * @param action - действие «Вернуть ресурс»
 * @returns `true`, если ресурс вернулся
 */
function restoreEntityResource(
  entity: DnDSceneEntity,
  action: EffectTriggerRestoreAction,
): boolean {
  const amount = Math.max(1, action.amount ?? 1);

  if (action.what === 'counter') {
    return restoreEntityCounter(entity, action.counter, amount);
  }

  const level = action.level ?? MIN_SPELL_SLOT_LEVEL;
  const used = entity.system.spellSlotsUsed;

  if (!Array.isArray(used) || (used[level - 1] ?? 0) <= 0) {
    return false;
  }

  const next = [...used];

  next[level - 1] = Math.max(0, (used[level - 1] ?? 0) - amount);
  entity.system.spellSlotsUsed = next;

  return true;
}

/**
 * Возвращает единицы счётчика листа.
 *
 * @param entity - получатель (меняется)
 * @param counterKey - ключ счётчика; нет - возвращать нечего
 * @param amount - сколько вернуть
 * @returns `true`, если счётчик изменился
 */
function restoreEntityCounter(
  entity: DnDSceneEntity,
  counterKey: string | undefined,
  amount: number,
): boolean {
  const counters = entity.system.classCounters;

  if (!counterKey || !Array.isArray(counters)) {
    return false;
  }

  let changed = false;

  entity.system.classCounters = counters.map((counter) => {
    if (counter.counterKey !== counterKey || counter.current >= counter.max) {
      return counter;
    }

    changed = true;

    return {
      ...counter,
      current: Math.min(counter.max, counter.current + amount),
    };
  });

  return changed;
}

/**
 * Заканчивает касты по их эффектам на получателе и снимает сами эффекты:
 * остальное (эффекты каста на других существах, зоны) снимет конец каста.
 *
 * @param entity - получатель (меняется)
 * @param ended - эффекты заканчиваемых кастов
 * @param options - чем заканчивать каст
 * @returns `true`, если хоть один каст закончен
 */
function endEntityCastEffects(
  entity: DnDSceneEntity,
  ended: readonly ActiveEffect[],
  options: EntryEffectOptions,
): boolean {
  if (ended.length === 0) {
    return false;
  }

  for (const effect of ended) {
    options.endCast?.(effect);
  }

  const endedIds = new Set(ended.map((effect) => effect.id));

  entity.activeEffects = (entity.activeEffects ?? []).filter(
    (effect) => !endedIds.has(effect.id),
  );

  return true;
}

/**
 * Заканчивает касты получателя: «прерывает концентрацию цели».
 *
 * @param entity - получатель (меняется)
 * @param options - чем заканчивать каст
 * @returns `true`, если хоть один каст закончен
 */
function endRecipientCasts(
  entity: DnDSceneEntity,
  options: EntryEffectOptions,
): boolean {
  const marks = (entity.activeEffects ?? []).filter(
    (effect) => effect.concentration === true && effect.castId !== undefined,
  );

  return endEntityCastEffects(entity, marks, options);
}

/**
 * Рассеивает чужие заклинания на получателе: снимает эффекты кастов не выше
 * круга и заканчивает сами касты.
 *
 * @param entity - получатель (меняется)
 * @param action - действие «Рассеять»
 * @param options - чем заканчивать каст
 * @returns `true`, если что-то рассеяли
 */
function dispelEntityCasts(
  entity: DnDSceneEntity,
  action: EffectTriggerDispelAction,
  options: EntryEffectOptions,
): boolean {
  const effects = entity.activeEffects ?? [];

  const dispelled = effects.filter((effect) => {
    if (effect.castId === undefined) {
      return false;
    }

    return effect.castLevel === undefined
      ? action.withoutLevel === true
      : effect.castLevel <= action.maxLevel;
  });

  return endEntityCastEffects(entity, dispelled, options);
}

/**
 * Двигает фишку получателя: толчок, притягивание, перенос.
 *
 * Ставит фишку ядро — система только считает точку. Нет сцены или нет
 * возможности двигать (старое ядро) — действие молчит: двигать фишку сама
 * система не вправе.
 *
 * @param entity - получатель
 * @param action - действие «Переместить»
 * @param effect - эффект, чьё срабатывание идёт
 * @param options - сцена и возможность двигать
 */
function pushRecipient(
  entity: DnDSceneEntity,
  action: EffectTriggerMoveAction,
  effect: ActiveEffect,
  options: EntryEffectOptions,
): void {
  const { surroundings, moveToken } = options;

  if (!surroundings || !moveToken) {
    return;
  }

  const target = findSceneToken(surroundings, entity.id);

  const origin = resolveForcedMoveOrigin(
    action,
    surroundings,
    effect.sourceActorId,
  );

  if (!target || !origin) {
    return;
  }

  const position = resolveForcedMovePosition(action, {
    target,
    origin,
    gridSettings: surroundings.gridSettings,
    targetFlags: resolveActorStats(entity).activeFlags,
  });

  if (position) {
    moveToken(target.id, position);
  }
}

/**
 * Сдвигает зону, которую оставил тот же каст, что и эффект: у зоны заклинания
 * `source.castId`, у эффекта — `castId`.
 *
 * Вершины переносит ядро — система только считает смещение. Нет сцены, каста,
 * зоны или возможности сдвигать (старое ядро) — действие молчит.
 *
 * @param entity - получатель: от него и к нему сдвигается зона
 * @param action - действие «Сдвинуть зону»
 * @param effect - эффект, чьё срабатывание идёт
 * @param options - сцена, смещение носителя и возможность сдвигать
 */
function shiftCastArea(
  entity: DnDSceneEntity,
  action: EffectTriggerMoveAreaAction,
  effect: ActiveEffect,
  options: EntryEffectOptions,
): void {
  const { surroundings, moveArea } = options;
  const castId = effect.castId;

  if (!surroundings || !moveArea || !castId) {
    return;
  }

  const recipient = findSceneToken(surroundings, entity.id) ?? undefined;

  for (const area of surroundings.areas ?? []) {
    if (area.source?.castId !== castId) {
      continue;
    }

    const offset = resolveAreaShift(action, area, {
      recipient,
      movementOffset: options.movementOffset,
      gridSettings: surroundings.gridSettings,
    });

    if (offset) {
      moveArea(area.id, offset);
    }
  }
}

/**
 * Даёт получателю героическое вдохновение.
 *
 * @param entity - получатель (меняется)
 * @returns `true`, если вдохновения не было и оно появилось
 */
function grantEntityInspiration(entity: DnDSceneEntity): boolean {
  if (entity.system.inspiration === true) {
    return false;
  }

  entity.system.inspiration = true;

  return true;
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

    // Каст заканчивает ядро по всем существам; сам эффект снимается здесь же.
    // Каст получателя — чужой: свой эффект от этого не снимается
    if (action.type === 'endCast') {
      if ((action.whose ?? DEFAULT_CAST_OWNER) === 'recipient') {
        applied = endRecipientCasts(entity, options) || applied;

        continue;
      }

      removes = true;
      options.endCast?.(source.effect);

      continue;
    }

    if (action.type === 'notify') {
      options.collectNote?.(formatNotifyNote(entity, source.effect, action));

      continue;
    }

    if (action.type === 'nextStage') {
      applied = advanceCarrierStage(entity, source.effect, options) || applied;

      continue;
    }

    if (action.type === 'setHp') {
      const maxHp = resolveEntityMaxHp(entity);

      writeEntityHitPoints(entity, {
        current: action.toMax ? maxHp : Math.min(action.value, maxHp),
        temp: resolveEntityTempHp(entity),
      });

      applied = true;

      continue;
    }

    if (action.type === 'tempHp') {
      applied = applyTempHpAction(entity, action, options) || applied;

      continue;
    }

    if (action.type === 'removeCondition') {
      applied = removeEntityConditions(entity, action.conditionKey) || applied;

      continue;
    }

    if (action.type === 'kill' || action.type === 'revive') {
      applied = applyLifeAction(entity, action) || applied;

      continue;
    }

    if (action.type === 'dropHeld') {
      applied = dropHeldItems(entity) || applied;

      continue;
    }

    if (action.type === 'restore') {
      applied = restoreEntityResource(entity, action) || applied;

      continue;
    }

    if (action.type === 'dispel') {
      applied = dispelEntityCasts(entity, action, options) || applied;

      continue;
    }

    if (action.type === 'grantInspiration') {
      applied = grantEntityInspiration(entity) || applied;

      continue;
    }

    if (action.type === 'move') {
      // Перемещение меняет сцену, а не лист: сущность от него не «изменилась»
      pushRecipient(entity, action, source.effect, options);

      continue;
    }

    if (action.type === 'moveArea') {
      // Сдвиг зоны тоже меняет сцену, а не лист
      shiftCastArea(entity, action, source.effect, options);

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
 * Данные события границы хода для условий: урона и другой стороны здесь нет,
 * но расстояние до наложившего известно, если ядро отдало сцену, а номер
 * раунда — если идёт бой.
 *
 * @param source - срабатывание с источником
 * @param options - настройки прогона
 * @returns данные события
 */
function buildTurnEventData(
  source: EffectTriggerSource,
  options: TurnEffectsOptions,
): TriggerEventData {
  const sourceId = source.effect.sourceActorId;
  const isSourceWithin = options.isSourceWithin;

  const proximity: TriggerEventData =
    sourceId && isSourceWithin
      ? { isSourceWithin: (feet) => isSourceWithin(sourceId, feet) }
      : {};

  return withCombatRound(proximity, options.combatRound);
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

  // Растущие изменения «каждый ход» двигаются в начале хода носителя — до
  // срабатываний, чтобы те уже видели новое число
  const stepped =
    timing === 'startOfTurn'
    && options.sourceTurnActorId === undefined
    && advanceEffectChangeSteps(entity, 'turn');

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
    notes: [],
  };

  result.changed = stepped;

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

    if (
      blockedTriggers.has(source.trigger)
      || !admitTrigger(entity, source, buildTurnEventData(source, options))
    ) {
      blockedTriggers.add(source.trigger);

      return false;
    }

    allowedTriggers.add(source.trigger);
    usageChanged ||= source.trigger.limit !== undefined;

    return true;
  };

  /**
   * Кто бросает и данные события границы хода: без них режим спасброска по
   * условию и автоматический исход не видели бы ни листа, ни раунда боя.
   *
   * @param source - срабатывание с источником
   * @returns бросающий и данные события
   */
  const saveEventOf = (source: EffectTriggerSource): TriggerSaveEvent => ({
    entity,
    eventData: buildTurnEventData(source, options),
  });

  let appliedAny = false;

  // 0a. «Спрашивать разрешения»: срабатывание не выполняется, пока человек не
  // согласился. Этап идёт первым — согласие нужно и выбору цели, и урону.
  // В набор попадают и согласие, и выбор: дальше по этапам такое срабатывание
  // не идёт — его выполнит ответ
  const humanAskedTriggers = new Set<EffectTrigger>();

  for (const source of sources) {
    const { effect, trigger, instance } = source;

    if (
      isEffectDormant(effect)
      || !triggerAsksPermission(trigger)
      || (instance && effect.aura && !effect.aura.applyToSelf)
      || !allowTrigger(source)
    ) {
      continue;
    }

    result.deferredTriggers.push({
      ...source,
      stage: 'ask',
      eventData: saveEventOf(source).eventData,
    });

    humanAskedTriggers.add(trigger);
  }

  // 0b. Получатель «по выбору»: кого задеть, решает человек. Ни урон, ни
  // наложения на субъекте не выполняются — всё срабатывание ждёт ответа
  for (const source of sources) {
    const { effect, trigger, instance } = source;

    if (
      isEffectDormant(effect)
      || humanAskedTriggers.has(trigger)
      || trigger.recipient !== CHOICE_TRIGGER_RECIPIENT
      || !trigger.choice
      || (instance && effect.aura && !effect.aura.applyToSelf)
      || !allowTrigger(source)
    ) {
      continue;
    }

    result.deferredTriggers.push({
      ...source,
      stage: 'choice',
      eventData: saveEventOf(source).eventData,
    });

    humanAskedTriggers.add(trigger);
  }

  // 0. Отметки-счётчики. Порог `self.tagCount[...]` у урона этого же события
  // обязан видеть отметку этого события: иначе «на третьем провале» урон ждал
  // бы четвёртого — этап урона идёт раньше наложений
  const countedTriggers = new Set<EffectTrigger>();

  for (const source of sources) {
    const { effect, trigger, instance } = source;

    if (
      isEffectDormant(effect)
      || !sourceOnlyCountsTags(source)
      || humanAskedTriggers.has(trigger)
      || (instance && effect.aura && !effect.aura.applyToSelf)
      || !allowTrigger(source)
    ) {
      continue;
    }

    let countedSave: TurnSaveOutcome | null = null;

    const countedEvent = saveEventOf(source);
    const countedSpec = buildTriggerSaveSpec(effect, trigger, countedEvent);

    if (countedSpec) {
      // Спасбросок спросят у игрока: отметка ляжет вместе с наложениями.
      // Автоматический исход спрашивать не нужно — бросать нечего
      if (
        triggerSaveNeedsRoll(trigger, entity, countedEvent.eventData)
        && options.deferRecurringSave?.(effect)
      ) {
        if (instance) {
          result.deferredSaveEffects.push(effect);
        }

        result.deferredTriggers.push({
          ...source,
          stage: 'effects',
          eventData: countedEvent.eventData,
        });

        deferredSources.add(trigger);

        continue;
      }

      countedSave = toTriggerSaveOutcome(
        trigger,
        settleTriggerSaveRoll(
          entity,
          trigger,
          countedSpec,
          () =>
            rollEffectSaveWithContext(countedSpec, stats, savingThrowContext),
          countedEvent.eventData,
        ),
      );

      result.saveOutcomes.push(countedSave);
      damageStageSaves.set(trigger, countedSave);
    }

    const counted = applyTriggerEffectActions(
      entity,
      source,
      countedSave?.passed ?? false,
      {
        ambientEffects,
        activeTurnActorId: options.sourceTurnActorId ?? entity.id,
        endCast: options.endCast,
        surroundings: options.surroundings,
        moveToken: options.moveToken,
        moveArea: options.moveArea,
        collectNote: (note) => result.notes.push(note),
      },
    );

    appliedAny ||= counted.applied;
    countedTriggers.add(trigger);
  }

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
      || humanAskedTriggers.has(trigger)
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

    const damageEvent = saveEventOf(source);
    const spec = buildTriggerSaveSpec(effect, trigger, damageEvent);

    if (spec) {
      // Спасбросок спросят у игрока: урон ждёт ответа. Автоматический исход
      // спрашивать не нужно — бросать нечего
      if (
        triggerSaveNeedsRoll(trigger, entity, damageEvent.eventData)
        && options.deferRecurringDamageSave?.(effect)
      ) {
        if (ambient) {
          result.deferredAmbientDamageSaveEffects.push(effect);
        } else if (instance) {
          result.deferredDamageSaveEffects.push(effect);
        }

        result.deferredTriggers.push({
          ...source,
          stage: 'damage',
          eventData: damageEvent.eventData,
        });

        deferredSources.add(trigger);

        continue;
      }

      save = toTriggerSaveOutcome(
        trigger,
        settleTriggerSaveRoll(
          entity,
          trigger,
          spec,
          () => rollEffectSaveWithContext(spec, stats, savingThrowContext),
          damageEvent.eventData,
        ),
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

  for (const source of sources) {
    const { effect, trigger, instance } = source;

    // Отключённый эффект не действует — и сам себя спасброском не снимает
    if (
      isEffectDormant(effect)
      || !sourceHasEffects(source)
      || humanAskedTriggers.has(trigger)
      || countedTriggers.has(trigger)
      || deferredSources.has(trigger)
      || (instance && removedIds.has(effect.id))
      || !allowTrigger(source)
    ) {
      continue;
    }

    let save = damageStageSaves.get(trigger) ?? null;

    const effectsEvent = saveEventOf(source);
    const spec = buildTriggerSaveSpec(effect, trigger, effectsEvent);

    if (!save && spec) {
      // Спасбросок спросят у игрока: до ответа эффект держится.
      // Автоматический исход спрашивать не нужно — бросать нечего
      if (
        triggerSaveNeedsRoll(trigger, entity, effectsEvent.eventData)
        && options.deferRecurringSave?.(effect)
      ) {
        if (instance) {
          result.deferredSaveEffects.push(effect);
        }

        result.deferredTriggers.push({
          ...source,
          stage: 'effects',
          eventData: effectsEvent.eventData,
        });

        continue;
      }

      save = toTriggerSaveOutcome(
        trigger,
        settleTriggerSaveRoll(
          entity,
          trigger,
          spec,
          () => rollEffectSaveWithContext(spec, stats, savingThrowContext),
          effectsEvent.eventData,
        ),
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
        surroundings: options.surroundings,
        moveToken: options.moveToken,
        moveArea: options.moveArea,
        collectNote: (note) => result.notes.push(note),
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
  const event = { entity, eventData };
  const spec = buildTriggerSaveSpec(source.effect, source.trigger, event);

  if (!spec) {
    return null;
  }

  return toTriggerSaveOutcome(
    source.trigger,
    settleTriggerSaveRoll(
      entity,
      source.trigger,
      spec,
      () => rollEffectSaveOutcome(entity, spec, ambientEffects),
      eventData,
    ),
  );
}

/**
 * Готовый исход спасброска без броска: условие автоматического успеха или
 * провала выполнено.
 *
 * Значения кости здесь условные — 20 и 1, как у автопровала состояний: в чат
 * идёт исход, а не подложный бросок.
 *
 * @param spec - что бросали бы
 * @param passed - прошёл ли спасбросок
 * @returns исход спасброска
 */
function buildAutoSaveOutcome(
  spec: EffectSaveSpec,
  passed: boolean,
): TurnSaveOutcome {
  const roll = passed ? AUTO_SAVE_SUCCESS_ROLL : AUTO_SAVE_FAILURE_ROLL;

  return {
    effectName: spec.effectName,
    ability: spec.ability,
    dc: spec.dc,
    roll,
    total: roll,
    passed,
  };
}

/**
 * Нужен ли спасброску срабатывания настоящий бросок: автоматический исход его
 * заменяет, и спрашивать игрока тогда не о чем.
 *
 * @param trigger - срабатывание
 * @param entity - кто бросал бы
 * @param eventData - данные события
 * @returns `true`, если бросок нужен
 */
export function triggerSaveNeedsRoll(
  trigger: EffectTrigger,
  entity: DnDSceneEntity,
  eventData: TriggerEventData = {},
): boolean {
  return (
    trigger.save === undefined
    || resolveTriggerAutoSaveOutcome(trigger.save, { entity, eventData })
      === null
  );
}

/**
 * Исход спасброска срабатывания: автоматический, если его условие выполнено,
 * иначе — настоящий бросок.
 *
 * @param entity - кто бросает
 * @param trigger - срабатывание
 * @param spec - что бросают
 * @param roll - настоящий бросок
 * @param eventData - данные события
 * @returns исход спасброска
 */
function settleTriggerSaveRoll(
  entity: DnDSceneEntity,
  trigger: EffectTrigger,
  spec: EffectSaveSpec,
  roll: () => TurnSaveOutcome,
  eventData: TriggerEventData,
): TurnSaveOutcome {
  const auto = trigger.save
    ? resolveTriggerAutoSaveOutcome(trigger.save, { entity, eventData })
    : null;

  return auto === null ? roll() : buildAutoSaveOutcome(spec, auto);
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
 * @param combatRound - номер идущего раунда: расписание «на раунде N»
 */
export function settleSelfTriggerSources(
  entity: DnDSceneEntity,
  sources: readonly EffectTriggerSource[],
  combatRound?: number,
): void {
  for (const source of sources) {
    if (admitTrigger(entity, source, withCombatRound({}, combatRound))) {
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

  const restored = healing
    ? restoreEntityHitPoints(recipient, healing.healed, healing.tempHp)
    : null;

  const healed =
    restored !== null && (restored.healed > 0 || restored.tempHp > 0);

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
    // В сводку — сколько восстановилось на деле; выпавшее — если влезло меньше
    healingOutcome:
      healing && restored
        ? { ...healing, ...restored, rolled: healing.healed }
        : null,
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
  /** Номер идущего раунда: расписание «на раунде N» */
  combatRound?: number;
  /** Другая сторона: цель для атакующего, атакующий для цели */
  other?: DnDSceneEntity;
  /** Режим броска атаки */
  roll?: TriggerEventData['roll'];
  /** Чем бьют: вид атаки и её характеристика — для условий об атаке */
  attack?: TriggerEventData['attack'];
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

  const eventData = withCombatRound(
    {
      other: options.other,
      roll: options.roll,
      ...(options.attack ? { attack: options.attack } : {}),
    },
    options.combatRound,
  );

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
