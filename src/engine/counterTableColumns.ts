/**
 * Колонка таблицы прогрессии, выведенная из ресурса класса.
 *
 * Ресурс живёт счётчиком, а в книге его ряд по уровням привычнее читать колонкой
 * таблицы («Ярости», «Кости превосходства»). Дублировать этот ряд руками автору
 * не нужно: у счётчика он уже задан — прогрессией по уровням либо формулой, — и
 * колонка собирается из него, когда автор отметил `showInTable`.
 *
 * Колонка выводится, только если ряд считается от одного уровня: прогрессия,
 * число, `@prof` и `@level` (с множителем и смещением). Максимум по модификатору
 * характеристики (`@mod.cha`) зависит от персонажа, а не от уровня, и одинакового
 * ряда для всех у него нет — такой ресурс колонкой не показывается.
 *
 * Считается при показе, а не хранится в записи класса: иначе колонка разошлась бы
 * с ресурсом при первой же его правке, а редактор показал бы её своей.
 *
 * @module system/dnd/counterTableColumns
 */

import type {
  ClassCounterDefinition,
  ClassLevelEntry,
  ClassTableColumnDefinition,
} from './classTypes.js';
import type { FeatChoice } from './featTypes.js';

import { calculateProficiencyBonus } from './calculations.js';
import { COUNTER_FORMULA_TOKENS } from './counterResource.js';

/** Наибольший уровень персонажа: дальше таблица прогрессии не идёт. */
const MAX_LEVEL = 20;

/** Формула максимума: источник с необязательными множителем и смещением. */
const FORMULA_PATTERN =
  /^(@prof|@level|\d+)\s*(?:\*\s*(\d+)\s*)?(?:([+-])\s*(\d+))?$/;

/** Таблица прогрессии вместе с выведенными колонками ресурсов. */
export interface CounterTable {
  levelTable: ClassLevelEntry[];
  tableColumns: ClassTableColumnDefinition[];
}

/**
 * Значения ресурса по уровням; null — ряд от уровня не считается.
 *
 * Прогрессия старше формулы: ряд, который формулой не пишется, задан ею же и
 * точнее любого выражения. Ступень держится до следующей, а до уровня, с
 * которого ресурс появляется ({@link ClassCounterDefinition.startLevel}), его
 * нет вовсе.
 *
 * @param counter - определение счётчика
 * @returns значения по уровням; null — ряд от уровня не считается
 */
export function counterValuesByLevel(
  counter: ClassCounterDefinition,
): Record<number, number> | null {
  const startLevel = Math.max(1, counter.startLevel || 1);

  return (
    progressionValues(counter, startLevel) ?? formulaValues(counter, startLevel)
  );
}

/**
 * Значения по прогрессии счётчика.
 *
 * @param counter - определение счётчика
 * @param startLevel - уровень, с которого ресурс есть у персонажа
 * @returns значения по уровням; null — прогрессии нет
 */
function progressionValues(
  counter: ClassCounterDefinition,
  startLevel: number,
): Record<number, number> | null {
  const steps = Object.entries(counter.progression ?? {})
    .map(([level, max]) => ({ level: Number(level), max }))
    .filter((step) => Number.isFinite(step.level))
    .sort((first, second) => first.level - second.level);

  if (steps.length === 0) {
    return null;
  }

  const values: Record<number, number> = {};

  let current: number | null = null;

  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const step of steps) {
      if (step.level <= level) {
        current = step.max;
      }
    }

    if (current !== null && level >= startLevel) {
      values[level] = withMinimum(current, counter);
    }
  }

  return values;
}

/**
 * Значения по формуле максимума: число, бонус мастерства и уровень персонажа с
 * множителем и смещением. Прочие формулы зависят не от уровня — их ряда нет.
 *
 * @param counter - определение счётчика
 * @param startLevel - уровень, с которого ресурс есть у персонажа
 * @returns значения по уровням; null — формула от уровня не считается
 */
function formulaValues(
  counter: ClassCounterDefinition,
  startLevel: number,
): Record<number, number> | null {
  const formula = counter.formula?.trim().toLowerCase() ?? '';
  const match = FORMULA_PATTERN.exec(formula);

  if (!formula || !match) {
    return null;
  }

  const source = match[1];
  const multiplier = match[2] === undefined ? 1 : Number(match[2]);

  const offset =
    match[4] === undefined ? 0 : Number(match[4]) * (match[3] === '-' ? -1 : 1);

  const values: Record<number, number> = {};

  for (let level = Math.max(1, startLevel); level <= MAX_LEVEL; level++) {
    const base = sourceValue(source, level);

    values[level] = Math.max(
      0,
      withMinimum(base * multiplier + offset, counter),
    );
  }

  return values;
}

