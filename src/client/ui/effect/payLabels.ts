/**
 * Подписи цены ресурсом: плашка оплаты, строки чата, отказ и блок «Цена» в
 * окне эффекта.
 */

import type { EffectPriceKind } from '@vtt/shared/system/dnd.js';

import { EFFECT_PRICE_KINDS } from '@vtt/shared/system/dnd.js';

import { MODAL_BUTTON_LABELS } from '../actor/constants';

/** Имя плашки оплаты в реестре модалок */
export const EFFECT_PAY_PROMPT_MODAL = 'EffectPayPromptModal';

/** Приставка ключа плашки оплаты */
export const EFFECT_PAY_MODAL_KEY_PREFIX = 'effect-pay';

/** Иконка шапки плашки оплаты */
export const EFFECT_PAY_PROMPT_ICON = 'tabler:coins';

/** Подписи плашки оплаты, строки чата и отказа */
export const EFFECT_PAY_PROMPT_LABELS = {
  titlePrefix: '«',
  titleSuffix: '»: чем заплатить?',
  confirm: 'Заплатить',
  cancel: MODAL_BUTTON_LABELS.cancel,
  /** Строка чата: «Гримли — цена «Кровавый щит»: 2 кости хитов (к10): 7» */
  chatMiddle: ' — цена «',
  chatSuffix: '»: ',
  chatJoiner: '; ',
  shortfallTitle: 'Цена не по карману',
  /** Вопрос о круге до оплаты: количество цены растёт от круга */
  castLevelQuestion: 'Каким кругом накладываете?',
  castLevelOptionPrefix: 'Круг ',
} as const;

/** Подписи вида цены в окне эффекта */
export const EFFECT_PRICE_KIND_LABELS: Record<EffectPriceKind, string> = {
  counter: 'Счётчик листа',
  hitDice: 'Кости хитов',
  spellSlot: 'Ячейка заклинания',
  itemUses: 'Заряды предмета',
  inspiration: 'Героическое вдохновение',
} as const;

/** Виды цены — вариантами выбора в окне эффекта */
export const EFFECT_PRICE_KIND_OPTIONS: Array<{
  value: EffectPriceKind;
  label: string;
}> = EFFECT_PRICE_KINDS.map((kind) => ({
  value: kind,
  label: EFFECT_PRICE_KIND_LABELS[kind],
}));

/** Иконки строки платежа */
export const EFFECT_PAY_ROW_ICONS = {
  add: 'tabler:plus',
  remove: 'tabler:trash',
} as const;

/** Подписи блока «Цена» в окне эффекта */
export const EFFECT_PAY_FIELD_LABELS = {
  title: 'Цена ресурсом',
  hintEffect:
    'Что тратит тот, кто применяет, включает или колдует. Не хватает ресурса — применение, включение и каст не состоятся. Потраченное доступно в формулах эффекта: @paid.slotLevel — круг ячейки, @paid.hitDice и @paid.hitDie — число и грань костей хитов, @paid.hitDiceRoll — сумма их броска, @paid.counter — единицы счётчика, @paid.itemUses — заряды.',
  hintTrigger:
    'Что тратит носитель эффекта, чтобы срабатывание состоялось. Владельца спросят перед списанием; отказ и нехватка ресурса срабатывание отменяют. Потраченное доступно в формулах действий: @paid.slotLevel, @paid.hitDice, @paid.hitDie, @paid.hitDiceRoll, @paid.counter, @paid.itemUses.',
  add: 'Добавить цену',
  remove: 'Убрать цену',
  kind: 'Чем платят',
  counter: 'Ключ счётчика',
  counterPlaceholder: 'bardic-inspiration',
  amount: 'Сколько',
  amountPlaceholder: '1',
  amountHint:
    'Число или формула: 2, @castLevel, 1 + @mod.con. Пусто — одна единица. Ноль вместе с «До» — цена по желанию.',
  max: 'До',
  maxHint:
    'Верхняя граница выбора: игрок платит от «Сколько» до «До». Пусто — ровно «Сколько».',
  minLevel: 'Круг от',
  maxLevel: 'Круг до',
  pact: 'Только ячейка договора',
  itemUsesHint:
    'Заряды предмета, с которого пришёл эффект. Заменяет обычный расход применения: 0 — свойство зарядов не тратит.',
  inspirationHint: 'Тратит героическое вдохновение.',
} as const;
