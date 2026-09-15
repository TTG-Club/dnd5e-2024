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

import type { ActiveEffect, EffectSaveTiming } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type {
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerEvent,
} from './effectTriggerTypes.js';
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
  hasLastingEffectPayload,
  isImmuneToCondition,
  mergeAppliedEffects,
} from './effectAutomation.js';
import {
  getEntityConditionImmunities,
  resolveActorStats,
} from './effectPipeline.js';
import {
  listEffectListTriggers,
  readEffectLandingTrigger,
  resolveTriggerActionGate,
} from './effectTriggers.js';
import {
  applyDamageToEntity,
  applyTurnHealing,
  buildApplySaveSpec,
  buildEffectSavingThrowContext,
  isMagicalEffect,
  rollEffectDamage,
  rollEffectHealing,
  rollEffectSaveOutcome,
  rollEffectSavingThrow,
  withInitializedDuration,
} from './turnEffects.js';

/** Доля урона при успешном спасброске «половина урона» */
const HALF_DAMAGE_SCALE = 0.5;

/** Срабатывание на субъекте вместе с эффектом, откуда оно пришло */
export interface EffectTriggerSource {
  effect: ActiveEffect;
  trigger: EffectTrigger;
  /** Аура чужого токена: самого эффекта на субъекте нет */
  ambient: boolean;
}

/**
 * Срабатывание хода, чей спасбросок спросят у игрока. Этап: урон ждёт ответа
 * (`damage`) либо снятие и наложение (`effects`).
 */
export interface DeferredTurnTrigger extends EffectTriggerSource {
  stage: 'damage' | 'effects';
}

/**
 * Событие хода по отметке времени.
 *
 * @param timing - начало или конец хода
 * @returns событие
 */
export function turnTriggerEventOf(
  timing: EffectSaveTiming,
): EffectTriggerEvent {
  return timing === 'startOfTurn' ? 'turnStart' : 'turnEnd';
}

/**
 * Есть ли у срабатывания урон или лечение.
 *
 * @param trigger - срабатывание
 * @returns `true`, если есть действие урона
 */
