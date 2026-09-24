/**
 * Состояние кнопки D&D на панели быстрого доступа: движок решает, доступно ли
 * действие предмета и сколько осталось, здесь — только вид для ядра.
 */

import type { MacroSlotState } from '@/core/registries/macroRegistry';
import type { ItemActionAvailability } from '@vtt/shared/system/dnd.js';

import { ITEM_ACTION_BLOCK_HINTS } from './constants';

/**
 * Вид кнопки по доступности действия: погасшая — с причиной в подсказке,
 * остаток — в углу.
 *
 * @param availability - доступность действия предмета
 * @returns состояние слота для ядра
 */
export function toHotbarSlotState(
  availability: ItemActionAvailability,
): MacroSlotState {
  const { blocked, remaining } = availability;

  return {
    disabled: blocked !== undefined,
    ...(remaining === undefined ? {} : { badge: String(remaining) }),
    ...(blocked === undefined
      ? {}
      : { hint: ITEM_ACTION_BLOCK_HINTS[blocked] }),
  };
}
