/**
 * Движок отдыха D&D 5e (короткий / продолжительный).
 *
 * Чистые функции вычисляют патч сущности при отдыхе: восстанавливают
 * счётчики классов, заряды заклинаний и предметов, ячейки заклинаний и хиты в
 * зависимости от типа отдыха и прописанного для ресурса способа отката.
 * Используется кнопками отдыха в листах актора и существа.
 *
 * Трата зарядов предмета живёт отдельно — см. `itemUses.ts`.
 */

import type { ActiveEffect, EffectFlagKey } from './activeEffectTypes.js';
import type { ActorClassEntry } from './classTypes.js';
import type {
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
  ItemUsesRecovery,
  Spell,
  SpellUsesRecovery,
} from './dndEntities.js';
import type {
  EffectTrigger,
  EffectTriggerRestType,
} from './effectTriggerTypes.js';
import type { FormulaContext } from './formulaParser.js';
import type { ActorCounterState, DnDActorSystem } from './types.js';

import { listLiveEffects } from './activeEffectTypes.js';
import {
  EXHAUSTION_LONG_REST_RECOVERY,
  getEntityExhaustionLevel,
  withExhaustionLevel,
} from './conditionTemplates.js';
import {
  buildCounterFormulaContext,
  getCounterRecoveryAmount,
  getCounterRecoveryRules,
  isCounterAvailable,
  resolveCounterMaxIn,
} from './counterResource.js';
import { restoreCreatureSpellGroupUses } from './creatureSpellcasting.js';
import { cloneEntityData } from './dataClone.js';
import { resolveActorStats } from './effectPipeline.js';
import {
  buildTriggerSources,
  EFFECT_TRIGGER_SOURCE_KINDS,
  settleSelfTriggerSources,
} from './effectTriggerRunner.js';
import { listEffectEventTriggers } from './effectTriggers.js';
import { DEFAULT_TRIGGER_REST_TYPE } from './effectTriggerTypes.js';
import { pruneTriggerUsage, restLimitPeriodsOf } from './effectTriggerUsage.js';
import { canEntityRegainHitPoints } from './healingLimits.js';
import {
  getHalfHitDiceRecovery,
  getHitDiceGroups,
  recoverHitDice,
} from './hitDiceUtils.js';
import { resolveEntityMaxHp } from './hitPoints.js';

/** Тип отдыха */
export type RestType = 'short' | 'long';

/** Параметры продолжительного отдыха */
export interface LongRestOptions {
  /** Вернуть ВСЕ потраченные кости хитов (домашнее правило вместо половины) */
  recoverAllHitDice?: boolean;
  /**
   * Выпавшие числа возврата зарядов по id предмета — для предметов с формулой
   * (`uses.formula`). Собирается модалкой отдыха из
   * {@link collectItemChargeRolls}; предмет без записи здесь восстанавливается
   * до максимума.
   */
  itemChargeRolls?: Record<string, number>;
}

/**
 * Предпросмотр продолжительного отдыха — что и сколько будет восстановлено.
 * Используется модалкой долгого отдыха для отображения итогов до подтверждения.
 */
export interface LongRestPreview {
  /** Хиты: текущие, максимум и насколько поднимутся */
  hitPoints: { current: number; max: number; restored: number };
  /** Временные хиты, которые будут сброшены */
  tempHitPointsCleared: number;
  /** Кости хитов: всего, потрачено, вернётся по правилам и при «вернуть все» */
  hitDice: {
    total: number;
    used: number;
    recoverHalf: number;
    recoverAll: number;
  };
  /** Сколько использованных ячеек заклинаний (вкл. пактовые) восстановится */
  spellSlotsRestored: number;
  /** Сколько классовых счётчиков восстановится */
  countersRestored: number;
  /** Сколько заклинаний восстановят заряды */
  spellChargesRestored: number;
  /** Сколько предметов инвентаря восстановят заряды */
  itemChargesRestored: number;
  /** Истощение: степень сейчас и какой станет после отдыха */
  exhaustion: { level: number; levelAfterRest: number };
}

