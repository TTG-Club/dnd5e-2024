/**
 * Таблицы ячеек заклинаний D&D 5e (PHB 2024)
 *
 * Каждая таблица: уровень класса → массив ячеек [1-9 круг].
 * Индекс массива: 0 = 1-й круг, 8 = 9-й круг.
 */

import type { ActorClassEntry, CasterType } from './classTypes.js';
import type { DnDCustomBonusContext } from './customBonuses.js';
import type { DnDActor } from './dndEntities.js';
import type { DnDSpellSlotSettings } from './types.js';

import { isRecord } from '@vtt/shared';

import {
  getActorAbilityModifiers,
  getActorProficiencyBonus,
} from './calculations.js';
import {
  getCustomBonusesValue,
  parseCustomBonuses,
  toStoredCustomBonus,
} from './customBonuses.js';

/** Наименьший круг ячейки заклинания */
export const MIN_SPELL_SLOT_LEVEL = 1;

/** Наибольший круг ячейки заклинания */
export const MAX_SPELL_SLOT_LEVEL = 9;

/** Количество ячеек заклинаний по кругам (индекс 0 = 1-й круг) */
export type SpellSlotArray = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// ── Полный заклинатель (Волшебник, Жрец, Друид, Бард, Колдун-Чародей) ──

/** Таблица ячеек для полного заклинателя (PHB 2024) */
export const FULL_CASTER_SLOTS: Record<number, SpellSlotArray> = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

// ── Мультиклассовый заклинатель ──

/**
 * Таблица ячеек мультиклассового заклинателя (PHB 2024).
 *
 * У мультикласса ячейки не складываются по классам, а сводятся в ОДИН общий
 * запас: по классам считается уровень заклинателя
 * ({@link getMulticlassCasterLevel}), и уже он даёт строку этой таблицы. Так
 * волшебник 3 / жрец 3 колдует не как два третьеуровневых заклинателя, а как
 * один шестого — с ячейками 3 круга.
 *
 * Числа совпадают с таблицей полного заклинателя, но таблица отдельная: в книге
 * это разные таблицы с разным смыслом, и правка одной не должна молча менять
 * другую.
 */
export const MULTICLASS_CASTER_SLOTS: Record<number, SpellSlotArray> = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

// ── Половинный заклинатель (Паладин, Рейнджер) ──

/**
 * Таблица ячеек для половинного заклинателя (PHB 2024).
 *
 * С первого уровня, а не со второго: в редакции 2024 паладин и следопыт
 * получают «Использование заклинаний» сразу — их таблицы дают на 1 уровне две
 * ячейки 1 круга и два подготовленных заклинания.
 */
export const HALF_CASTER_SLOTS: Record<number, SpellSlotArray> = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  4: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  6: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  8: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  9: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  10: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  11: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  12: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  13: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  14: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  15: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  16: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  17: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  18: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  19: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  20: [4, 3, 3, 3, 2, 0, 0, 0, 0],
};

// ── Третичный заклинатель (Мистический ловкач, Волшебный рыцарь) ──

/** Таблица ячеек для третичного заклинателя (PHB 2024) */
export const THIRD_CASTER_SLOTS: Record<number, SpellSlotArray> = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  4: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  5: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  6: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  7: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  8: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  9: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  10: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  11: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  12: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  13: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  14: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  15: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  16: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  17: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  18: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  19: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  20: [4, 3, 3, 1, 0, 0, 0, 0, 0],
};

// ── Пакт (Колдун) ──

/** Таблица ячеек для колдуна: уровень → [количество, круг] */
export const PACT_SLOTS: Record<number, { count: number; level: number }> = {
  1: { count: 1, level: 1 },
  2: { count: 2, level: 1 },
  3: { count: 2, level: 2 },
  4: { count: 2, level: 2 },
  5: { count: 2, level: 3 },
  6: { count: 2, level: 3 },
  7: { count: 2, level: 4 },
  8: { count: 2, level: 4 },
  9: { count: 2, level: 5 },
  10: { count: 2, level: 5 },
  11: { count: 3, level: 5 },
  12: { count: 3, level: 5 },
  13: { count: 3, level: 5 },
  14: { count: 3, level: 5 },
  15: { count: 3, level: 5 },
  16: { count: 3, level: 5 },
  17: { count: 4, level: 5 },
  18: { count: 4, level: 5 },
  19: { count: 4, level: 5 },
  20: { count: 4, level: 5 },
};

/** Пустой массив ячеек (нет заклинаний) */
const EMPTY_SLOTS: SpellSlotArray = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Свежая копия набора ячеек. Копия обязательна: строки таблиц — общие
 * константы, и правка ячеек одного листа разошлась бы по всем остальным.
 *
 * Копируется поэлементно, а не спредом: спред отдаёт `number[]` без длины,
 * и набор из девяти кругов пришлось бы объявлять приведением типа.
 *
 * @param slots - строка таблицы ячеек
 * @returns независимая копия набора ячеек
 */
