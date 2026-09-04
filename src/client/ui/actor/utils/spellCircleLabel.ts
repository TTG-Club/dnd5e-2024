/**
 * Подпись круга заклинания — «заговор» или «3 кр.».
 *
 * Одна на все списки заклинаний мастера и на окно выбора: игрок видит их подряд
 * (что выдали умения, что доступно сверх списка класса, что он уже взял), и
 * разные написания одного и того же круга читались бы как разные вещи.
 */

import { SPELL_CIRCLE_LABELS } from '../constants';

/**
 * Круг заклинания подписью.
 *
 * @param level - круг заклинания; 0 — заговор
 * @returns подпись для плашки списка
 */
export function spellCircleLabel(level: number): string {
  return level === 0
    ? SPELL_CIRCLE_LABELS.cantrip
    : `${level}${SPELL_CIRCLE_LABELS.levelSuffix}`;
}
