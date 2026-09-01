/**
 * Ресурс в правке — одна модель на всех, кто его заводит: класс, его умение,
 * подкласс, черта и вид. Форма создания ресурса везде одна, а различается
 * только хранилище: у класса это его счётчики (уровень появления, колонка
 * таблицы), у остальных — ресурс блока даров.
 *
 * Поля, которых у чужого хранилища нет, в правке всё равно есть: без них
 * пришлось бы держать две модели и два редактора, и они бы разошлись при первой
 * же правке. Сборка записи лишнее просто не пишет.
 */

import type { CounterRecovery } from '@vtt/shared/system/dnd.js';

import { generateId } from '@vtt/shared';
import { COUNTER_FORMULA_TOKENS } from '@vtt/shared/system/dnd.js';

/** Ступень максимума в правке: `uid` держит строку списка при перестановках. */
export interface EditableProgressionEntry {
  uid: string;
  /** Уровень, с которого действует значение */
  level: number;
  /** Максимум ЦЕЛИКОМ на этом уровне, а не прибавка */
  value: number;
}

/** Ресурс в правке. */
export interface EditableResourceCounter {
  /** Ключ строки редактора; в запись не уходит */
  uid: string;
  /** Стабильный ключ ресурса в пределах записи */
  key: string;
  name: string;
  shortName: string;
  /** Формула максимума; при заданных ступенях не считается */
  max: string;
  /**
   * Нижняя граница максимума; 0 — границы нет. Подпирает расчёт снизу:
   * вдохновение барда равно модификатору Харизмы, но не меньше одного.
   */
  min: number;
  recovery: CounterRecovery;
  /** Ступени максимума по уровням; пусто — максимум считается формулой */
  progression: EditableProgressionEntry[];
  /** Уровень появления ресурса. Есть только у счётчика класса */
  startLevel: number;
  /** Показывать ресурс колонкой таблицы прогрессии. Только у счётчика класса */
  showInTable: boolean;
}

/**
 * Свободный ключ ресурса: подпись у ресурса русская, а машинный ключ обязан
 * остаться латиницей, поэтому он строится из слова и номера.
 *
 * @param taken - уже занятые ключи записи
 * @returns ключ вида `resource-1`
 */
function freeCounterKey(taken: ReadonlySet<string>): string {
  let index = 1;

  while (taken.has(`resource-${index}`)) {
    index += 1;
  }

  return `resource-${index}`;
}

/**
 * Новый ресурс со значениями по умолчанию.
 *
 * Максимум по умолчанию — бонус мастерства: так устроено большинство ресурсов,
 * которые заводят руками, и он растёт вместе с персонажем сам.
 *
 * @param taken - занятые ключи записи
 * @returns ресурс для строки редактора
 */
export function createResourceCounter(
  taken: ReadonlySet<string>,
): EditableResourceCounter {
  return {
    uid: generateId('counter'),
    key: freeCounterKey(taken),
    name: '',
    shortName: '',
    max: COUNTER_FORMULA_TOKENS.proficiencyBonus,
    min: 0,
    recovery: 'long',
    progression: [],
    startLevel: 1,
    showInTable: false,
  };
}

/**
 * Новая ступень ресурса. Уровень берётся от уровня появления: первая ступень
 * почти всегда совпадает с ним, а править её всё равно можно.
 *
 * @param counter - ресурс, к которому добавляют ступень
 * @returns ступень для строки редактора
 */
export function createProgressionEntry(
  counter: EditableResourceCounter,
): EditableProgressionEntry {
  const last = counter.progression[counter.progression.length - 1];

  return {
    uid: generateId('cpe'),
    level: last ? Math.min(20, last.level + 1) : counter.startLevel,
    value: last ? last.value + 1 : 1,
  };
}

/**
 * Разворачивает ступени записи в строки редактора, по возрастанию уровня.
 *
 * @param progression - максимум по уровням: ключ — уровень строкой
 * @returns строки ступеней; пусто — ступеней у записи нет
 */
export function progressionToEntries(
  progression: Record<string, number> | undefined,
): EditableProgressionEntry[] {
  return Object.entries(progression ?? {})
    .map(([levelKey, value]) => ({
      uid: generateId('cpe'),
      level: Number(levelKey) || 1,
      value,
    }))
    .sort((entryA, entryB) => entryA.level - entryB.level);
}

/**
 * Собирает ступени записи из строк редактора.
 *
 * @param entries - строки ступеней
 * @returns максимум по уровням; `undefined` — ступеней нет
 */
export function entriesToProgression(
  entries: ReadonlyArray<EditableProgressionEntry>,
): Record<string, number> | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const progression: Record<string, number> = {};

  for (const entry of entries) {
    progression[String(entry.level)] = entry.value;
  }

  return progression;
}
