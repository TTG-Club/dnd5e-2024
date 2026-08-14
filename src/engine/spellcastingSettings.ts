/**
 * Настройка чисел заклинательства листа: сложности спасброска и бонуса атаки
 * заклинанием.
 *
 * По правилам оба выводятся из одного и того же: бонус мастерства плюс
 * модификатор заклинательной характеристики (у сложности спасброска сверху ещё
 * восьмёрка). Лист даёт отойти от этого расчёта: поставить своё число вместо
 * него целиком либо добавить свои бонусы — от характеристики, от мастерства или
 * числом (предметы, умения, домашние правила).
 *
 * Устройство то же, что у бонуса мастерства (`proficiencyBonus.ts`): основа
 * плюс свои бонусы. Одинаковая настройка — одинаковые окна и одинаковый разбор.
 *
 * @module system/dnd/spellcastingSettings
 */

import type { AbilityType } from '@vtt/shared';

import type { DnDCustomBonusContext } from './customBonuses.js';
import type {
  DnDSpellcastingSettings,
  DnDSpellcastingValueSettings,
} from './types.js';

import { isRecord } from '@vtt/shared';

import { SPELL_SAVE_DC_BASE } from './consts.js';
import {
  getCustomBonusesValue,
  parseCustomBonuses,
  toStoredCustomBonus,
} from './customBonuses.js';

/**
 * Наименьшая своя сложность спасброска. Ноль, а не отрицательное число:
 * основа — это замена расчёту по правилам, а уменьшают её своим бонусом со
 * знаком минус.
 */
export const SPELL_SAVE_DC_MIN = 0;

/** Наибольшая своя сложность спасброска */
export const SPELL_SAVE_DC_MAX = 40;

/** Наименьший свой бонус атаки заклинанием: штрафы бывают и сплошными */
export const SPELL_ATTACK_BASE_MIN = -20;

/** Наибольший свой бонус атаки заклинанием */
export const SPELL_ATTACK_BASE_MAX = 40;

/** Число заклинательства по правилам: без своей основы и без своих бонусов */
export const DEFAULT_SPELLCASTING_VALUE_SETTINGS: DnDSpellcastingValueSettings =
  {
    base: null,
    bonuses: [],
  };

/** Разбор числа заклинательства: из чего сложился итог */
export interface DnDSpellcastingBreakdown {
  /** Основа: своё число либо расчёт по правилам */
  base: number;

  /** Основа задана числом, а не выведена по правилам */
  isCustomBase: boolean;

  /** Суммарный вклад своих бонусов */
  bonus: number;

  /** Итоговое число листа (без прибавок от активных эффектов) */
  value: number;
}

/** Исходные данные расчёта одного числа заклинательства */
export interface DnDSpellcastingValueParams {
  /** Число по правилам: 8 + мастерство + модификатор либо то же без восьмёрки */
  ruleValue: number;

  /** Настройка листа; нет — всё считается по правилам */
  settings: DnDSpellcastingValueSettings | undefined;

  /** Числа листа, от которых считается вклад своих бонусов */
  context: DnDCustomBonusContext;
}

/**
 * Разбор одного числа заклинательства: основа, свои бонусы и итог.
 *
 * Разбор, а не одно число: те же слагаемые показывает окно настройки, и без
 * него оно считало бы то же самое порознь с листом.
 *
 * @param params - исходные данные расчёта
 * @returns разбор числа заклинательства
 */
export function getSpellcastingValueBreakdown(
  params: DnDSpellcastingValueParams,
): DnDSpellcastingBreakdown {
  const customBase = params.settings?.base ?? null;

  // Пустое поле ввода отдаёт NaN: черновик окна считается этой же функцией, и
  // без подстраховки NaN расползся бы по всему предпросмотру
  const isCustomBase = customBase !== null && Number.isFinite(customBase);
  const base = isCustomBase ? customBase : params.ruleValue;

  const bonus = getCustomBonusesValue(
    params.context,
    params.settings?.bonuses ?? [],
  );

  return { base, isCustomBase, bonus, value: base + bonus };
}

/** Исходные данные расчёта числа заклинательства листа */
export interface DnDActorSpellcastingParams {
  /** Заклинательная характеристика листа; null — её нет */
  ability: AbilityType | null;

  /** Настройка этого числа; нет — считается по правилам */
  settings: DnDSpellcastingValueSettings | undefined;

  /** Числа листа, от которых считается расчёт по правилам и свои бонусы */
  context: DnDCustomBonusContext;
}

/**
 * Разбор числа заклинательства листа: расчёт по правилам от заклинательной
 * характеристики и бонуса мастерства, поверх — настройка листа.
 *
 * `null` — числа у листа нет вовсе: ни заклинательной характеристики, ни своей
 * настройки, и показывать нечего.
 *
 * Без характеристики её модификатор в расчёт не идёт: заклинательного класса у
 * листа нет, а число всё равно нужно — раз его задали своим.
 *
 * @param params - исходные данные расчёта
 * @param ruleBase - прибавка правил: 8 у сложности спасброска, 0 у атаки
 * @returns разбор числа либо `null`
 */
