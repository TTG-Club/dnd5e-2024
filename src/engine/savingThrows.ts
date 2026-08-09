/**
 * Настройка спасбросков актёра D&D 5e.
 *
 * По правилам спасбросок — модификатор своей характеристики плюс бонус
 * мастерства при владении. Лист даёт поправить расчёт: катить спасбросок от
 * другой характеристики (умения и предметы это дают) и добавить свои бонусы —
 * как одному спасброску, так и всем шести сразу (плащ защиты, аура паладина).
 *
 * @module system/dnd/savingThrows
 */

import type { AbilityType } from '@vtt/shared';

import type {
  DnDCustomBonus,
  DnDSavingThrowSetting,
  DnDSavingThrowSettings,
} from './types.js';

import { isRecord } from '@vtt/shared';

import { ABILITY_KEYS, isAbilityType } from './consts.js';

/** Наименьшее своё число бонуса */
export const CUSTOM_BONUS_MIN = -20;

/** Наибольшее своё число бонуса */
export const CUSTOM_BONUS_MAX = 20;

/** Предел длины пометки бонуса: строка списка не должна разъезжаться */
export const CUSTOM_BONUS_LABEL_MAX_LENGTH = 40;

/**
 * Источник бонуса «своё число» в общем списке источников: число и шесть
 * характеристик стоят одним селектором, поэтому у числа тоже нужен ключ.
 */
export const CUSTOM_BONUS_FLAT_SOURCE = 'flat';

/** Источник своего бонуса одним значением: характеристика либо своё число */
export type DnDCustomBonusSource =
  AbilityType | typeof CUSTOM_BONUS_FLAT_SOURCE;

/** Заготовка нового бонуса: «+1» правится прямо в строке */
export const NEW_CUSTOM_BONUS: Omit<DnDCustomBonus, 'id'> = {
  kind: 'flat',
  ability: 'strength',
  value: 1,
  label: '',
};

/** Спасбросок по правилам: своя характеристика и без своих бонусов */
export const DEFAULT_SAVING_THROW_SETTING: DnDSavingThrowSetting = {
  ability: null,
  bonuses: [],
};

/**
 * Настройка спасброска из листа. Ключа нет — спасбросок считается по правилам,
 * и вызывающему коду не приходится разбирать пустоту самому.
 *
 * @param settings - настройка спасбросков листа (может отсутствовать)
 * @param abilityKey - спасбросок какой характеристики
 * @returns настройка спасброска
 */
export function getSavingThrowSetting(
  settings: DnDSavingThrowSettings | undefined,
  abilityKey: AbilityType,
): DnDSavingThrowSetting {
  const setting = settings?.saves?.[abilityKey];

  if (!setting) {
    return DEFAULT_SAVING_THROW_SETTING;
  }

  return {
    ability: setting.ability ?? null,
    bonuses: Array.isArray(setting.bonuses) ? setting.bonuses : [],
  };
}

/**
 * Спасбросок отличается от правил: характеристика подменена или есть свои
 * бонусы. Общие бонусы листа сюда не входят — они правятся своим блоком.
 *
 * @param setting - настройка спасброска
 * @param abilityKey - спасбросок какой характеристики
 * @returns `true`, если спасбросок считается не по правилам
 */
export function isChangedSavingThrow(
  setting: DnDSavingThrowSetting,
  abilityKey: AbilityType,
): boolean {
  return (
    (setting.ability !== null && setting.ability !== abilityKey)
    || setting.bonuses.length > 0
  );
}

/**
 * Вклад одного своего бонуса: модификатор выбранной характеристики либо своё
 * число.
 *
 * Пустое поле ввода отдаёт NaN, поэтому число подстраховано: черновик модалки
 * считается этой же функцией, и без подстраховки NaN расползся бы по всему
 * предпросмотру.
 *
 * @param abilityMods - модификаторы характеристик листа
 * @param bonus - свой бонус
 * @returns вклад бонуса в итог
 */
export function getCustomBonusValue(
  abilityMods: Record<AbilityType, number>,
  bonus: DnDCustomBonus,
): number {
  if (bonus.kind === 'ability') {
    return abilityMods[bonus.ability] ?? 0;
  }

  return Number.isFinite(bonus.value) ? bonus.value : 0;
}

/**
 * Сумма своих бонусов сверх правил.
 *
 * @param abilityMods - модификаторы характеристик листа
 * @param bonuses - свои бонусы
 * @returns суммарный вклад
 */
export function getCustomBonusesValue(
  abilityMods: Record<AbilityType, number>,
  bonuses: DnDCustomBonus[],
): number {
  return bonuses.reduce(
    (total, bonus) => total + getCustomBonusValue(abilityMods, bonus),
    0,
  );
}