/**
 * Значение источника формулы на уровне.
 *
 * @param source - источник максимума
 * @param level - уровень персонажа
 */
function sourceValue(source: string | undefined, level: number): number {
  if (source === COUNTER_FORMULA_TOKENS.proficiencyBonus) {
    return calculateProficiencyBonus(level);
  }

  return source === COUNTER_FORMULA_TOKENS.level ? level : Number(source);
}

/**
 * Максимум с оглядкой на нижнюю границу ресурса: она подпирает ряд снизу.
 *
 * @param value - посчитанный максимум
 * @param counter - определение счётчика
 */
function withMinimum(value: number, counter: ClassCounterDefinition): number {
  return counter.min && counter.min > 0 ? Math.max(value, counter.min) : value;
}

/**
 * Значения выбора по уровням: сколько всего выбрано к каждому уровню.
 *
 * Ступень держится до следующей, а до уровня открытия выбора его нет вовсе.
 *
 * @param choice - выбор механики
 * @returns значения по уровням; null — ступеней нет
 */
export function choiceValuesByLevel(
  choice: FeatChoice,
): Record<number, number> | null {
  const steps = Object.entries(choice.scaling ?? {})
    .map(([level, count]) => ({ level: Number(level), count }))
    .filter((step) => Number.isFinite(step.level) && step.count > 0)
    .sort((first, second) => first.level - second.level);

  if (steps.length === 0) {
    return null;
  }

  const startLevel = Math.max(1, choice.requiredLevel ?? 1);
  const values: Record<number, number> = {};

  let current: number | null = null;

  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const step of steps) {
      if (step.level <= level) {
        current = step.count;
      }
    }

    if (current !== null && level >= startLevel) {
      values[level] = current;
    }
  }

  return values;
}

/**
 * Таблица прогрессии, дополненная колонками отмеченных ресурсов.
 *
 * Ресурс, у которого колонка уже есть в записи, второй раз не показывается: ключ
 * у них один и тот же.
 *
 * @param table - таблица уровней записи
 * @param columns - колонки, заданные в записи
 * @param counters - счётчики ресурсов записи
 * @param choices - выборы даров записи и её умений
 * @returns таблица и колонки для показа
 */
export function withCounterTableColumns(
  table: ClassLevelEntry[],
  columns: ClassTableColumnDefinition[],
  counters: ClassCounterDefinition[] | undefined,
  choices: FeatChoice[] = [],
): CounterTable {
  const takenKeys = new Set(
    columns.map((column) => column.key).filter((key): key is string => !!key),
  );

  const derived: ClassTableColumnDefinition[] = [];
  const valuesByKey = new Map<string, Record<number, number>>();

  for (const counter of counters ?? []) {
    if (!counter.showInTable || !counter.key || takenKeys.has(counter.key)) {
      continue;
    }

    const values = counterValuesByLevel(counter);

    if (!values) {
      continue;
    }

    takenKeys.add(counter.key);
    valuesByKey.set(counter.key, values);

    // Краткое название старше полного: колонка таблицы узкая, и «БК» в шапке
    // читается лучше «Божественного канала»
    derived.push({
      key: counter.key,
      label: counter.shortName || counter.name || counter.key,
    });
  }

  for (const choice of choices) {
    if (!choice.showInTable || !choice.key || takenKeys.has(choice.key)) {
      continue;
    }

    const values = choiceValuesByLevel(choice);

    if (!values) {
      continue;
    }

    takenKeys.add(choice.key);
    valuesByKey.set(choice.key, values);

    derived.push({
      key: choice.key,
      label: choice.shortName || choice.label || choice.key,
    });
  }

  if (derived.length === 0) {
    return { levelTable: table, tableColumns: columns };
  }

  const levelTable = table.map((row) => {
    const extended: ClassLevelEntry = { ...row };

    for (const [key, values] of valuesByKey) {
      const value = values[row.level];

      if (value !== undefined) {
        extended[key] = value;
      }
    }

    return extended;
  });

  return { levelTable, tableColumns: [...columns, ...derived] };
}