function getActorSpellcastingBreakdown(
  params: DnDActorSpellcastingParams,
  ruleBase: number,
): DnDSpellcastingBreakdown | null {
  if (!params.ability && !isChangedSpellcastingValueSettings(params.settings)) {
    return null;
  }

  const abilityMod = params.ability
    ? (params.context.abilityMods[params.ability] ?? 0)
    : 0;

  return getSpellcastingValueBreakdown({
    ruleValue: ruleBase + params.context.proficiencyBonus + abilityMod,
    settings: params.settings,
    context: params.context,
  });
}

/**
 * Разбор сложности спасброска от заклинаний: `8 + бонус мастерства +
 * модификатор заклинательной характеристики` с поправками настройки листа.
 *
 * Одна точка решения на всю систему: по ней сходятся пайплайн эффектов, плитка
 * вкладки и окно настройки — иначе они считали бы одно и то же порознь.
 *
 * @param params - исходные данные расчёта
 * @returns разбор сложности спасброска либо `null`, если числа у листа нет
 */
export function getSpellSaveDCBreakdown(
  params: DnDActorSpellcastingParams,
): DnDSpellcastingBreakdown | null {
  return getActorSpellcastingBreakdown(params, SPELL_SAVE_DC_BASE);
}

/**
 * Разбор бонуса к атаке заклинанием: то же, что у сложности спасброска, но без
 * базовой восьмёрки.
 *
 * Бонус самого заклинания и прибавки активных эффектов ложатся уже поверх
 * этого числа — здесь считается только лист.
 *
 * @param params - исходные данные расчёта
 * @returns разбор бонуса атаки либо `null`, если числа у листа нет
 */
export function getSpellAttackBreakdown(
  params: DnDActorSpellcastingParams,
): DnDSpellcastingBreakdown | null {
  return getActorSpellcastingBreakdown(params, 0);
}

/**
 * Число заклинательства считается не по правилам: основа своя либо есть свои
 * бонусы. По этому признаку плитка листа помечается настроенной.
 *
 * @param settings - настройка одного числа (может отсутствовать)
 * @returns `true`, если расчёт отошёл от правил
 */
export function isChangedSpellcastingValueSettings(
  settings: DnDSpellcastingValueSettings | undefined,
): boolean {
  if (!settings) {
    return false;
  }

  return settings.base !== null || settings.bonuses.length > 0;
}

/**
 * Приведение настройки одного числа к записи листа: основа — целое число в
 * пределах поля, бонусы чистятся так же, как у навыков и спасбросков.
 *
 * @param settings - настройка из черновика окна
 * @param minimum - наименьшая допустимая основа
 * @param maximum - наибольшая допустимая основа
 * @returns настройка для записи в лист
 */
function toStoredValueSettings(
  settings: DnDSpellcastingValueSettings,
  minimum: number,
  maximum: number,
): DnDSpellcastingValueSettings {
  const base = settings.base;

  const storedBase =
    base === null || !Number.isFinite(base)
      ? null
      : Math.min(Math.max(Math.round(base), minimum), maximum);

  return {
    base: storedBase,
    bonuses: settings.bonuses.map(toStoredCustomBonus),
  };
}

/**
 * Приведение настройки заклинательства к записи листа. Пределы у чисел разные:
 * сложность спасброска отрицательной не бывает, а бонус атаки бывает.
 *
 * @param settings - настройка из черновика окна
 * @returns настройка для записи в лист
 */
export function toStoredSpellcastingSettings(
  settings: DnDSpellcastingSettings,
): DnDSpellcastingSettings {
  return {
    saveDC: toStoredValueSettings(
      settings.saveDC,
      SPELL_SAVE_DC_MIN,
      SPELL_SAVE_DC_MAX,
    ),
    attack: toStoredValueSettings(
      settings.attack,
      SPELL_ATTACK_BASE_MIN,
      SPELL_ATTACK_BASE_MAX,
    ),
  };
}

/**
 * Разбирает настройку одного числа из системных данных.
 *
 * @param value - значение поля настройки
 * @returns настройка числа
 */
function parseValueSettings(value: unknown): DnDSpellcastingValueSettings {
  if (!isRecord(value)) {
    return DEFAULT_SPELLCASTING_VALUE_SETTINGS;
  }

  return {
    base: typeof value.base === 'number' ? value.base : null,
    bonuses: parseCustomBonuses(value.bonuses),
  };
}

/**
 * Разбирает настройку заклинательства из системных данных актёра.
 *
 * Данные читаются по месту, а не приводятся типом: поля нет у актёров старых
 * миров, а у существ заклинательство устроено своим блоком статблока.
 *
 * @param value - значение поля `spellcastingSettings` системных данных
 * @returns настройка либо `undefined`, если её нет
 */
export function parseSpellcastingSettings(
  value: unknown,
): DnDSpellcastingSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    saveDC: parseValueSettings(value.saveDC),
    attack: parseValueSettings(value.attack),
  };
}
