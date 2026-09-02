/**
 * Ключ источника-книги.
 *
 * Ключ выводится из аббревиатуры, а не назначается отдельно: именно поэтому две
 * записи, у которых автор вписал одну и ту же аббревиатуру, считаются записями
 * одного источника — даже если одну создали в приложении, а вторая приехала с
 * сайта. Правило обязано совпадать с серверным (`VttgSourceKeys.of` в core-api),
 * иначе своя «PHB» разошлась бы с книгой игрока из компендиума.
 *
 * @module engine/sourceKeys
 */

import type { SourceDefinition } from '@vtt/shared';

/** Ключ, под которым живут записи без источника */
export const FALLBACK_SOURCE_KEY = 'hb';

/**
 * Приводит аббревиатуру источника к ключу: нижний регистр, без пробелов и
 * разделителей. `PHB 2024` и `phb-2024` дают один ключ — расхождение в
 * оформлении не должно плодить источники-двойники.
 *
 * @param abbreviation - аббревиатура, как её вписал автор
 * @returns ключ источника либо `undefined`, если вписывать было нечего
 */
export function sourceKeyFromAbbreviation(
  abbreviation: string | undefined,
): string | undefined {
  const normalized = (abbreviation ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  return normalized || undefined;
}

/**
 * Собирает определение источника из вписанных автором полей. Пустая
 * аббревиатура даёт `undefined`: источник без ключа не с чем сопоставлять, и
 * хранить его на записи бессмысленно.
 *
 * @param abbreviation - аббревиатура (напр. `PHB`)
 * @param name - название по-русски
 * @param nameEn - название по-английски
 */
export function buildSourceDefinition(
  abbreviation: string | undefined,
  name: string | undefined,
  nameEn: string | undefined,
): SourceDefinition | undefined {
  const key = sourceKeyFromAbbreviation(abbreviation);

  if (!key) {
    return undefined;
  }

  const trimmedAbbreviation = (abbreviation ?? '').trim();
  const trimmedName = (name ?? '').trim();
  const trimmedNameEn = (nameEn ?? '').trim();

  return {
    key,
    abbreviation: trimmedAbbreviation,
    // Расшифровка необязательна: подпись на карточке — аббревиатура, а полное
    // название нужно только в подсказке. Пустое здесь честнее выдуманного.
    name: trimmedName || trimmedAbbreviation,
    nameEn: trimmedNameEn,
  };
}

/**
 * Определение источника по одному ключу — для книги, которой нет ни во
 * встроенном справочнике, ни в словаре пака.
 *
 * Пак отдаёт словарь только по источникам верхнего уровня записей, и книга
 * подкласса (UA-выпуск у воина) в него не попадает. Без подписи два одноимённых
 * подкласса неразличимы, поэтому аббревиатурой служит сам ключ в верхнем
 * регистре — ровно так её собирает и выгрузка (`VttgChangesService.sources`),
 * когда книга в словарь всё же попадает. Расшифровки нет: подсказка по такому
 * определению не показывается.
 *
 * @param key - ключ источника записи
 * @returns определение с аббревиатурой из ключа
 */
export function fallbackSourceDefinition(key: string): SourceDefinition {
  const abbreviation = key.toUpperCase();

  return { key, abbreviation, name: abbreviation, nameEn: '' };
}
