/**
 * Фильтры окна выбора записи компендиума (`CompendiumRefPickerModal`).
 *
 * Окно фильтрует по одному полю записи, а какое это поле — знает вызывающий:
 * у черты это категория, у заклинания круг. Правила лежат здесь, а не в самом
 * окне, чтобы оно оставалось общим для всех типов записей и не обрастало
 * знанием о каждом из них.
 */

import { isRecord } from '@vtt/shared';
import {
  SPELL_LEVEL_LABELS,
  SPELL_LEVEL_OPTIONS,
} from '@vtt/shared/system/dnd.js';

/**
 * Категория черты («Боевой стиль», «Черта происхождения») — её отдаёт выгрузка
 * сайта в поле `category` записи.
 *
 * Принимает `unknown`: записи приезжают из компендиума неразобранными, и форма
 * проверяется здесь же — приводить их типом нечем.
 *
 * @param entry - запись компендиума
 * @returns категория либо `undefined`, если её нет
 */
export function featCategoryFilterValue(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry.category === 'string'
    ? entry.category
    : undefined;
}

/**
 * Круг заклинания подписью («Заговор», «3-й круг»).
 *
 * Принимает `unknown` по той же причине, что и {@link featCategoryFilterValue}.
 *
 * @param entry - запись компендиума
 * @returns подпись круга либо `undefined` у записи без круга
 */
export function spellLevelFilterValue(entry: unknown): string | undefined {
  if (!isRecord(entry) || typeof entry.level !== 'number') {
    return undefined;
  }

  return SPELL_LEVEL_LABELS[entry.level];
}

/**
 * Порядок кругов в панели фильтра: по алфавиту «Заговор» уехал бы за девятый
 * круг, а он первый.
 */
export const SPELL_LEVEL_FILTER_ORDER: string[] = SPELL_LEVEL_OPTIONS.map(
  (option) => option.label,
);
