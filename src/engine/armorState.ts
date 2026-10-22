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

import type { DnDActor, DnDCreature, DnDGameItem } from './dndEntities.js';

import { isItemWorn } from './itemUses.js';

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

  for (const equipmentItem of carrier.equipment ?? []) {
    if (!isItemWorn(equipmentItem) || equipmentItem.type !== 'equipment') {
      continue;
    }

    const itemCategory = equipmentItem.equipmentCategory;

    if (itemCategory === 'shield') {
      hasShield = true;

      continue;
    }

    if (itemCategory === undefined || !isBodyArmorCategory(itemCategory)) {
      continue;
    }

    const armorClass = equipmentItem.baseArmorAC ?? 0;

    if (!category || armorClass > bestArmorClass) {
      category = itemCategory;
      bestArmorClass = armorClass;
    }
  }

  return { category, hasShield };
}

/**
 * Вклад Ловкости в КД надетого доспеха.
 *
 * Предел `0` значит «Ловкость не добавляется» — ни плюс, ни минус: в тяжёлом
 * доспехе КД статичен, и `Math.min(-2, 0)` давал бы штраф, которого правила не
 * знают. Тяжёлая категория считается так же, даже если предел в записи не
 * задан — категория надёжнее поля. Положительный предел ограничивает только
 * сверху: в среднем доспехе отрицательная Ловкость по правилам учитывается.
 *
 * @param dexterityModifier - модификатор Ловкости носителя
 * @param armor - предел бонуса Ловкости и категория доспеха
 * @returns слагаемое Ловкости в КД
 */
export function armorDexterityBonus(
  dexterityModifier: number,
  armor: Pick<DnDGameItem, 'equipmentCategory' | 'maxDexBonus'>,
): number {
  const maxDexterityBonus = armor.maxDexBonus;

  if (armor.equipmentCategory === 'heavy' || maxDexterityBonus === 0) {
    return 0;
  }

  if (maxDexterityBonus === null || maxDexterityBonus === undefined) {
    return dexterityModifier;
  }

  return Math.min(dexterityModifier, maxDexterityBonus);
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
