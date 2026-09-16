import type { ItemActionBlock } from '@vtt/shared/system/dnd.js';

/** Типы макросов D&D на панели быстрого доступа */
export const DND_MACRO_TYPES = {
  weaponAttack: 'weapon-attack',
  itemUse: 'item-use',
} as const;

/** Значок кнопки применения предмета */
export const ITEM_USE_MACRO_ICON = 'tabler:flask';

/** Почему погасла кнопка предмета — в подсказке после названия */
export const ITEM_ACTION_BLOCK_HINTS: Record<ItemActionBlock, string> = {
  missing: 'предмета больше нет в инвентаре',
  depleted: 'закончились',
  noUses: 'нет зарядов',
  noAmmunition: 'нет боеприпасов',
};

/** Подписи сообщений макросов панели быстрого доступа */
export const MACRO_MESSAGE_LABELS = {
  /** Нет ячеек: «…: у вас нет доступных ячеек заклинаний 3 круга или выше.» */
  noSlotsMiddle: ': у вас нет доступных ячеек заклинаний ',
} as const;
