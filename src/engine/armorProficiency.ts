/**
 * Владение надетым доспехом или щитом.
 *
 * Список владений персонажа пишут двумя способами: мастер класса и окно
 * владений — ключами доспехов («leather»), черты и дары уровней — категорией
 * («light»). Предмет из компендиума при этом может нести свой `baseType`,
 * которого в справочнике системы нет: тогда владение решает категория
 * предмета, а полный набор доспехов категории в списке равен владению ею —
 * лист и показывает его одним бэйджем «Вся лёгкая».
 *
 * @module system/dnd/armorProficiency
 */

import type { DnDGameItem } from './dndEntities.js';

import armorBaseTypes from './armor-base-types.json';
import equipmentCategories from './equipment-categories.json';

/** Надетый предмет в том объёме, который нужен проверке владения */
type WornArmorItem = Pick<DnDGameItem, 'baseType' | 'equipmentCategory'>;

/** Категории снаряжения, к которым применяется проверка владения */
const ARMOR_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  equipmentCategories
    .filter((category) => category.isArmor)
    .map((category) => category.key),
);

/** Категория доспеха по ключу базового типа из справочника системы */
const CATEGORY_BY_BASE_TYPE: ReadonlyMap<string, string> = new Map(
  armorBaseTypes.map((baseType) => [baseType.key, baseType.category]),
);

/**
 * Категория доспеха предмета: из самого предмета, иначе — по его базовому
 * типу из справочника.
 *
 * @param armorItem - надетый предмет
 * @returns категория доспеха или `undefined`, если определить её нечем
 */
function resolveArmorCategory(armorItem: WornArmorItem): string | undefined {
  const { baseType, equipmentCategory } = armorItem;

  if (equipmentCategory && ARMOR_CATEGORY_KEYS.has(equipmentCategory)) {
    return equipmentCategory;
  }

  return baseType ? CATEGORY_BY_BASE_TYPE.get(baseType) : undefined;
}

/**
 * Есть ли в списке владений все доспехи категории из справочника.
 *
 * @param category - категория доспеха
 * @param proficiencies - ключи владений бронёй персонажа
 * @returns `true`, если категория в справочнике непуста и выбрана целиком
 */
function hasWholeCategory(
  category: string,
  proficiencies: readonly string[],
): boolean {
  const categoryBaseTypes = armorBaseTypes.filter(
    (baseType) => baseType.category === category,
  );

  return (
    categoryBaseTypes.length > 0
    && categoryBaseTypes.every((baseType) =>
      proficiencies.includes(baseType.key),
    )
  );
}

/**
 * Владеет ли персонаж надетым доспехом или щитом.
 *
 * Владение есть, если в списке сам доспех, его категория или все доспехи этой
 * категории. Предмет, чью категорию определить нечем (кастомный), не
 * штрафуется.
 *
 * @param armorItem - надетый доспех или щит
 * @param proficiencies - ключи владений бронёй персонажа
 * @returns `true`, если штрафа за доспех без владения нет
 */
export function isArmorProficient(
  armorItem: WornArmorItem,
  proficiencies: readonly string[],
): boolean {
  if (armorItem.baseType && proficiencies.includes(armorItem.baseType)) {
    return true;
  }

  const category = resolveArmorCategory(armorItem);

  if (!category) {
    return true;
  }

  return (
    proficiencies.includes(category)
    || hasWholeCategory(category, proficiencies)
  );
}
