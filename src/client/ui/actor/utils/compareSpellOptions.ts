/**
 * Порядок вариантов окна выбора: заклинания — по кругу, внутри круга по
 * названию.
 *
 * Пул выбора приходит отсортированным по одному названию, и заговоры
 * вперемешку с заклинаниями 3 круга искать неудобно. Прочие варианты (навыки,
 * оружие) держат порядок пула.
 */

import type { ChoicePickerOption } from '../ChoicePickerModal.vue';

/**
 * Сравнивает два варианта для сортировки списка.
 *
 * @param left - первый вариант
 * @param right - второй вариант
 * @returns отрицательное — первый выше, положительное — ниже, 0 — порядок пула
 */
export function compareSpellOptions(
  left: ChoicePickerOption,
  right: ChoicePickerOption,
): number {
  if (!left.spell || !right.spell) {
    return 0;
  }

  return (
    left.spell.level - right.spell.level
    || left.name.localeCompare(right.name, 'ru')
  );
}
