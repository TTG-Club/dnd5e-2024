/**
 * Доспех носителя как условие активного эффекта.
 *
 * Многие черты и умения меняют числа только в доспехе или только без него:
 * «Оборона» даёт +1 к КД, пока надет любой доспех, а безоспешная защита —
 * наоборот, только пока доспеха нет. Условие о доспехе не зависит от броска:
 * оно известно по самому листу, поэтому считается вместе с остальными
 * свойствами носителя, а не в момент атаки.
 *
 * @module system/dnd/armorState
 */

import type { ArmorCategory } from '@vtt/shared';

import type { DnDActor, DnDCreature } from './dndEntities.js';

/**
 * Состояние доспеха носителя: категория надетой брони и наличие щита.
 * Категории нет — брони на носителе нет вовсе.
 */
export interface CarrierArmorState {
  category?: ArmorCategory;
  hasShield: boolean;
}

/**
 * Значение условия `self.armor === "<вид>"`.
 *
 * `any` и `none` — про наличие брони как таковой, три категории — про её вид,
 * `shield` и `noShield` — про щит отдельно: щит носят и без брони, и правила
 * различают эти случаи.
 */
export type ArmorConditionKind =
  'none' | 'any' | 'light' | 'medium' | 'heavy' | 'shield' | 'noShield';

/** Допустимые значения условия — по ним отсеиваются опечатки автора. */
const ARMOR_CONDITION_KINDS: ReadonlySet<string> = new Set<ArmorConditionKind>([
  'none',
  'any',
  'light',
  'medium',
  'heavy',
  'shield',
  'noShield',
]);

/**
 * Значение ли это условия о доспехе.
 *
 * @param value - значение из условия эффекта
 * @returns `true`, если значение из словаря
 */
export function isArmorConditionKind(
  value: string,
): value is ArmorConditionKind {
  return ARMOR_CONDITION_KINDS.has(value);
}

/** Категория надетой брони; щит учитывается отдельным признаком. */
type BodyArmorCategory = Exclude<ArmorCategory, 'shield'>;

/** Категории снаряжения, считающиеся бронёй. */
const BODY_ARMOR_CATEGORIES: ReadonlySet<string> = new Set<BodyArmorCategory>([
  'light',
  'medium',
  'heavy',
]);

/**
 * Категория ли это надетой брони.
 *
 * Гвардом, а не проверкой множества: `Set.has` тип не сужает, а приведения в
 * репозитории запрещены.
 *
 * @param value - категория снаряжения предмета
 * @returns `true`, если это броня (не щит и не прочее снаряжение)
 */
function isBodyArmorCategory(value: string): value is BodyArmorCategory {
  return BODY_ARMOR_CATEGORIES.has(value);
}

/**
 * Состояние доспеха носителя по его снаряжению.
 *
 * Из нескольких надетых доспехов берётся лучший по базовому КД — тем же
 * правилом, что и при расчёте класса доспеха: правила носить два доспеха не
 * разрешают, но лист этого не запрещает, и считать надо по одному.
 *
 * @param carrier - носитель эффектов
 * @returns категория надетой брони и наличие щита
 */
export function getCarrierArmorState(
  carrier: DnDActor | DnDCreature,
): CarrierArmorState {
  let category: ArmorCategory | undefined;
  let bestArmorClass = 0;
  let hasShield = false;

  for (const item of carrier.equipment ?? []) {
    if (!item.equipped || item.type !== 'equipment') {
      continue;
    }

    const itemCategory = item.equipmentCategory;

    if (itemCategory === 'shield') {
      hasShield = true;

      continue;
    }

    if (itemCategory === undefined || !isBodyArmorCategory(itemCategory)) {
      continue;
    }

    const armorClass = item.baseArmorAC ?? 0;

    if (!category || armorClass > bestArmorClass) {
      category = itemCategory;
      bestArmorClass = armorClass;
    }
  }

  return { category, hasShield };
}

/**
 * Выполняется ли условие о доспехе при данном состоянии носителя.
 *
 * Состояние неизвестно (носитель не передан) — условие не выполняется: эффект,
 * чьё условие проверить нечем, лучше не применить, чем применить всегда.
 *
 * @param kind - вид доспеха из условия
 * @param state - состояние доспеха носителя
 * @returns `true`, если условие выполняется
 */
export function armorConditionMatches(
  kind: ArmorConditionKind,
  state: CarrierArmorState | undefined,
): boolean {
  if (!state) {
    return false;
  }

  if (kind === 'shield') {
    return state.hasShield;
  }

  if (kind === 'noShield') {
    return !state.hasShield;
  }

  if (kind === 'none') {
    return state.category === undefined;
  }

  if (kind === 'any') {
    return state.category !== undefined;
  }

  return state.category === kind;
}