/**
 * Результат броска костей хитов из модалки короткого отдыха.
 * Случайный бросок выполняется на клиенте (diceRollerStore), сюда приходит
 * уже вычисленное лечение и обновлённые счётчики потраченных костей.
 */
export interface ShortRestHitDiceResult {
  /** Новое значение текущих хитов (после лечения, не выше максимума) */
  hitPointsCurrent: number;
  /** Классы с обновлённым `hitDiceUsed` */
  classes: ActorClassEntry[];
  /** Ручные кости хитов с обновлённым `used` */
  manualHitDice?: DnDActorSystem['manualHitDice'];
}

/**
 * Восстанавливаются ли заряды с данным способом отката при этом типе отдыха.
 * Продолжительный отдых включает в себя эффект короткого.
 *
 * Счётчики ресурсов сюда не ходят: у них восстановление раздельное по видам
 * отдыха и с количеством (`counterResource.getCounterRecoveryRules`), а не
 * «всё или ничего».
 *
 * @param recovery - способ отката зарядов заклинания или предмета
 * @param restType - тип совершённого отдыха
 * @returns true, если заряды нужно восстановить до максимума
 */
function recoveryMatchesRest(
  recovery: SpellUsesRecovery | ItemUsesRecovery,
  restType: RestType,
): boolean {
  if (recovery === 'shortRest') {
    return true;
  }

  // «На рассвете» откатывается вместе с продолжительным отдыхом — отдельного
  // счётчика игрового времени у листа нет (см. `ItemUsesRecovery`).
  if (recovery === 'longRest' || recovery === 'dawn') {
    return restType === 'long';
  }

  return false;
}

/**
 * Возвращает копию счётчика класса с зарядами, которые вернул отдых.
 *
 * Отдых именно ДОБАВЛЯЕТ заряды, а не выставляет максимум: правило ресурса
 * может возвращать не всё, а одну штуку («Удача клинка» — заряд за короткий
 * отдых), и «до максимума» вернуло бы больше положенного.
 *
 * Максимум берётся посчитанным, а не записанным: у ресурса с формулой записанное
 * число — снимок последнего расчёта, и после повышения уровня отдых восполнял бы
 * его до прежнего потолка. Свежий максимум заодно сохраняется в счётчик.
 *
 * @param counter - текущее состояние счётчика
 * @param restType - тип совершённого отдыха
 * @param context - `@`-переменные листа для формулы максимума
 * @returns счётчик (новый объект при восстановлении)
 */
function restoreCounter(
  counter: ActorCounterState,
  restType: RestType,
  context: FormulaContext,
): ActorCounterState {
  const max = resolveCounterMaxIn(context, counter);
  const rules = getCounterRecoveryRules(counter);

  const restored = getCounterRecoveryAmount(
    restType === 'short' ? rules.shortRest : rules.longRest,
    max,
  );

  if (restored === 0 && max === counter.max) {
    return counter;
  }

  return {
    ...counter,
    max,
    current: Math.min(Math.max(counter.current + restored, 0), max),
  };
}

/**
 * Возвращает копию заклинания с восстановленными зарядами, если способ отката
 * зарядов соответствует типу отдыха; иначе — исходное заклинание. Заклинания
 * без зарядов или «по желанию» не изменяются.
 *
 * @param spell - заклинание
 * @param restType - тип совершённого отдыха
 * @returns заклинание (новый объект при восстановлении зарядов)
 */
function restoreSpellUses(spell: Spell, restType: RestType): Spell {
  if (!spell.uses || spell.uses.recovery === 'atWill') {
    return spell;
  }

  if (recoveryMatchesRest(spell.uses.recovery, restType)) {
    return { ...spell, uses: { ...spell.uses, current: spell.uses.max } };
  }

  return spell;
}

/**
 * Восстанавливает ли предмет заряды при этом отдыхе — и не полон ли он уже.
 * Общая проверка для патча отдыха и для предпросмотра, чтобы модалка и сам
 * отдых не разошлись в том, что считается восстановлением.
 *
 * @param item - предмет инвентаря
 * @param restType - тип совершённого отдыха
 */
