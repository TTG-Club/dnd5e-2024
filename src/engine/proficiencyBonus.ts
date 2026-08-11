/**
 * Настройка бонуса мастерства листа.
 *
 * По правилам бонус мастерства считается по суммарному уровню персонажа. Лист
 * даёт поправить этот расчёт: поставить своё число вместо расчёта по уровню и
 * добавить свои бонусы — числом либо модификатором характеристики (домашние
 * правила, предметы, умения).
 *
 * Бонус мастерства идёт в спасброски, навыки, атаку оружием и заклинательство,
 * поэтому считается он в одном месте — этими функциями.
 *
 * @module system/dnd/proficiencyBonus
 */

import type { AbilityType } from '@vtt/shared';

import type { DnDProficiencySettings } from './types.js';

import { isRecord } from '@vtt/shared';

import {
  getCustomBonusesValue,
  parseCustomBonuses,
  toStoredCustomBonus,
} from './customBonuses.js';

/**
 * Бонус мастерства, когда взять его неоткуда: ни классов у актёра, ни
 * опасности у существа. Наименьший по правилам — как у 1-го уровня.
 */
export const DEFAULT_PROFICIENCY_BONUS = 2;

/**
 * Наименьшая своя основа бонуса. Ноль, а не отрицательное число: основа — это
 * замена расчёту по уровню, а вычитают из неё своим бонусом со знаком минус.
 */
export const PROFICIENCY_BASE_MIN = 0;

/** Наибольшая своя основа бонуса */
export const PROFICIENCY_BASE_MAX = 20;

/** Бонус мастерства по правилам: основа по уровню и без своих бонусов */
export const DEFAULT_PROFICIENCY_SETTINGS: DnDProficiencySettings = {
  base: null,
  bonuses: [],
};

/** Разбор бонуса мастерства: из чего сложилось итоговое число */
export interface DnDProficiencyBonusBreakdown {
  /** Основа: своё число либо расчёт по уровню */
  base: number;

  /** Основа задана числом, а не взята из расчёта по уровню */
  isCustomBase: boolean;

  /** Суммарный вклад своих бонусов */
  bonus: number;

  /** Итоговый бонус мастерства */
  value: number;
}

/** Исходные данные расчёта бонуса мастерства */
export interface DnDProficiencyBonusParams {
  /** Бонус по правилам — расчёт по суммарному уровню персонажа */
  ruleValue: number;

  /** Настройка листа; нет — всё считается по правилам */
  settings: DnDProficiencySettings | undefined;

  /** Модификаторы характеристик листа — для бонусов от характеристики */
  abilityMods: Record<AbilityType, number>;
}

/**
 * Разбор бонуса мастерства: основа, свои бонусы и итог.
 *
 * Разбор, а не одно число: его слагаемые показывает и окно настройки, и
 * подсказка плитки листа — иначе они считали бы одно и то же порознь.
 *
 * @param params - исходные данные расчёта
 * @returns разбор бонуса мастерства
 */
export function getProficiencyBonusBreakdown(
  params: DnDProficiencyBonusParams,
): DnDProficiencyBonusBreakdown {
  const customBase = params.settings?.base ?? null;

  // Пустое поле ввода отдаёт NaN: черновик окна считается этой же функцией, и
  // без подстраховки NaN расползся бы по всему предпросмотру
  const isCustomBase = customBase !== null && Number.isFinite(customBase);
  const base = isCustomBase ? customBase : params.ruleValue;

  const bonus = getCustomBonusesValue(
    params.abilityMods,
    params.settings?.bonuses ?? [],
  );

  return { base, isCustomBase, bonus, value: base + bonus };
}

/**
 * Бонус мастерства считается не по правилам: основа своя либо есть свои
 * бонусы. По этому признаку плитка листа помечается настроенной.
 *
 * @param settings - настройка листа (может отсутствовать)
 * @returns `true`, если расчёт отошёл от правил
 */
export function isChangedProficiencySettings(
  settings: DnDProficiencySettings | undefined,
): boolean {
  if (!settings) {
    return false;
  }

  return settings.base !== null || settings.bonuses.length > 0;
}

/**
 * Приведение настройки к записи листа: основа — целое число в пределах поля,
 * бонусы чистятся так же, как у навыков и спасбросков.
 *
 * @param settings - настройка из черновика окна
 * @returns настройка для записи в лист
 */
export function toStoredProficiencySettings(
  settings: DnDProficiencySettings,
): DnDProficiencySettings {
  const base = settings.base;

  const storedBase =
    base === null || !Number.isFinite(base)
      ? null
      : Math.min(
          Math.max(Math.round(base), PROFICIENCY_BASE_MIN),
          PROFICIENCY_BASE_MAX,
        );

  return {
    base: storedBase,
    bonuses: settings.bonuses.map(toStoredCustomBonus),
  };
}

/**
 * Разбирает настройку бонуса мастерства из системных данных актёра.
 *
 * Данные читаются по месту, а не приводятся типом: поля нет у актёров старых
 * миров, а у существ своей настройки не бывает вовсе.
 *
 * @param value - значение поля `proficiencySettings` системных данных
 * @returns настройка либо `undefined`, если её нет
 */
export function parseProficiencySettings(
  value: unknown,
): DnDProficiencySettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    base: typeof value.base === 'number' ? value.base : null,
    bonuses: parseCustomBonuses(value.bonuses),
  };
}
