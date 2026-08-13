/**
 * Свои прибавки сверх правил: предмет, умение, домашнее правило.
 *
 * Бонус даёт либо своё число («+2 от плаща защиты»), либо модификатор
 * характеристики («+МУД к спасброскам от ауры»). Устройство у него одно на всю
 * систему: одинаковыми строками правятся и спасброски, и навыки.
 *
 * @module system/dnd/customBonuses
 */

import type { AbilityType, MovementType } from '@vtt/shared';

import type { DnDCustomBonus } from './types.js';

import { isRecord } from '@vtt/shared';

import { isAbilityType, isMovementType } from './consts.js';

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

/** Источник бонуса «бонус мастерства» в том же общем списке источников */
export const CUSTOM_BONUS_PROFICIENCY_SOURCE = 'proficiency';

/**
 * Источник своего бонуса одним значением: характеристика, бонус мастерства
 * либо своё число.
 */
export type DnDCustomBonusSource =
  | AbilityType
  | typeof CUSTOM_BONUS_FLAT_SOURCE
  | typeof CUSTOM_BONUS_PROFICIENCY_SOURCE;

/**
 * Числа листа, от которых считаются свои бонусы.
 *
 * Собирается один раз на лист и передаётся во все расчёты: бонус берёт из него
 * либо модификатор своей характеристики, либо бонус мастерства.
 */
export interface DnDCustomBonusContext {
  /** Модификаторы характеристик листа с учётом эффектов */
  abilityMods: Record<AbilityType, number>;

  /** Итоговый бонус мастерства листа */
  proficiencyBonus: number;
}

/** Заготовка нового бонуса: «+1» правится прямо в строке */
export const NEW_CUSTOM_BONUS: Omit<DnDCustomBonus, 'id'> = {
  kind: 'flat',
  ability: 'strength',
  value: 1,
  label: '',
};

/**
 * Вклад одного своего бонуса: модификатор выбранной характеристики, бонус
 * мастерства листа либо своё число.
 *
 * Пустое поле ввода отдаёт NaN, поэтому число подстраховано: черновик модалки
 * считается этой же функцией, и без подстраховки NaN расползся бы по всему
 * предпросмотру.
 *
 * @param context - числа листа, от которых считаются бонусы
 * @param bonus - свой бонус
 * @returns вклад бонуса в итог
 */
export function getCustomBonusValue(
  context: DnDCustomBonusContext,
  bonus: DnDCustomBonus,
): number {
  if (bonus.kind === 'ability') {
    return context.abilityMods[bonus.ability] ?? 0;
  }

  if (bonus.kind === 'proficiency') {
    return context.proficiencyBonus;
  }

  return Number.isFinite(bonus.value) ? bonus.value : 0;
}

/**
 * Сумма своих бонусов сверх правил.
 *
 * @param context - числа листа, от которых считаются бонусы
 * @param bonuses - свои бонусы
 * @returns суммарный вклад
 */
export function getCustomBonusesValue(
  context: DnDCustomBonusContext,
  bonuses: DnDCustomBonus[],
): number {
  return bonuses.reduce(
    (total, bonus) => total + getCustomBonusValue(context, bonus),
    0,
  );
}

/**
 * Источник бонуса одним значением — для селектора, где своё число, мастерство
 * и характеристики стоят общим списком.
 *
 * @param bonus - свой бонус
 * @returns источник бонуса
 */
export function getCustomBonusSource(
  bonus: DnDCustomBonus,
): DnDCustomBonusSource {
  if (bonus.kind === 'ability') {
    return bonus.ability;
  }

  return bonus.kind === 'proficiency'
    ? CUSTOM_BONUS_PROFICIENCY_SOURCE
    : CUSTOM_BONUS_FLAT_SOURCE;
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
  if (source === CUSTOM_BONUS_FLAT_SOURCE) {
    return { ...bonus, kind: 'flat' };
  }

  if (source === CUSTOM_BONUS_PROFICIENCY_SOURCE) {
    return { ...bonus, kind: 'proficiency' };
  }

  return { ...bonus, kind: 'ability', ability: source };
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
    && (value.kind === 'ability'
      || value.kind === 'flat'
      || value.kind === 'proficiency')
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
export function parseCustomBonuses(value: unknown): DnDCustomBonus[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCustomBonus);
}

/**
 * Разбирает свои бонусы к каждой характеристике. Ключи приходят из записи
 * мира, поэтому сверяются гвардом: чужой ключ просто выпадает, а остальные
 * характеристики свои бонусы сохраняют.
 *
 * @param value - значение поля `abilityBonuses` системных данных
 * @returns бонусы по характеристикам (пустая запись — бонусов нет)
 */
export function parseAbilityBonuses(
  value: unknown,
): Partial<Record<AbilityType, DnDCustomBonus[]>> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Partial<Record<AbilityType, DnDCustomBonus[]>> = {};

  for (const [abilityKey, bonuses] of Object.entries(value)) {
    if (!isAbilityType(abilityKey)) {
      continue;
    }

    const parsed = parseCustomBonuses(bonuses);

    if (parsed.length > 0) {
      result[abilityKey] = parsed;
    }
  }

  return result;
}

/**
 * Разбирает свои бонусы к каждому виду передвижения. Ключи приходят из записи
 * мира, поэтому сверяются гвардом: чужой ключ просто выпадает, а остальные
 * скорости свои бонусы сохраняют.
 *
 * @param value - значение поля `movementBonuses` системных данных
 * @returns бонусы по видам передвижения (пустая запись — бонусов нет)
 */
export function parseMovementBonuses(
  value: unknown,
): Partial<Record<MovementType, DnDCustomBonus[]>> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Partial<Record<MovementType, DnDCustomBonus[]>> = {};

  for (const [movementKey, bonuses] of Object.entries(value)) {
    if (!isMovementType(movementKey)) {
      continue;
    }

    const parsed = parseCustomBonuses(bonuses);

    if (parsed.length > 0) {
      result[movementKey] = parsed;
    }
  }

  return result;
}