function itemUsesRecoverable(item: DnDGameItem, restType: RestType): boolean {
  return (
    item.uses !== undefined
    && item.uses.current < item.uses.max
    && recoveryMatchesRest(item.uses.recovery, restType)
  );
}

/**
 * Возвращает копию предмета с восстановленными зарядами, если способ отката
 * соответствует типу отдыха; иначе — исходный предмет.
 *
 * Предмет с формулой возврата (`uses.formula`) ждёт результата броска: сам
 * движок кости не бросает. Пришёл бросок — прибавляем его к остатку, не выше
 * максимума; не пришёл — восстанавливаем до максимума, чтобы предмет не завис
 * пустым из-за того, что вызывающий не умеет бросать.
 *
 * @param item - предмет инвентаря
 * @param restType - тип совершённого отдыха
 * @param roll - выпавшее число возврата для этого предмета
 * @returns предмет (новый объект при восстановлении зарядов)
 */
function restoreItemUses(
  item: DnDGameItem,
  restType: RestType,
  roll: number | undefined,
): DnDGameItem {
  if (!item.uses || !itemUsesRecoverable(item, restType)) {
    return item;
  }

  const restored =
    item.uses.formula && roll !== undefined
      ? Math.min(item.uses.max, item.uses.current + roll)
      : item.uses.max;

  return { ...item, uses: { ...item.uses, current: restored } };
}

/**
 * Предметы, которым для отката зарядов нужен бросок — модалка отдыха бросает их
 * формулы и передаёт результат в {@link LongRestOptions.itemChargeRolls}.
 *
 * @param actor - актор
 * @param restType - тип совершённого отдыха
 * @returns предметы с формулой возврата, у которых есть что восстанавливать
 */
export function collectItemChargeRolls(
  actor: DnDActor,
  restType: RestType,
): Array<{ id: string; name: string; formula: string }> {
  return (actor.equipment ?? [])
    .filter(
      (item) =>
        itemUsesRecoverable(item, restType) && Boolean(item.uses?.formula),
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      formula: item.uses?.formula ?? '',
    }));
}

/**
 * Запускает ли отдых срабатывание: «любой» — всякий, иначе — свой.
 *
 * @param triggerRest - отдых срабатывания
 * @param restType - совершённый отдых
 * @returns `true`, если срабатывание выполняется
 */
function restTriggerMatches(
  triggerRest: EffectTriggerRestType,
  restType: RestType,
): boolean {
  return triggerRest === 'any' || triggerRest === restType;
}

/**
 * Эффекты сущности после срабатываний «после отдыха»: снятие, отметки,
 * состояния («максимум хитов возвращается после долгого отдыха»).
 *
 * Сущность приходит из стора хоста — срабатывания идут на её JSON-копии.
 *
 * @param entity - персонаж или существо
 * @param restType - совершённый отдых
 * @returns эффекты после срабатываний либо `undefined`, если срабатывать нечему
 */
export function resolveRestTriggerEffects(
  entity: DnDSceneEntity,
  restType: RestType,
): ActiveEffect[] | undefined {
  const restTriggersOf = (effect: ActiveEffect): EffectTrigger[] =>
    listEffectEventTriggers(effect, 'rest').filter((trigger) =>
      restTriggerMatches(
        trigger.restType ?? DEFAULT_TRIGGER_REST_TYPE,
        restType,
      ),
    );

  if (
    !listLiveEffects(entity).some((effect) => restTriggersOf(effect).length > 0)
  ) {
    return undefined;
  }

  const rested = cloneEntityData(entity);

  settleSelfTriggerSources(
    rested,
    buildTriggerSources(
      listLiveEffects(rested),
      EFFECT_TRIGGER_SOURCE_KINDS.instance,
      restTriggersOf,
    ),
  );

  return rested.activeEffects ?? [];
}

