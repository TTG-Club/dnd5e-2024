/**
 * Пределы подготовки заклинаний и заговоров D&D 5e (PHB 2024).
 *
 * Число берётся из таблицы класса компендиума на уровне персонажа в этом классе
 * (у мультикласса — сумма по всем классам), а лист даёт его поправить: задать
 * своё число вместо расчёта или прибавить бонус (черта, предмет, домашнее
 * правило).
 *
 * @module system/dnd/preparedSpells
 */

import type { ActorClassEntry, ClassDefinition } from './classTypes.js';
import type { DnDPreparedLimit } from './types.js';

/** Вид подготовки: заклинания книги либо заговоры (свой счётчик) */
export type PreparedKind = 'spells' | 'cantrips';

/** Минимальное число подготовленных */
export const PREPARED_LIMIT_MIN = 0;

/** Максимальное число подготовленных */
export const PREPARED_LIMIT_MAX = 99;

/** Минимальный бонус к числу из таблицы класса */
export const PREPARED_LIMIT_BONUS_MIN = -99;

/** Максимальный бонус к числу из таблицы класса */
export const PREPARED_LIMIT_BONUS_MAX = 99;

/** Предел неизвестен: таблица класса такой колонки не даёт */
export const PREPARED_LIMIT_EMPTY_VALUE = '—';

/** Настройка предела по умолчанию: всё считается по таблице класса */
export const DEFAULT_PREPARED_LIMIT: DnDPreparedLimit = {
  custom: null,
  bonus: 0,
};

/**
 * Известные ключи колонок таблицы класса по виду подготовки.
 *
 * Их несколько, потому что паки писались разными способами: у SRD-классов ключ
 * английский и осмысленный (`cantripsKnown`), а у паков TTG Club он получается
 * транслитерацией русской подписи колонки (`zagovory`, `podg-zakl`).
 */
const PREPARED_COLUMN_KEYS: Record<PreparedKind, string[]> = {
  spells: ['preparedSpells', 'podg-zakl'],
  cantrips: ['cantripsKnown', 'knownCantrips', 'zagovory', 'zag'],
};

/**
 * Приводит подпись колонки к виду для сравнения: паки пишут её как придётся —
 * «Заговоры», «Заг.», «Подг. Закл.», «Подг. закл», — и различаются они только
 * регистром и точками.
 *
 * @param label - подпись колонки
 * @returns подпись в нижнем регистре без пробелов по краям
 */
function normalizeColumnLabel(label: string): string {
  return label.trim().toLowerCase().replace(/ё/g, 'е');
}

/**
 * Подходит ли колонка под нужный вид подготовки по своей подписи. Ключ у таких
 * колонок непредсказуем (транслитерация), а подпись человек пишет узнаваемо.
 *
 * @param label - подпись колонки
 * @param kind - вид подготовки
 * @returns true, если колонка про этот вид подготовки
 */
function matchesColumnLabel(label: string, kind: PreparedKind): boolean {
  const normalized = normalizeColumnLabel(label);

  if (kind === 'cantrips') {
    return normalized.startsWith('заговор') || normalized.startsWith('заг.');
  }

  return normalized.startsWith('подг');
}

/**
 * Ключи, под которыми в строках таблицы этого класса может лежать нужное число:
 * известные ключи плюс те, что объявлены в колонках самого класса.
 *
 * @param definition - определение класса
 * @param kind - вид подготовки
 * @returns ключи для поиска в строке таблицы
 */
function resolveColumnKeys(
  definition: ClassDefinition,
  kind: PreparedKind,
): string[] {
  const keys = [...PREPARED_COLUMN_KEYS[kind]];

  for (const column of definition.tableColumns ?? []) {
    if (column.key && matchesColumnLabel(column.label, kind)) {
      keys.push(column.key);
    }
  }

  return keys;
}

/**
 * Число из ячейки таблицы. Паки пишут значения строками («3»), а прочерк
 * означает «в этой строке значения нет».
 *
 * @param value - значение ячейки
 * @returns число или null
 */
function parseCellNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed === '—' || trimmed === '-') {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Запасные таблицы подготовленных заклинаний (PHB 2024) — по уровню класса.
 *
 * Нужны классам, чьё определение в компендиуме колонки подготовки не содержит:
 * без них лист показал бы прочерк там, где число в книге есть. Это именно
 * запасной путь — сначала всегда читается таблица самого класса.
 *
 * Полная взята у волшебника, половинная — у паладина и следопыта (у них она
 * общая). У жреца, друида, барда и чародея числа с 13 уровня чуть ниже
 * волшебничьих, поэтому запасной расчёт может их немного завысить — на этот
 * случай в плитке есть своё число и бонус.
 */
const FALLBACK_PREPARED: Record<'full' | 'half', number[]> = {
  full: [
    4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25,
  ],
  half: [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15],
};

/** Разбор предела подготовки — для плитки вкладки и модалки настройки */
export interface PreparedLimitBreakdown {
  /** Итоговый предел; null — ни таблица, ни своё число его не задают */
  value: number | null;
  /** Число из таблицы класса; null — колонки нет */
  classValue: number | null;
  /** Предел задан своим числом, подсчёт по классу выключен */
  custom: boolean;
  /** Бонус к числу класса; 0 — бонуса нет */
  bonus: number;
}

/**
 * Приводит число к целому в границах.
 *
 * @param value - исходное число
 * @param min - нижняя граница
 * @param max - верхняя граница
 * @returns целое число в границах
 */
function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return Math.min(max, Math.max(min, 0));
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Число из таблицы класса на нужном уровне.
 *
 * Ячейку ищем не только в строке уровня, но и в строках ниже: паки заполняют её
 * лишь там, где число МЕНЯЕТСЯ (у волшебника заговоры стоят на 1, 4 и 10 уровне,
 * а между ними пусто), и на 2 уровне действует значение с первого.
 *
 * @param definition - определение класса из компендиума
 * @param level - уровень персонажа в этом классе
 * @param kind - вид подготовки
 * @returns число из таблицы или null, если колонки нет
 */
function getLevelTableValue(
  definition: ClassDefinition,
  level: number,
  kind: PreparedKind,
): number | null {
  const columnKeys = resolveColumnKeys(definition, kind);

  // Строки ниже нужного уровня по убыванию: первая заполненная и есть текущее
  // значение колонки.
  const rows = (definition.levelTable ?? [])
    .filter((entry) => entry.level <= level)
    .sort((first, second) => second.level - first.level);

  for (const row of rows) {
    for (const columnKey of columnKeys) {
      const value = parseCellNumber(row[columnKey]);

      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Число подготовленных по таблицам классов актёра.
 *
 * У мультикласса каждый класс готовит по своей таблице и своему уровню в ней,
 * поэтому числа складываются. Классы без нужной колонки в сумму не входят —
 * иначе плитка показала бы число, которого таблицы не дают.
 *
 * Определение класса находит вызывающий: у записи актора есть не только ключ,
 * но и пак, и таблицу надо читать из той копии класса, которую выбрали, а не из
 * одноимённой в соседнем компендиуме.
 *
 * @param classes - классы актёра
 * @param resolveDefinition - определение класса по записи актора; undefined —
 *   записи нет ни в одном компендиуме
 * @param kind - вид подготовки
 * @returns число из таблиц или null, если его не даёт ни один класс
 */
export function getClassPreparedValue(
  classes: ActorClassEntry[],
  resolveDefinition: (entry: ActorClassEntry) => ClassDefinition | undefined,
  kind: PreparedKind,
): number | null {
  let total: number | null = null;

  for (const entry of classes) {
    const definition = resolveDefinition(entry);

    const tableValue = definition
      ? getLevelTableValue(definition, entry.level, kind)
      : null;

    if (tableValue !== null) {
      total = (total ?? 0) + tableValue;

      continue;
    }

    // Запасной расчёт — только для заклинаний книги и только у настоящего
    // заклинателя: у заговоров число в каждом классе своё, общей таблицы, из
    // которой его можно было бы вывести, в книге нет.
    if (kind === 'spells' && entry.casterType && entry.spellcastingAbility) {
      const fallbackTable =
        entry.casterType === 'full' || entry.casterType === 'half'
          ? FALLBACK_PREPARED[entry.casterType]
          : null;

      const fallbackValue = fallbackTable?.[entry.level - 1];

      if (fallbackValue !== undefined) {
        total = (total ?? 0) + fallbackValue;
      }
    }
  }

  return total;
}

/**
 * Разбор предела подготовки: число класса, свой бонус к нему либо своё число
 * вместо подсчёта.
 *
 * @param classValue - число из таблиц классов; null — колонки нет
 * @param limit - настройка листа; нет — всё считается по классу
 * @returns разбор для плитки вкладки и модалки настройки
 */
export function getPreparedLimitBreakdown(
  classValue: number | null,
  limit?: DnDPreparedLimit | null,
): PreparedLimitBreakdown {
  const { custom, bonus } = limit ?? DEFAULT_PREPARED_LIMIT;

  // Класс подготовку не считает: бонус прибавлять не к чему, предел остаётся
  // неизвестным, пока игрок не задаст своё число.
  const autoValue =
    classValue === null
      ? null
      : clampInteger(
          classValue + bonus,
          PREPARED_LIMIT_MIN,
          PREPARED_LIMIT_MAX,
        );

  const customValue =
    custom === null
      ? null
      : clampInteger(custom, PREPARED_LIMIT_MIN, PREPARED_LIMIT_MAX);

  return {
    value: customValue ?? autoValue,
    classValue,
    custom: custom !== null,
    bonus,
  };
}

/**
 * Выправляет настройку предела перед записью в актёра: числа приходят из полей
 * модалки, а мир мог прийти и импортом руками.
 *
 * @param limit - настройка из модалки
 * @returns настройка с числами в допустимых границах
 */
export function normalizePreparedLimit(
  limit: DnDPreparedLimit,
): DnDPreparedLimit {
  return {
    custom:
      limit.custom === null
        ? null
        : clampInteger(limit.custom, PREPARED_LIMIT_MIN, PREPARED_LIMIT_MAX),
    bonus: clampInteger(
      limit.bonus,
      PREPARED_LIMIT_BONUS_MIN,
      PREPARED_LIMIT_BONUS_MAX,
    ),
  };
}
