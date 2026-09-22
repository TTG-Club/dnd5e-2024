/**
 * Поправки листа к пределу подготовки заклинаний и заговоров.
 *
 * Число класса даёт `preparedSpells`, а лист правит его одним из двух способов:
 * своё число вместо подсчёта либо свои бонусы сверху — теми же строками, что у
 * инициативы, спасбросков и мастерства: число, модификатор характеристики или
 * бонус мастерства («+мод. Мудрости» от черты, «+2» от предмета).
 *
 * @module system/dnd/preparedLimit
 */

import type { DnDCustomBonusContext } from './customBonuses.js';
import type { DnDPreparedLimit } from './types.js';

import { isRecord } from '@vtt/shared';

import {
  getCustomBonusesValue,
  NEW_CUSTOM_BONUS,
  parseCustomBonuses,
  toStoredCustomBonus,
} from './customBonuses.js';
import {
  DEFAULT_PREPARED_LIMIT,
  PREPARED_LIMIT_MAX,
  PREPARED_LIMIT_MIN,
} from './preparedSpells.js';

/**
 * Идентификатор строки, в которую превращается старое число `bonus`: миры до
 * списка бонусов хранили прибавку одним числом.
 */
export const LEGACY_PREPARED_BONUS_ID = 'prepared-legacy-bonus';

/** Разбор предела подготовки — для плитки вкладки и модалки настройки */
export interface PreparedLimitBreakdown {
  /** Итоговый предел; null — ни таблица, ни своё число его не задают */
  value: number | null;
  /** Число из таблицы класса; null — колонки нет */
  classValue: number | null;
  /** Предел задан своим числом, подсчёт по классу выключен */
  custom: boolean;
  /** Суммарный вклад своих бонусов к числу класса; 0 — бонусов нет */
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
 * Разбирает настройку предела из записи актёра.
 *
 * Старое число `bonus` становится строкой «своё число» — прибавка, заданная до
 * списка бонусов, не пропадает. Если список уже есть, число не читается: его
 * место занял список, и сложились бы оба.
 *
 * @param value - поле `preparedSpells` либо `preparedCantrips`; нет — всё по
 *   таблице класса
 * @returns настройка предела
 */
export function parsePreparedLimit(value: unknown): DnDPreparedLimit {
  if (!isRecord(value)) {
    return { ...DEFAULT_PREPARED_LIMIT };
  }

  const custom =
    typeof value.custom === 'number' && Number.isFinite(value.custom)
      ? value.custom
      : null;

  if (Array.isArray(value.bonuses)) {
    return { custom, bonuses: parseCustomBonuses(value.bonuses) };
  }

  const legacyBonus =
    typeof value.bonus === 'number' && Number.isFinite(value.bonus)
      ? Math.trunc(value.bonus)
      : 0;

  return {
    custom,
    bonuses:
      legacyBonus === 0
        ? []
        : [
            {
              ...NEW_CUSTOM_BONUS,
              id: LEGACY_PREPARED_BONUS_ID,
              value: legacyBonus,
            },
          ],
  };
}

/**
 * Разбор предела подготовки: число класса со своими бонусами либо своё число
 * вместо подсчёта.
 *
 * @param classValue - число из таблиц классов; null — колонки нет
 * @param limit - настройка листа как есть в записи; нет — всё по классу
 * @param context - числа листа, от которых считаются свои бонусы
 * @returns разбор для плитки вкладки и модалки настройки
 */
export function getPreparedLimitBreakdown(
  classValue: number | null,
  limit: unknown,
  context: DnDCustomBonusContext,
): PreparedLimitBreakdown {
  const { custom, bonuses } = parsePreparedLimit(limit);
  const bonus = getCustomBonusesValue(context, bonuses);

  // Класс подготовку не считает: бонусы прибавлять не к чему, предел остаётся
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
    bonuses: limit.bonuses.map(toStoredCustomBonus),
  };
}