/** Флаги «отдых не приносит пользы» по виду отдыха */
const REST_BLOCKED_FLAGS: Record<RestType, EffectFlagKey> = {
  short: 'rest.noBenefit.short',
  long: 'rest.noBenefit.long',
};

/**
 * Не приносит ли отдых пользы этому актёру.
 *
 * @param actor - отдыхающий
 * @param restType - короткий или продолжительный отдых
 * @returns `true`, если польза отдыха отменена
 */
function isRestBlocked(actor: DnDActor, restType: RestType): boolean {
  return resolveActorStats(actor).activeFlags.has(REST_BLOCKED_FLAGS[restType]);
}

/**
 * Вычисляет патч актора при отдыхе.
 *
 * Короткий отдых: пактовые ячейки, счётчики с откатом 'short', заряды
 * заклинаний и предметов 'shortRest'. Продолжительный — дополнительно: все
 * ячейки заклинаний, счётчики 'long', заряды 'longRest' и 'dawn', хиты до
 * максимума и сброс временных хитов.
 *
 * @param actor - актор
 * @param restType - тип отдыха
 * @param options - параметры долгого отдыха (напр. вернуть все кости хитов)
 * @returns частичный патч актора для emit('update:actor', ...)
 */
export function applyActorRest(
  actor: DnDActor,
  restType: RestType,
  options: LongRestOptions = {},
): Partial<DnDActor> {
  const system = actor.system;

  // «Отдых не приносит пользы» («Проклятие бессонницы»): ни ресурсов, ни
  // ячеек, ни хитов. Сами срабатывания «после отдыха» при этом идут — отдых
  // состоялся, польза от него не пришла
  if (isRestBlocked(actor, restType)) {
    const blockedEffects = resolveRestTriggerEffects(actor, restType);

    return blockedEffects ? { activeEffects: blockedEffects } : {};
  }

  // Срабатывания «после отдыха» идут первыми: снятое ими (уменьшение максимума
  // хитов, запрет лечения) уже не держит хиты этого отдыха
  const restedEffects = resolveRestTriggerEffects(actor, restType);

  const restedActor: DnDActor = restedEffects
    ? { ...actor, activeEffects: restedEffects }
    : actor;

  // Контекст формул собирается один раз на весь список счётчиков
  const counterContext = buildCounterFormulaContext(actor);

  const restoredSystem: DnDActorSystem = {
    ...system,
    // Отдых заканчивает периоды лимитов «раз в отдых» у срабатываний эффектов
    ...(system.effectUsage === undefined
      ? {}
      : {
          effectUsage: pruneTriggerUsage(actor, restLimitPeriodsOf(restType)),
        }),
    // Пактовая магия восстанавливается и коротким, и продолжительным отдыхом
    pactSlotsUsed: 0,
    classCounters: system.classCounters.map((counter) =>
      restoreCounter(counter, restType, counterContext),
    ),
  };

  if (restType === 'long') {
    // Долгий отдых: все ячейки «не использованы», хиты до максимума, temp сброшен
    restoredSystem.spellSlotsUsed = [];

    // Максимум — с прибавкой эффектов (`hitPoints.max`), тот же, что в плитке
    // листа: «полные хиты» после отдыха обязаны совпасть с показанным потолком,
    // иначе чародей с «Драконьей устойчивостью» вставал бы 26/29
    restoredSystem.hitPoints = {
      ...system.hitPoints,
      // Запрет лечения держит хиты и через отдых
      current: canEntityRegainHitPoints(restedActor)
        ? resolveEntityMaxHp(restedActor)
        : system.hitPoints.current,
      temp: 0,
    };

    // Возвращается до половины потраченных костей хитов (минимум 1),
    // либо все — при включённом домашнем правиле
    const recovered = recoverHitDice(
      system.classes,
      system.manualHitDice,
      options.recoverAllHitDice ?? false,
    );

    restoredSystem.classes = recovered.classes;

    if (system.manualHitDice) {
      restoredSystem.manualHitDice = recovered.manualHitDice;
    }
  }

  const rolls = options.itemChargeRolls ?? {};

  const patch: Partial<DnDActor> = {
    spells: actor.spells.map((spell) => restoreSpellUses(spell, restType)),
    equipment: (actor.equipment ?? []).map((item) =>
      restoreItemUses(item, restType, rolls[item.id]),
    ),
    system: restoredSystem,
  };

  // Продолжительный отдых снимает одну степень Истощения (PHB 2024). Патч
  // добавляется только когда есть что менять: пустой `activeEffects` перетёр бы
  // эффекты, которых отдых не касается
  if (restedEffects) {
    patch.activeEffects = restedEffects;
  }

  if (restType === 'long') {
    const exhaustionLevel = getEntityExhaustionLevel(restedActor.activeEffects);

    if (exhaustionLevel > 0) {
      patch.activeEffects = withExhaustionLevel(
        restedActor.activeEffects ?? [],
        exhaustionLevel - EXHAUSTION_LONG_REST_RECOVERY,
      );
    }
  }

  return patch;
}

