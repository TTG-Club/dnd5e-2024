/**
 * Рост вида по размерам — справочная величина рядом с размером существа.
 *
 * Границы независимы: у записи бывает задана только нижняя («от 5 фт.»), только
 * верхняя или обе. Поэтому подпись собирается, а не подставляется шаблоном, и
 * ноль здесь означает «граница не указана» — как и в самой записи, где поле
 * просто отсутствует.
 */

import type { SpeciesHeightRange } from './speciesTypes.js';

import { FEET_UNIT_LABEL } from './consts.js';

/** Тире между границами: типографское, а не дефис. */
const RANGE_DASH = '–';

/**
 * Человекочитаемый рост для одного размера.
 *
 * @param range - границы роста записи; пусто — рост не указан
 * @returns `4–5 фт.`, `от 4 фт.`, `до 5 фт.` либо пустая строка
 */
export function formatSpeciesHeight(range?: SpeciesHeightRange): string {
  const from = range?.from;
  const to = range?.to;

  if (from !== undefined && to !== undefined) {
    return `${from}${RANGE_DASH}${to} ${FEET_UNIT_LABEL}`;
  }

  if (from !== undefined) {
    return `от ${from} ${FEET_UNIT_LABEL}`;
  }

  if (to !== undefined) {
    return `до ${to} ${FEET_UNIT_LABEL}`;
  }

  return '';
}

/**
 * Размер с ростом одной строкой: `Средний (4–5 фт.)`. Рост не указан —
 * остаётся один размер, без пустых скобок.
 *
 * @param sizeLabel - подпись размера
 * @param range - границы роста для этого размера
 * @returns подпись размера, при наличии роста — с ним в скобках
 */
export function formatSpeciesSizeWithHeight(
  sizeLabel: string,
  range?: SpeciesHeightRange,
): string {
  const height = formatSpeciesHeight(range);

  return height ? `${sizeLabel} (${height})` : sizeLabel;
}
