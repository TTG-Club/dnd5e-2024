import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

import { resolveItemIcon } from '@vtt/shared/system/dnd.js';

/**
 * Значок предмета — один на строку инвентаря, кнопку панели быстрого доступа
 * и значок предмета на карте. У оружия свой значок (`WeaponIcon`), эта
 * функция для остальных предметов. Правило живёт в движке
 * (`resolveItemIcon`): по нему же значок на карте рисует ядро.
 *
 * @param item - предмет листа
 * @returns имя иконки в формате `tabler:*`
 */
export function getItemIcon(item: DnDGameItem): string {
  return resolveItemIcon(item);
}
