import type { ItemActionBlock } from '@vtt/shared/system/dnd.js';

/** Типы макросов D&D на панели быстрого доступа */
export const DND_MACRO_TYPES = {
  weaponAttack: 'weapon-attack',
  itemUse: 'item-use',
  featureToggle: 'feature-toggle',
  effectUse: 'effect-use',
} as const;

/** Значок кнопки применения предмета */
export const ITEM_USE_MACRO_ICON = 'tabler:flask';

/** Значок кнопки особенности с переключателем («Ярость») */
export const FEATURE_TOGGLE_MACRO_ICON = 'tabler:flame';

/** Значок кнопки эффекта «при применении» без своего значка */
export const EFFECT_USE_MACRO_ICON = 'tabler:player-play';

/** Подписи кнопки эффекта «при применении» на панели быстрого доступа */
export const EFFECT_USE_SLOT_LABELS = {
  missingHint: 'эффекта больше нет на листе',
} as const;

/** Подписи кнопки особенности на панели быстрого доступа */
export const FEATURE_TOGGLE_SLOT_LABELS = {
  /** Метка в углу слота, пока эффект включён */
  activeBadge: 'вкл',
  activeHint: 'включено — нажмите, чтобы выключить',
  missingHint: 'эффекта умения больше нет на листе',
  noCounterHint: 'ресурс исчерпан',
} as const;

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