function copySlots(slots: SpellSlotArray): SpellSlotArray {
  return [
    slots[0],
    slots[1],
    slots[2],
    slots[3],
    slots[4],
    slots[5],
    slots[6],
    slots[7],
    slots[8],
  ];
}

// ── Маппинг тип заклинателя → таблица ──

/**
 * Вклад класса в уровень заклинателя мультикласса (правила D&D 2024).
 *
 * Округление у половинных и треть-заклинателей РАЗНОЕ, и это не описка: так
 * ложатся таблицы прогрессии 2024. Паладин 5 идёт за заклинателя 3 (его
 * собственная таблица даёт 4/2 ячейки — ровно строка 3 общей таблицы), а
 * мистический ловкач 5 — за заклинателя 1.
 *
 * Колдун в счёт не идёт: его Магия договора существует отдельно от общих ячеек.
 *
 * @param casterType - тип заклинателя класса
 * @param level - уровень в этом классе
 * @returns вклад в уровень заклинателя мультикласса
 */
function getCasterLevelContribution(
  casterType: CasterType,
  level: number,
): number {
  switch (casterType) {
    case 'full':
      return level;
    case 'half':
      return Math.ceil(level / 2);
    case 'third':
      return Math.floor(level / 3);
    default:
      return 0;
  }
}

/**
 * Получает таблицу ячеек по типу заклинателя
 *
 * @param casterType - тип заклинателя
 */
function getSlotTable(
  casterType: CasterType,
): Record<number, SpellSlotArray> | null {
  switch (casterType) {
    case 'full':
      return FULL_CASTER_SLOTS;
    case 'half':
      return HALF_CASTER_SLOTS;
    case 'third':
      return THIRD_CASTER_SLOTS;
    default:
      return null;
  }
}

// ── Публичный API ────────────────────────────────────────────

/**
 * Получает ячейки заклинаний для одноклассового персонажа
 *
 * @param casterType - тип заклинателя
 * @param classLevel - уровень в классе
 * @returns массив ячеек [1-9 круг]
 */
export function getSpellSlots(
  casterType: CasterType,
  classLevel: number,
): SpellSlotArray {
  const table = getSlotTable(casterType);

  if (!table) {
    return copySlots(EMPTY_SLOTS);
  }

  const clampedLevel = Math.max(1, Math.min(20, classLevel));

  return copySlots(table[clampedLevel] ?? EMPTY_SLOTS);
}

/**
 * Вычисляет caster level для мультикласса (правила D&D 2024).
 *
 * Полный заклинатель отдаёт весь свой уровень, половинный — половину с
 * округлением ВВЕРХ, треть-заклинатель — треть с округлением ВНИЗ. Магия
 * договора колдуна в счёт не идёт: её ячейки считаются отдельно.
 *
 * @param classes - массив классов актора
 * @param casterTypeMap - карта определений классов (key → CasterType)
 * @returns уровень заклинателя для таблицы мультикласса
 */
export function getMulticlassCasterLevel(
  classes: ActorClassEntry[],
  casterTypeMap: Map<string, CasterType>,
): number {
  let casterLevel = 0;

  for (const entry of classes) {
    const casterType = casterTypeMap.get(entry.classKey) ?? 'none';

    casterLevel += getCasterLevelContribution(casterType, entry.level);
  }

  return casterLevel;
}

/**
 * Вычисляет итоговые ячейки заклинаний для персонажа.
 *
 * Один класс — своя таблица класса. Мультикласс — ОДИН общий запас: ячейки
 * классов не складываются построчно, вместо этого по классам считается уровень
 * заклинателя и по нему берётся строка {@link MULTICLASS_CASTER_SLOTS}.
 *
 * Ячейки договора колдуна сюда не входят — они считаются отдельно
 * ({@link PACT_SLOTS}) и восстанавливаются коротким отдыхом.
 *
 * @param classes - массив классов актора
 * @param casterTypeMap - карта classKey → CasterType
 * @returns массив ячеек [1-9 круг]
 */
export function computeSpellSlots(
  classes: ActorClassEntry[],
  casterTypeMap: Map<string, CasterType>,
): SpellSlotArray {
  if (classes.length === 0) {
    return copySlots(EMPTY_SLOTS);
  }

  // Одноклассовый — используем таблицу конкретного типа
  if (classes.length === 1) {
    const casterType = casterTypeMap.get(classes[0].classKey) ?? 'none';

    return getSpellSlots(casterType, classes[0].level);
  }

  // Мультикласс — один общий запас по таблице мультиклассового заклинателя
  const casterLevel = getMulticlassCasterLevel(classes, casterTypeMap);

  if (casterLevel === 0) {
    return copySlots(EMPTY_SLOTS);
  }

  return copySlots(MULTICLASS_CASTER_SLOTS[casterLevel] ?? EMPTY_SLOTS);
}

