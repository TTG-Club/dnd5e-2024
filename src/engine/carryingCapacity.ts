/**
 * Предел переносимого веса (грузоподъёмность) актёра D&D 5e (правила 2024).
 *
 * Лист даёт поправить расчёт: задать своё значение вместо формулы, считать
 * поправку по другому размеру («Мощное телосложение» считает существо на
 * категорию крупнее только для веса) и добавить свой бонус в фунтах.
 *
 * @module system/dnd/carryingCapacity
 */

import type { CreatureSize, DnDCarryingCapacity } from './types.js';

/** Множитель грузоподъёмности от значения Силы (правила 2024) */
export const CARRYING_CAPACITY_MULTIPLIER = 15;

/**
 * Поправка грузоподъёмности на размер (правила 2024): у Крошечного она вдвое
 * меньше, а с Большого удваивается на каждую категорию размера.
 */
export const CARRYING_CAPACITY_SIZE_MULTIPLIERS: Record<CreatureSize, number> =
  {
    tiny: 0.5,
    small: 1,
    medium: 1,
    large: 2,
    huge: 4,
    gargantuan: 8,
  };

/** Минимальное своё значение предела переносимого веса (в фунтах) */
export const CARRYING_CAPACITY_MIN = 0;

/** Максимальное своё значение предела переносимого веса (в фунтах) */
export const CARRYING_CAPACITY_MAX = 10_000;

/** Минимальный свой бонус к пределу (в фунтах) */
export const CARRYING_CAPACITY_BONUS_MIN = -10_000;

/** Максимальный свой бонус к пределу (в фунтах) */
export const CARRYING_CAPACITY_BONUS_MAX = 10_000;

/** Значение Силы, когда её нет в данных актёра */
const FALLBACK_STRENGTH = 10;

/** Настройка грузоподъёмности по умолчанию: всё считается по правилам */
export const DEFAULT_CARRYING_CAPACITY: DnDCarryingCapacity = {
  size: null,
  custom: null,
  bonus: 0,
};

/** Разбор предела переносимого веса — для листа и модалки настройки */
export interface CarryingCapacityBreakdown {
  /** Итоговый предел в фунтах (не меньше нуля) */
  value: number;
  /** Основа взята из своего значения, а не из расчёта по правилам */
  custom: boolean;
  /** Значение Силы, от которого считается предел по правилам */
  strength: number;
  /** Поправка на размер (множитель расчёта по правилам) */
  sizeMultiplier: number;
  /** Расчёт по правилам: Сила × 15 с поправкой на размер */
  ruleValue: number;
  /** Свой бонус к пределу; 0 — бонуса нет */
  bonus: number;
}

/**
 * Приводит число из поля ввода к целому в границах.
 * Очищенное поле `UInputNumber` отдаёт не-число — оно превращается в минимум.
 *
 * @param value - введённое значение
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
 * Убирает «хвост» плавающей точки: сумма весов предметов даёт
 * 37.599999999999994, а в листе должно стоять 37.6.
 *
 * @param value - вес в фунтах
 * @returns вес строкой без лишних знаков
 */
export function formatWeight(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Разбор предела переносимого веса: расчёт по правилам (Сила × 15 с поправкой
 * на размер) либо своё значение листа, а сверху — свой бонус. Ниже нуля предел
 * не опускается: отрицательный не значил бы ничего сверх пустых рук.
 *
 * @param params - исходные данные расчёта
 * @param params.strength - итоговое значение Силы (с учётом эффектов)
 * @param params.size - размер актёра
 * @param params.capacity - настройка листа; нет — всё считается по правилам
 * @returns разбор для листа и модалки настройки
 */
export function getCarryingCapacityBreakdown(params: {
  strength: number;
  size: CreatureSize;
  capacity?: DnDCarryingCapacity | null;
}): CarryingCapacityBreakdown {
  const { size, custom, bonus } = params.capacity ?? DEFAULT_CARRYING_CAPACITY;

  const strength = Number.isFinite(params.strength)
    ? params.strength
    : FALLBACK_STRENGTH;

  // Размер для подсчёта задаётся отдельно от размера актёра: «Мощное
  // телосложение» считает существо крупнее только для переносимого веса.
  const capacitySize = size ?? params.size;

  const sizeMultiplier = CARRYING_CAPACITY_SIZE_MULTIPLIERS[capacitySize] ?? 1;

  const ruleValue = strength * CARRYING_CAPACITY_MULTIPLIER * sizeMultiplier;

  const base = custom ?? ruleValue;

  return {
    value: Math.max(0, base + bonus),
    custom: custom !== null,
    strength,
    sizeMultiplier,
    ruleValue,
    bonus,
  };
}

/**
 * Выправляет настройку грузоподъёмности перед записью в актёра: числа приходят
 * из полей модалки, а мир мог прийти и импортом руками.
 *
 * @param capacity - настройка из модалки
 * @returns настройка с числами в допустимых границах
 */
export function normalizeCarryingCapacity(
  capacity: DnDCarryingCapacity,
): DnDCarryingCapacity {
  return {
    size: capacity.size,
    custom:
      capacity.custom === null
        ? null
        : clampInteger(
            capacity.custom,
            CARRYING_CAPACITY_MIN,
            CARRYING_CAPACITY_MAX,
          ),
    bonus: clampInteger(
      capacity.bonus,
      CARRYING_CAPACITY_BONUS_MIN,
      CARRYING_CAPACITY_BONUS_MAX,
    ),
  };
}
