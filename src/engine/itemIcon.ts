/**
 * Значок предмета — один на строку инвентаря, кнопку панели быстрого доступа
 * и значок предмета, брошенного на карту.
 *
 * Живёт в движке, а не в UI: лист рисует его сам, а значок на карте рисует
 * ядро через контракт (`VttSystem.getItemIcon`). Две копии правила разошлись
 * бы, и предмет на земле выглядел бы не так, как в инвентаре.
 *
 * @module system/dnd/itemIcon
 */

import type { BaseGameItem } from '@vtt/shared';

import type { DnDGameItem } from './dndEntities.js';

import {
  getEquipmentCategoryIcon,
  POTION_EQUIPMENT_CATEGORY,
} from './consts.js';
import { hasItemUseEffects } from './effectActivation.js';
import { isDnDGameItem } from './itemSchemas.js';
import weaponBaseTypes from './weapon-base-types.json';

/** Значок предмета с эффектами применения (свиток, масло) */
export const ITEM_USE_ICON = 'tabler:flask';

/**
 * Значки записей по типу предмета. Оружия и снаряжения здесь нет: у оружия
 * значок по базовому типу, а у снаряжения его выбирает категория
 * (`getEquipmentCategoryIcon`).
 */
export const ITEM_TYPE_ICONS: Record<string, string> = {
  'trinket': 'tabler:diamond',
  'rod': 'tabler:wand',
  'ring': 'tabler:circle-dotted',
  'clothing': 'tabler:hanger',
  'wand': 'tabler:wand',
  'wondrous': 'tabler:sparkles',
  'vehicle-equipment': 'tabler:horse',
  'tool': 'tabler:tools',
  'spell': 'tabler:sparkles',
};

/**
 * Значок записи неизвестного типа. У снаряжения заглушка своя
 * (`getEquipmentCategoryIcon`): там она отвечает за категорию, а не за тип.
 */
export const DEFAULT_ITEM_TYPE_ICON = 'tabler:box';

/** Значок оружия без базового типа или со своим рисунком листа */
export const DEFAULT_WEAPON_ICON = 'tabler:sword';

/**
 * Префикс значков из общего набора. Свои рисунки листа (`ttg:*`) ядро на
 * карте не нарисует: у него только этот набор.
 */
const SHARED_ICON_PREFIX = 'tabler:';

/** Значки оружия по базовому типу — из справочника видов оружия */
const WEAPON_BASE_TYPE_ICONS = new Map(
  weaponBaseTypes.map((baseType) => [baseType.key, baseType.icon]),
);

/**
 * Значок предмета, не оружия. Предмет с эффектами применения (свиток, масло)
 * берёт значок применения: по категории он — «снаряжение приключенца» с
 * рюкзаком, и его было не узнать. Зелье с категорией «Зелье» узнаётся и так.
 *
 * @param item - предмет листа
 * @returns имя иконки в формате `tabler:*`
 */
export function resolveItemIcon(item: DnDGameItem): string {
  if (
    hasItemUseEffects(item)
    && item.equipmentCategory !== POTION_EQUIPMENT_CATEGORY
  ) {
    return ITEM_USE_ICON;
  }

  return item.type === 'equipment'
    ? getEquipmentCategoryIcon(item.equipmentCategory)
    : (ITEM_TYPE_ICONS[item.type] ?? DEFAULT_ITEM_TYPE_ICON);
}

/**
 * Значок оружия по базовому типу. Свой рисунок листа (`ttg:*`) заменяется
 * общим значком меча: на карте его нечем нарисовать.
 *
 * @param baseType - базовый тип оружия
 * @returns имя иконки в формате `tabler:*`
 */
function resolveWeaponIcon(baseType: string | undefined): string {
  const icon = baseType ? WEAPON_BASE_TYPE_ICONS.get(baseType) : undefined;

  return icon?.startsWith(SHARED_ICON_PREFIX) ? icon : DEFAULT_WEAPON_ICON;
}

/**
 * Значок предмета для ядра — тот же, что у строки инвентаря. Реализация
 * `VttSystem.getItemIcon`: ядро зовёт её на каждой перерисовке значков на
 * карте, поэтому только поиск по готовым таблицам.
 *
 * @param item - предмет в нейтральной форме
 * @returns имя иконки `tabler:*` либо `undefined` для предмета чужой системы
 */
export function getSceneItemIcon(item: BaseGameItem): string | undefined {
  if (!isDnDGameItem(item)) {
    return undefined;
  }

  return item.type === 'weapon'
    ? resolveWeaponIcon(item.baseType)
    : resolveItemIcon(item);
}