/**
 * Считает предпросмотр продолжительного отдыха актора: сколько хитов, костей
 * хитов, ячеек, счётчиков и зарядов будет восстановлено. Чистая функция,
 * ничего не мутирует — только агрегирует текущее состояние.
 *
 * @param actor - актор
 * @returns структура с итогами восстановления для отображения в модалке
 */
export function summarizeActorLongRest(actor: DnDActor): LongRestPreview {
  const system = actor.system;

  const groups = getHitDiceGroups(system.classes, system.manualHitDice);
  const totalHitDice = groups.reduce((sum, group) => sum + group.total, 0);
  const usedHitDice = groups.reduce((sum, group) => sum + group.used, 0);

  const spellSlotsUsed = (system.spellSlotsUsed ?? []).reduce(
    (sum, used) => sum + used,
    0,
  );

  const spellSlotsRestored = spellSlotsUsed + (system.pactSlotsUsed ?? 0);

  // Считаются только те, кому отдых и правда что-то вернёт: у ресурса с
  // откатом «ничего» пустой остаток так и останется пустым, а ресурс, до
  // первой ступени которого персонаж не дорос, на листе не показан вовсе
  const counterContext = buildCounterFormulaContext(actor);

  const countersRestored = system.classCounters.filter((counter) => {
    const max = resolveCounterMaxIn(counterContext, counter);

    return (
      isCounterAvailable(counter, max)
      && counter.current < max
      && getCounterRecoveryAmount(
        getCounterRecoveryRules(counter).longRest,
        max,
      ) > 0
    );
  }).length;

  const spellChargesRestored = actor.spells.filter((spell) => {
    if (!spell.uses || spell.uses.recovery === 'atWill') {
      return false;
    }

    return (
      recoveryMatchesRest(spell.uses.recovery, 'long')
      && spell.uses.current < spell.uses.max
    );
  }).length;

  const itemChargesRestored = (actor.equipment ?? []).filter((item) =>
    itemUsesRecoverable(item, 'long'),
  ).length;

  const exhaustionLevel = getEntityExhaustionLevel(actor.activeEffects);

  // Потолок предпросмотра — тот же, до которого поднимет отдых
  const maxHitPoints = resolveEntityMaxHp(actor);

  return {
    hitPoints: {
      current: system.hitPoints.current,
      max: maxHitPoints,
      restored: Math.max(0, maxHitPoints - system.hitPoints.current),
    },
    tempHitPointsCleared: system.hitPoints.temp,
    hitDice: {
      total: totalHitDice,
      used: usedHitDice,
      recoverHalf: getHalfHitDiceRecovery(system.classes, system.manualHitDice),
      recoverAll: usedHitDice,
    },
    spellSlotsRestored,
    countersRestored,
    spellChargesRestored,
    itemChargesRestored,
    exhaustion: {
      level: exhaustionLevel,
      levelAfterRest: Math.max(
        0,
        exhaustionLevel - EXHAUSTION_LONG_REST_RECOVERY,
      ),
    },
  };
}

