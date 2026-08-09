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

import type { DnDSavingThrowSetting, DnDSavingThrowSettings } from './types.js';

import { isRecord } from '@vtt/shared';

import { ABILITY_KEYS, isAbilityType } from './consts.js';
import { parseCustomBonuses, toStoredCustomBonus } from './customBonuses.js';

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