/**
 * Карта «ключ класса → тип заклинателя» для расчёта ячеек. Класс без типа в
 * карту не попадает — таблицы считают его незаклинателем.
 *
 * @param classes - классы листа
 * @returns карта типов заклинателя по ключу класса
 */
export function buildCasterTypeMap(
  classes: readonly ActorClassEntry[],
): Map<string, CasterType> {
  const casterTypeMap = new Map<string, CasterType>();

  for (const entry of classes) {
    if (entry.casterType) {
      casterTypeMap.set(entry.classKey, entry.casterType);
    }
  }

  return casterTypeMap;
}

/**
 * Разбирает свои бонусы к ячейкам из записи актёра. Список всегда из девяти
 * кругов: мир мог прийти импортом руками, и короткий список сдвинул бы круги.
 *
 * @param value - поле `spellSlotSettings`; нет — бонусов нет
 * @returns бонусы по девяти кругам
 */
export function parseSpellSlotSettings(value: unknown): DnDSpellSlotSettings {
  const stored =
    isRecord(value) && Array.isArray(value.levels) ? value.levels : [];

  return {
    levels: Array.from({ length: MAX_SPELL_SLOT_LEVEL }, (_unused, index) =>
      parseCustomBonuses(stored[index]),
    ),
  };
}

/**
 * Выправляет бонусы перед записью в актёра: числа приходят из полей окна.
 *
 * @param settings - бонусы из окна
 * @returns бонусы с числами в допустимых границах
 */
export function toStoredSpellSlotSettings(
  settings: DnDSpellSlotSettings,
): DnDSpellSlotSettings {
  return {
    levels: settings.levels.map((bonuses) => bonuses.map(toStoredCustomBonus)),
  };
}

/**
 * Числа листа, от которых считаются свои бонусы к ячейкам, — по записи листа.
 * Вкладка передаёт свои числа с учётом эффектов; здесь запасной путь для
 * проверок, у которых итоговых статов под рукой нет.
 *
 * @param actor - лист персонажа
 * @returns модификаторы характеристик и бонус мастерства
 */
function getSpellSlotBonusContext(actor: DnDActor): DnDCustomBonusContext {
  return {
    abilityMods: getActorAbilityModifiers(actor),
    proficiencyBonus: getActorProficiencyBonus(actor),
  };
}

/**
 * Накладывает свои бонусы на ячейки классов. Итог круга не опускается ниже
 * нуля: отрицательный бонус убирает ячейки класса, но не больше, чем есть.
 *
 * @param classSlots - ячейки по таблицам классов
 * @param settings - бонусы листа как есть в записи
 * @param context - числа листа, от которых считаются бонусы
 * @returns ячейки с бонусами
 */
export function applySpellSlotSettings(
  classSlots: SpellSlotArray,
  settings: unknown,
  context: DnDCustomBonusContext,
): SpellSlotArray {
  const { levels } = parseSpellSlotSettings(settings);
  const slots = copySlots(classSlots);

  levels.forEach((bonuses, index) => {
    slots[index] = Math.max(
      0,
      slots[index] + getCustomBonusesValue(context, bonuses),
    );
  });

  return slots;
}

/**
 * Ячейки листа: таблицы классов и свои бонусы поверх. Этим числом живут
 * пузырьки вкладки, выбор круга при касте и проверка «ячейка есть».
 *
 * @param actor - лист персонажа
 * @param context - числа листа для бонусов; нет — считаются по записи листа
 * @returns итоговые ячейки [1-9 круг]
 */
export function computeActorSpellSlots(
  actor: DnDActor,
  context?: DnDCustomBonusContext,
): SpellSlotArray {
  const classes = actor.system?.classes ?? [];

  return applySpellSlotSettings(
    computeSpellSlots(classes, buildCasterTypeMap(classes)),
    actor.system?.spellSlotSettings,
    context ?? getSpellSlotBonusContext(actor),
  );
}

/**
 * Проверяет, осталась ли у персонажа ячейка выбранного круга и вида. Ячейка
 * договора подходит только своему кругу; обычная считается по таблице классов.
 *
 * @param actor - лист персонажа с классами и расходом ячеек
 * @param castLevel - круг ячейки (1–9)
 * @param isPactSlot - тратится ячейка договора колдуна
 * @param context - числа листа для своих бонусов к ячейкам; нет — по записи
 * @returns true — ячейка есть
 */
