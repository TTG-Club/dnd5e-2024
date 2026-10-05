/**
 * Общие куски схем эффекта: число из поля формы, Сл источника, Сл формулой и
 * характеристики спасброска.
 *
 * Ими пользуются и схема самого эффекта (`activeEffectTypes.ts`), и схемы его
 * блоков, которые она в себя включает (`effectCastRuleTypes.ts`). Блоку нельзя
 * брать их из схемы эффекта — та сама его импортирует, и круг импортов оставил
 * бы константы несозданными к моменту разбора. Поэтому они лежат здесь, в
 * модуле без зависимостей от схем.
 *
 * @module system/dnd/effectSchemaParts
 */

import { z } from 'zod';

/** Сл в данных, которая значит «Сл источника» (поле показывает «Авто») */
export const SOURCE_SAVE_DC = 0;

/** Характеристики спасброска (для Zod-валидации эффекта) */
export const SAVE_ABILITY_VALUES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

/**
 * Читает число из поля формы: число как есть, строку с числом — числом.
 *
 * Поле ввода числа отдаёт пустую строку, когда его очистили, а без
 * модификатора `.number` — строку с числом.
 *
 * @param value - значение поля ввода
 * @returns число либо `undefined` для пустого, нечислового ввода и `NaN`
 */
export function parseFormNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = Number(trimmed);

  return trimmed === '' || !Number.isFinite(parsed) ? undefined : parsed;
}

/**
 * Приводит числовое поле формы к числу до проверки схемой.
 *
 * Строгая схема на строке из поля ввода падала, и разбор отбрасывал куда
 * больше, чем одно поле: все модификаторы эффекта или его длительность целиком.
 *
 * @param value - значение поля как пришло
 * @returns число, `undefined` для пустого или нечислового ввода, либо исходное
 *   значение, если это не строка и не число
 */
export function coerceOptionalNumber(value: unknown): unknown {
  return typeof value === 'number' || typeof value === 'string'
    ? parseFormNumber(value)
    : value;
}

/** Самая длинная формула Сл */
export const MAX_SAVE_DC_FORMULA_LENGTH = 200;

/**
 * Zod-схема Сл формулой: пустая или слишком длинная отбрасывается, спасбросок
 * остаётся с числом.
 */
export const SaveDcFormulaSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SAVE_DC_FORMULA_LENGTH)
  .optional()
  .catch(undefined);