/**
 * Короткий отдых с тратой костей хитов.
 *
 * Накладывает результат броска костей хитов (новые текущие хиты и обновлённые
 * счётчики потраченных костей) поверх обычного восстановления ресурсов
 * короткого отдыха (`applyActorRest(actor, 'short')` — пактовые ячейки,
 * короткие счётчики, заряды заклинаний 'shortRest').
 *
 * @param actor - актор
 * @param hitDice - результат броска костей хитов из модалки
 * @returns частичный патч актора для emit('update:actor', ...)
 */
export function applyShortRestWithHitDice(
  actor: DnDActor,
  hitDice: ShortRestHitDiceResult,
): Partial<DnDActor> {
  const base = applyActorRest(actor, 'short');
  const baseSystem = base.system ?? actor.system;

  return {
    ...base,
    system: {
      ...baseSystem,
      classes: hitDice.classes,
      manualHitDice: hitDice.manualHitDice,
      hitPoints: {
        ...baseSystem.hitPoints,
        current: canEntityRegainHitPoints(actor)
          ? hitDice.hitPointsCurrent
          : baseSystem.hitPoints.current,
      },
    },
  };
}

/**
 * Вычисляет патч существа при отдыхе.
 *
 * Восстанавливает заряды заклинаний существа (`Creature.spells`) и заряды
 * предметов его инвентаря по их способу отката; продолжительный отдых
 * дополнительно поднимает хиты до максимума и сбрасывает временные хиты.
 *
 * Броски восстановления зарядов (`ItemUses.formula`) существу не передаются, в
 * отличие от листа персонажа: окна отдыха с такими бросками у существа нет, и
 * предмет с формулой возврата восполняется до максимума. Упрощение того же
 * рода, что и плоские числа в статблоке.
 *
 * @param creature - существо
 * @param restType - тип отдыха
 * @returns частичный патч существа для emit('update:creature', ...)
 */
export function applyCreatureRest(
  creature: DnDCreature,
  restType: RestType,
): Partial<DnDCreature> {
  const restedEffects = resolveRestTriggerEffects(creature, restType);

  const patch: Partial<DnDCreature> = {
    spells: (creature.spells ?? []).map((spell) =>
      restoreSpellUses(spell, restType),
    ),
    equipment: (creature.equipment ?? []).map((item) =>
      restoreItemUses(item, restType, undefined),
    ),
    ...(restedEffects ? { activeEffects: restedEffects } : {}),
  };

  // Порция «на весь список» держит счётчик у себя, а не у заклинаний: без этой
  // строки отдых вернул бы заряды «каждому», а общий счётчик оставил пустым
  const blocks = creature.system.spellcastingBlocks;

  // Отдых заканчивает периоды лимитов «раз в отдых» у срабатываний эффектов
  if (creature.system.effectUsage !== undefined) {
    patch.system = {
      ...creature.system,
      effectUsage: pruneTriggerUsage(creature, restLimitPeriodsOf(restType)),
    };
  }

  if (blocks?.length) {
    patch.system = {
      ...(patch.system ?? creature.system),
      spellcastingBlocks: restoreCreatureSpellGroupUses(blocks, restType),
    };
  }

  if (restType === 'long') {
    const hitPoints = creature.system.hitPoints;

    // Потолок — с прибавкой эффектов, как и у актора (внутри `max` статблока,
    // иначе `average`). Нуль означает, что запаса в записи нет вовсе — у
    // существа с текстовыми хитами («половина хитов призывателя»); такому отдых
    // оставляет то, что есть, а не обнуляет его.
    const restoredMax = resolveEntityMaxHp(
      restedEffects ? { ...creature, activeEffects: restedEffects } : creature,
    );

    patch.system = {
      ...(patch.system ?? creature.system),
      hitPoints: {
        ...hitPoints,
        current: restoredMax > 0 ? restoredMax : hitPoints.current,
        temp: 0,
      },
    };
  }

  return patch;
}