export function hasAvailableSpellSlot(
  actor: DnDActor,
  castLevel: number,
  isPactSlot: boolean,
  context?: DnDCustomBonusContext,
): boolean {
  const classes = actor.system?.classes ?? [];

  if (isPactSlot) {
    const pactInfo = getPactSlotInfo(classes);

    return (
      castLevel === pactInfo.level
      && (actor.system?.pactSlotsUsed ?? 0) < pactInfo.max
    );
  }

  const maxSlots = computeActorSpellSlots(actor, context);
  const slotIndex = castLevel - 1;

  return (
    (actor.system?.spellSlotsUsed?.[slotIndex] ?? 0)
    < (maxSlots[slotIndex] ?? 0)
  );
}

/**
 * Наибольший круг, который персонаж способен наложить.
 *
 * Ячейки договора колдуна учитываются наравне с обычными: заклинание шестого круга
 * колдун 11 уровня накладывает, пусть и своей ячейкой.
 *
 * @param actor - лист персонажа
 * @param context - числа листа для своих бонусов к ячейкам; нет — по записи
 * @returns наибольший доступный круг; 0 — ячеек нет, доступны только заговоры
 */
export function getMaxSpellSlotLevel(
  actor: DnDActor,
  context?: DnDCustomBonusContext,
): number {
  const classes = actor.system?.classes ?? [];
  const slots = computeActorSpellSlots(actor, context);

  let maxLevel = 0;

  slots.forEach((count, index) => {
    if (count > 0) {
      maxLevel = index + 1;
    }
  });

  const pactClass = classes.find((entry) => entry.casterType === 'pact');
  const pactInfo = pactClass ? PACT_SLOTS[pactClass.level] : undefined;

  return pactInfo && pactInfo.level > maxLevel ? pactInfo.level : maxLevel;
}

/**
 * Получает список доступных кругов заклинаний для актора, начиная с `minLevel`.
 *
 * @param actor - лист персонажа
 * @param minLevel - наименьший круг заклинания
 * @param maxAvailableLevel - наибольший круг для листа без ячеек
 * @param context - числа листа для своих бонусов к ячейкам; нет — по записи
 * @returns доступные круги по возрастанию
 */
export function getAvailableSpellLevels(
  actor: DnDActor,
  minLevel: number,
  maxAvailableLevel: number = 9,
  context?: DnDCustomBonusContext,
): number[] {
  if (minLevel <= 0) {
    return [0];
  }

  let hasAnyMaxSlots = false;

  const availableLevels = new Set<number>();

  // 1. Проверяем Pact Slots
  const pactClass = (actor.system?.classes ?? []).find(
    (entry) => entry.casterType === 'pact',
  );

  if (pactClass) {
    const pactInfo = PACT_SLOTS[pactClass.level];

    if (pactInfo) {
      hasAnyMaxSlots = true;

      if (pactInfo.level >= minLevel) {
        const pactUsed = actor.system?.pactSlotsUsed ?? 0;

        if (pactUsed < pactInfo.count) {
          availableLevels.add(pactInfo.level);
        }
      }
    }
  }

  // 2. Проверяем обычные ячейки
  const maxSlots = computeActorSpellSlots(actor, context);
  const usedSlots = actor.system?.spellSlotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];

  for (let i = 0; i < 9; i++) {
    if ((maxSlots[i] ?? 0) > 0) {
      hasAnyMaxSlots = true;

      break;
    }
  }

  // Если у актора вообще нет ячеек - считаем, что это NPC / Врождённый каст,
  // разрешаем каст на любом доступном круге.
  if (!hasAnyMaxSlots) {
    const levels = [];

    for (let i = minLevel; i <= maxAvailableLevel; i++) {
      levels.push(i);
    }

    return levels;
  }

  for (let i = minLevel - 1; i < 9; i++) {
    const max = maxSlots[i] ?? 0;
    const used = usedSlots[i] ?? 0;

    if (max > 0 && used < max) {
      availableLevels.add(i + 1);
    }
  }

  return Array.from(availableLevels).sort((left, right) => left - right);
}

/**
 * Возвращает информацию о Pact-слотах для актора (Warlock).
 *
 * Использует таблицу PACT_SLOTS для определения уровня и количества ячеек.
 *
 * @param classes - массив классов актора
 * @returns объект с максимальным количеством и уровнем Pact-слотов
 */
export function getPactSlotInfo(
  classes: ReadonlyArray<{ casterType?: string; level: number }>,
): { max: number; level: number } {
  const pactClass = classes.find((entry) => entry.casterType === 'pact');

  if (!pactClass) {
    return { max: 0, level: 0 };
  }

  const pactInfo = PACT_SLOTS[pactClass.level];

  if (!pactInfo) {
    return { max: 0, level: 0 };
  }

  return { max: pactInfo.count, level: pactInfo.level };
}