export function triggerHasDamage(trigger: EffectTrigger): boolean {
  return trigger.actions.some((action) => action.type === 'damage');
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

/**
 * Что бросать для спасброска срабатывания. Спасбросок, от которого зависит
 * только урон, — не против состояния: состояние им не накладывается и не
 * снимается.
 *
 * @param effect - эффект
 * @param trigger - его срабатывание
 * @returns спецификация либо `null`, если спасброска нет
 */
export function buildTriggerSaveSpec(
  effect: ActiveEffect,
  trigger: EffectTrigger,
): EffectSaveSpec | null {
  if (!trigger.save) {
    return null;
  }

  const base = {
    effectName: effect.name,
    ability: trigger.save.ability,
    dc: trigger.save.dc,
    againstMagic: isMagicalEffect(effect),
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
 * @returns доля
 */
export function resolveTriggerActionScale(
  trigger: EffectTrigger,
  action: EffectTriggerAction,
  passed: boolean,
): number {
  switch (resolveTriggerActionGate(trigger, action)) {
    case 'failed':
      return passed ? 0 : 1;
    case 'saved':
      return passed ? 1 : 0;
    default:
      return passed && action.type === 'damage' && action.halfOnSave
        ? HALF_DAMAGE_SCALE
        : 1;
  }
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

  for (const action of trigger.actions) {
    if (action.type !== 'damage') {
      continue;
    }

    const scale = resolveTriggerActionScale(trigger, action, passed);

    if (scale <= 0) {
      continue;
    }

    const rolled = rollEffectDamage(effect.name, action.parts, stats, entity);

    if (!rolled) {
      continue;
    }

    const total = Math.floor(rolled.total * scale);

    if (total <= 0) {
      continue;
    }

    outcome = outcome
      ? {
          effectName: outcome.effectName,
          total: outcome.total + total,
          types: [...new Set([...outcome.types, ...rolled.types])],
          values: [...outcome.values, ...rolled.values],
        }
      : { ...rolled, total };
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
 * Снимает ли срабатывание сам эффект при данном исходе спасброска.
 *
 * @param trigger - срабатывание
 * @param passed - пройден ли спасбросок
 * @returns `true`, если эффект снимается
 */
export function triggerRemovesSelf(
  trigger: EffectTrigger,
  passed: boolean,
): boolean {
  return trigger.actions.some(
    (action) =>
      action.type === 'removeSelf'
      && resolveTriggerActionScale(trigger, action, passed) > 0,
  );
}

/**
 * Срабатывания эффекта на событие хода субъекта.
 *
 * @param effect - эффект
 * @param event - начало или конец хода
 * @returns срабатывания
 */
function listTurnTriggers(
  effect: ActiveEffect,
  event: EffectTriggerEvent,
): EffectTrigger[] {
  return listEffectListTriggers(effect).filter(
    (trigger) =>
      trigger.event === event
      && (trigger.turnOf === undefined || trigger.turnOf === 'subject'),
  );
}

/**
 * Прогоняет срабатывания сущности на границе хода (начало/конец): сперва урон и
 * лечение (со спасброском против урона, если он задан), затем снятие эффектов
 * (повторный спасбросок — успех снимает эффект).
 *
 * Спасбросок, который надо спросить у игрока, не бросается: срабатывание уходит
 * в отложенные (`deferredTriggers` и прежние списки эффектов).
 *
 * Мутирует `entity.activeEffects` и `entity.system.hitPoints`.
 *
 * @param entity - сущность, чей момент хода обрабатывается
 * @param timing - момент: начало или конец хода
 * @param options - какие спасброски отложить, ауры чужих токенов
 * @returns урон, исходы бросков и были ли изменения
 */
export function processTurnEffects(
  entity: DnDSceneEntity,
  timing: EffectSaveTiming,
  options: TurnEffectsOptions = {},
): TurnEffectsResult {
  const event = turnTriggerEventOf(timing);
  const ambientEffects = options.ambientEffects ?? [];

  // Урон ауры «пока внутри» тикает на ходу того, кто в ней стоит
  const ambientTurnEffects = ambientEffects.filter(
    (effect) =>
      (effect.areaTrigger ?? 'stay') === 'stay'
      && effect.recurringDamage !== undefined,
  );

  const ownEffects = entity.activeEffects ?? [];

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

  if (ownEffects.length === 0 && ambientTurnEffects.length === 0) {
    return result;
  }

  const sources: EffectTriggerSource[] = [
    ...ownEffects.flatMap((effect) =>
      listTurnTriggers(effect, event).map((trigger) => ({
        effect,
        trigger,
        ambient: false,
      })),
    ),
    ...ambientTurnEffects.flatMap((effect) =>
      listTurnTriggers(effect, event).map((trigger) => ({
        effect,
        trigger,
        ambient: true,
      })),
    ),
  ];

  const stats = resolveActorStats(entity, [...ambientEffects]);

  let savingThrowContext = buildEffectSavingThrowContext(
    entity,
    ambientEffects,
  );

  /** Спасброски, брошенные на этапе урона, — снятие того же срабатывания по ним */
  const damageStageSaves = new Map<EffectTrigger, TurnSaveOutcome>();
  const deferredSources = new Set<EffectTrigger>();

  let healedTotal = 0;
  let tempHpGranted = 0;

  // 1. Урон и лечение
  for (const source of sources) {
    const { effect, trigger, ambient } = source;

    // Отключённый эффект не действует — значит, и не бьёт. Своя аура без
    // «действует и на носителя» бьёт других, а не того, кто её излучает
    if (
      effect.disabled
      || !triggerHasDamage(trigger)
      || (!ambient && effect.aura && !effect.aura.applyToSelf)
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

    if (trigger.save && spec) {
      // Спасбросок спросят у игрока: урон ждёт ответа
      if (options.deferRecurringDamageSave?.(effect)) {
        (ambient
          ? result.deferredAmbientDamageSaveEffects
          : result.deferredDamageSaveEffects
        ).push(effect);

        result.deferredTriggers.push({ ...source, stage: 'damage' });
        deferredSources.add(trigger);

        continue;
      }

      const { roll, total, passed } = rollEffectSavingThrow(
        trigger.save.ability,
        trigger.save.dc,
        stats,
        savingThrowContext,
        spec,
      );

      save = toTriggerSaveOutcome(trigger, {
        effectName: effect.name,
        ability: trigger.save.ability,
        dc: trigger.save.dc,
        roll,
        total,
        passed,
      });

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

  // 2. Снятие эффектов: ауру чужого токена снимать не с кого
  const removedIds = new Set<string>();

  for (const source of sources) {
    const { effect, trigger, ambient } = source;

    // Отключённый эффект не действует — и сам себя спасброском не снимает
    if (
      ambient
      || effect.disabled
      || !triggerHasEffects(trigger)
      || deferredSources.has(trigger)
      || removedIds.has(effect.id)
    ) {
      continue;
    }

    let save = damageStageSaves.get(trigger) ?? null;

    const spec = buildTriggerSaveSpec(effect, trigger);

    if (!save && trigger.save && spec) {
      // Спасбросок спросят у игрока: до ответа эффект держится
      if (options.deferRecurringSave?.(effect)) {
        result.deferredSaveEffects.push(effect);
        result.deferredTriggers.push({ ...source, stage: 'effects' });

        continue;
      }

      const { roll, total, passed } = rollEffectSavingThrow(
        trigger.save.ability,
        trigger.save.dc,
        stats,
        savingThrowContext,
        spec,
      );

      save = {
        effectName: effect.name,
        ability: trigger.save.ability,
        dc: trigger.save.dc,
        roll,
        total,
        passed,
      };

      result.saveOutcomes.push(save);
    }

    if (triggerRemovesSelf(trigger, save?.passed ?? false)) {
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

  if (removedIds.size > 0) {
    entity.activeEffects = ownEffects.filter(
      (effect) => !removedIds.has(effect.id),
    );
  }

  result.changed =
    result.damageTotal > 0 || removedIds.size > 0 || healingApplied;

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
  const trigger = readEffectLandingTrigger(effect, 'enter');

  // Эффект области «приземлился» всегда: промаха у зоны нет, её защита —
  // только собственный спасбросок эффекта
  const passed = effect.applySave ? saveOutcome?.passed === true : false;

  const rolled = rollTriggerDamage(entity, effect, trigger, passed, stats);

  if (rolled) {
    applyDamageToEntity(entity, rolled.total);
  }

  // Длящаяся нагрузка (статус): вешаем самостоятельной копией, живущей по своей
  // длительности (не привязана к области, так как триггер разовый)
  const appliesSelf = trigger.actions.some(
    (action) =>
      action.type === 'applySelf'
      && resolveTriggerActionScale(trigger, action, passed) > 0,
  );

  // Иммунитет к состоянию проверяется здесь так же, как при попадании атакой:
  // область — такой же путь наложения, и обходить статблок он не должен
  const conditionBlocked =
    effect.conditionKey !== undefined
    && isImmuneToCondition(
      getEntityConditionImmunities(entity, ambientEffects),
      effect.conditionKey,
    );

  let statusApplied = false;

  if (hasLastingEffectPayload(effect) && appliesSelf && !conditionBlocked) {
    const status = withInitializedDuration({
      ...effect,
      id: generateId('ae'),
      origin: 'condition',
      originId: undefined,
      areaTrigger: undefined,
      transfer: false,
      // Своя длительность: копия не должна делить счётчик с эффектом зоны
      duration: { ...effect.duration },
      // Разовая нагрузка уже отыграна — на длящейся копии её не оставляем
      damageParts: undefined,
      applySave: undefined,
      // Аура остаётся у источника: без сброса цель сама начала бы её излучать
      // (у копии нет `areaTrigger`, и она стала бы постоянной аурой)
      aura: undefined,
      effectTarget: undefined,
      // Статус от зоны заклинания кончается вместе с заклинанием — с зоной
      endsWithAreaId:
        effect.magical && options.sourceAreaId
          ? options.sourceAreaId
          : undefined,
    });

    // Правило PHB 2024 «Combining Game Effects»: одноимённый статус не
    // стакается — повторный вход в область обновляет его, а не плодит копии
    entity.activeEffects = mergeAppliedEffects(entity.activeEffects ?? [], [
      status,
    ]);

    statusApplied = true;
  }

  return { damageOutcome: rolled, saveOutcome, statusApplied };
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