/**
 * Источник бонуса одним значением — для селектора, где своё число и
 * характеристики стоят общим списком.
 *
 * @param bonus - свой бонус
 * @returns источник бонуса
 */
export function getCustomBonusSource(
  bonus: DnDCustomBonus,
): DnDCustomBonusSource {
  return bonus.kind === 'ability' ? bonus.ability : CUSTOM_BONUS_FLAT_SOURCE;
}

/**
 * Смена источника бонуса: вид и характеристика берутся из выбранного
 * источника, а своё число остаётся нетронутым — оно ждёт возврата к нему.
 *
 * @param bonus - свой бонус
 * @param source - выбранный источник
 * @returns бонус с новым источником
 */
export function withCustomBonusSource(
  bonus: DnDCustomBonus,
  source: DnDCustomBonusSource,
): DnDCustomBonus {
  return source === CUSTOM_BONUS_FLAT_SOURCE
    ? { ...bonus, kind: 'flat' }
    : { ...bonus, kind: 'ability', ability: source };
}

/**
 * Приведение бонуса к записи листа: пометка без крайних пробелов, число —
 * целое в пределах ползунка (пустое поле ввода отдаёт NaN).
 *
 * @param bonus - свой бонус из черновика модалки
 * @returns бонус для записи в лист
 */
export function toStoredCustomBonus(bonus: DnDCustomBonus): DnDCustomBonus {
  const value = Number.isFinite(bonus.value) ? Math.round(bonus.value) : 0;

  return {
    ...bonus,
    label: bonus.label.trim(),
    value: Math.min(Math.max(value, CUSTOM_BONUS_MIN), CUSTOM_BONUS_MAX),
  };
}

/**
 * Приведение настройки спасбросков к записи листа: спасброски, вернувшиеся к
 * правилам, из записи выпадают целиком — лист не копит пустые настройки.
 *
 * @param settings - настройка из черновика модалки
 * @returns настройка для записи в лист
 */
export function toStoredSavingThrowSettings(
  settings: DnDSavingThrowSettings,
): DnDSavingThrowSettings {
  const saves: DnDSavingThrowSettings['saves'] = {};

  for (const abilityKey of ABILITY_KEYS) {
    const setting = settings.saves[abilityKey];

    if (!setting) {
      continue;
    }

    const stored: DnDSavingThrowSetting = {
      ability: setting.ability === abilityKey ? null : setting.ability,
      bonuses: setting.bonuses.map(toStoredCustomBonus),
    };

    if (isChangedSavingThrow(stored, abilityKey)) {
      saves[abilityKey] = stored;
    }
  }

  return { saves, common: settings.common.map(toStoredCustomBonus) };
}

// ── Разбор записанных данных ──────────────────────────────────

/**
 * Проверяет, что значение — свой бонус. Данные приходят из мира, поэтому
 * проверяется каждое поле: испорченная запись не должна ронять расчёт листа.
 *
 * @param value - произвольное значение из записи актёра
 * @returns `true`, если значение — свой бонус
 */
function isCustomBonus(value: unknown): value is DnDCustomBonus {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string'
    && (value.kind === 'ability' || value.kind === 'flat')
    && isAbilityType(value.ability)
    && typeof value.value === 'number'
    && typeof value.label === 'string'
  );
}

/**
 * Разбирает список своих бонусов: записи неверной формы отбрасываются
 * поштучно — из-за одной испорченной строки не теряются остальные.
 *
 * @param value - произвольное значение из записи актёра
 * @returns список бонусов (пустой, если разбирать нечего)
 */
function parseCustomBonuses(value: unknown): DnDCustomBonus[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCustomBonus);
}

/**
 * Разбирает настройку одного спасброска.
 *
 * @param value - произвольное значение из записи актёра
 * @returns настройка спасброска либо `undefined`, если её нет
 */
function parseSavingThrowSetting(
  value: unknown,
): DnDSavingThrowSetting | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ability: isAbilityType(value.ability) ? value.ability : null,
    bonuses: parseCustomBonuses(value.bonuses),
  };
}

/**
 * Разбирает настройку спасбросков из системных данных актёра.
 *
 * Данные читаются по месту, а не приводятся типом: поля нет у актёров старых
 * миров, а у существ своей настройки не бывает вовсе.
 *
 * @param value - значение поля `savingThrowSettings` системных данных
 * @returns настройка спасбросков либо `undefined`, если её нет
 */
export function parseSavingThrowSettings(
  value: unknown,
): DnDSavingThrowSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawSaves = isRecord(value.saves) ? value.saves : {};
  const saves: DnDSavingThrowSettings['saves'] = {};

  for (const abilityKey of ABILITY_KEYS) {
    const setting = parseSavingThrowSetting(rawSaves[abilityKey]);

    if (setting) {
      saves[abilityKey] = setting;
    }
  }

  return { saves, common: parseCustomBonuses(value.common) };
}
