/**
 * Оформление строки списка — одно на все карточки записей.
 *
 * Строка живёт в двух видах: плоской в списке (компендиум, окна выбора) и
 * плашкой на листе персонажа. Разводить их `v-if`-ами в каждой карточке значило
 * бы девять раз повторить одну и ту же пару классов — и разойтись при первой же
 * правке оформления.
 */

import type { ComputedRef } from 'vue';

import { computed } from 'vue';

import {
  LIST_ROW_CARD_CLASS,
  LIST_ROW_FLAT_CLASS,
} from '../ui/actor/constants';

/**
 * Классы строки по её виду.
 *
 * @param isFlat - строка стоит в списке (без своей плашки)
 * @param cardClass - оформление плашки; по умолчанию общее для всех карточек
 * @returns класс строки, пересчитываемый вместе с видом
 */
export function useListRowClass(
  isFlat: () => boolean,
  cardClass: string = LIST_ROW_CARD_CLASS,
): ComputedRef<string> {
  return computed(() => (isFlat() ? LIST_ROW_FLAT_CLASS : cardClass));
}
