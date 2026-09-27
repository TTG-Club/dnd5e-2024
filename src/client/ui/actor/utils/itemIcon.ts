import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

import {
  getEquipmentCategoryIcon,
  hasItemUseEffects,
  POTION_EQUIPMENT_CATEGORY,
} from '@vtt/shared/system/dnd.js';

import { ITEM_USE_MACRO_ICON } from '../../../macros/constants';
import { DEFAULT_ITEM_TYPE_ICON, EQUIPMENT_TYPE_ICONS } from '../constants';

/**
 * Значок предмета — один на строку инвентаря и на кнопку панели быстрого
 * доступа, чтобы предмет везде узнавался одинаково. У оружия свой значок
 * (`WeaponIcon`), эта функция для остальных предметов.
 *
 * Предмет с эффектами применения (свиток, масло) берёт значок применения:
 * по категории он — «снаряжение приключенца» с рюкзаком, и его было не
 * узнать. Зелье с категорией «Зелье» узнаётся и так — у него значок своей
 * категории.
 *
 * @param item - предмет листа
 * @returns имя иконки в формате `tabler:*`
 */
export function getItemIcon(item: DnDGameItem): string {
  if (
    hasItemUseEffects(item)
    && item.equipmentCategory !== POTION_EQUIPMENT_CATEGORY
  ) {
    return ITEM_USE_MACRO_ICON;
  }

  return item.type === 'equipment'
    ? getEquipmentCategoryIcon(item.equipmentCategory)
    : (EQUIPMENT_TYPE_ICONS[item.type] ?? DEFAULT_ITEM_TYPE_ICON);
}
