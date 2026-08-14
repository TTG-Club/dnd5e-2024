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

import type { ActorClassEntry, CounterRecovery } from './classTypes.js';
import type {
  DnDActor,
  DnDCreature,
  DnDGameItem,
  ItemUsesRecovery,
  Spell,
  SpellUsesRecovery,
} from './dndEntities.js';
import type { ActorCounterState, DnDActorSystem } from './types.js';

import {
  EXHAUSTION_LONG_REST_RECOVERY,
  getEntityExhaustionLevel,
  withExhaustionLevel,
} from './conditionTemplates.js';
import {
  getHalfHitDiceRecovery,
  getHitDiceGroups,
  recoverHitDice,
} from './hitDiceUtils.js';

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
 * Восстанавливается ли ресурс с данным способом отката при этом типе отдыха.
 * Продолжительный отдых включает в себя эффект короткого.
 *
 * @param recovery - способ отката ресурса ('short'/'long' или recovery заряда)
 * @param restType - тип совершённого отдыха
 * @returns true, если ресурс нужно восстановить до максимума
 */
function recoveryMatchesRest(
  recovery: CounterRecovery | SpellUsesRecovery | ItemUsesRecovery,
  restType: RestType,
): boolean {
  if (recovery === 'short' || recovery === 'shortRest') {
    return true;
  }

  // «На рассвете» откатывается вместе с продолжительным отдыхом — отдельного
  // счётчика игрового времени у листа нет (см. `ItemUsesRecovery`).
  if (recovery === 'long' || recovery === 'longRest' || recovery === 'dawn') {
    return restType === 'long';
  }

  return false;
}

/**
 * Возвращает копию счётчика класса с восстановленным значением, если его
 * способ отката соответствует типу отдыха; иначе — исходный счётчик.
 *
 * @param counter - текущее состояние счётчика
 * @param restType - тип совершённого отдыха
 * @returns счётчик (новый объект при восстановлении)
 */
function restoreCounter(
  counter: ActorCounterState,
  restType: RestType,
): ActorCounterState {
  // Без указанного отката восстанавливаем только продолжительным отдыхом
  const recovery: CounterRecovery = counter.recovery ?? 'long';

  if (recoveryMatchesRest(recovery, restType)) {
    return { ...counter, current: counter.max };
  }

  return counter;
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

  const restoredSystem: DnDActorSystem = {
    ...system,
    // Пактовая магия восстанавливается и коротким, и продолжительным отдыхом
    pactSlotsUsed: 0,
    classCounters: system.classCounters.map((counter) =>
      restoreCounter(counter, restType),
    ),
  };

  if (restType === 'long') {
    // Долгий отдых: все ячейки «не использованы», хиты до максимума, temp сброшен
    restoredSystem.spellSlotsUsed = [];

    restoredSystem.hitPoints = {
      ...system.hitPoints,
      current: system.hitPoints.max,
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
  if (restType === 'long') {
    const exhaustionLevel = getEntityExhaustionLevel(actor.activeEffects);

    if (exhaustionLevel > 0) {
      patch.activeEffects = withExhaustionLevel(
        actor.activeEffects ?? [],
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

  const countersRestored = system.classCounters.filter(
    (counter) => counter.current < counter.max,
  ).length;

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

  return {
    hitPoints: {
      current: system.hitPoints.current,
      max: system.hitPoints.max,
      restored: Math.max(0, system.hitPoints.max - system.hitPoints.current),
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
        current: hitDice.hitPointsCurrent,
      },
    },
  };
}

/**
 * Вычисляет патч существа при отдыхе.
 *
 * Восстанавливает заряды заклинаний существа (`Creature.spells`) по их способу
 * отката; продолжительный отдых дополнительно поднимает хиты до максимума и
 * сбрасывает временные хиты.
 *
 * @param creature - существо
 * @param restType - тип отдыха
 * @returns частичный патч существа для emit('update:creature', ...)
 */
export function applyCreatureRest(
  creature: DnDCreature,
  restType: RestType,
): Partial<DnDCreature> {
  const patch: Partial<DnDCreature> = {
    spells: (creature.spells ?? []).map((spell) =>
      restoreSpellUses(spell, restType),
    ),
  };

  if (restType === 'long') {
    const hitPoints = creature.system.hitPoints;
    const restoredMax = hitPoints.max ?? hitPoints.average ?? hitPoints.current;

    patch.system = {
      ...creature.system,
      hitPoints: {
        ...hitPoints,
        current: restoredMax ?? hitPoints.current,
        temp: 0,
      },
    };
  }

  return patch;
}
