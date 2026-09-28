/**
 * Подписи классов по ключу — для фильтра «Класс» компендиума заклинаний.
 *
 * Классы книги игрока подписаны таблицей движка, а остальные (изобретатель,
 * классы премиум-паков) известны только по записям компендиума: заклинание
 * несёт лишь ключ класса (`classKeys`), и без записи фильтр показал бы ключ
 * латиницей. Записи грузит клиент — движок сам в сеть не ходит, — поэтому
 * названия он передаёт сюда, а форматтер компендиума читает их отсюда.
 *
 * @module system/dnd/classLabels
 */

import { z } from 'zod';

import { CLASS_KEY_OPTIONS } from './classTypes.js';

/**
 * Запись класса компендиума в той части, что нужна подписи: ключ и название.
 * Остальные поля записи здесь не нужны и не проверяются.
 */
const classLabelSourceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
});

/** Подписи классов книги игрока — главнее записей: так их пишет весь лист */
const BUILT_IN_CLASS_LABELS: ReadonlyMap<string, string> = new Map(
  CLASS_KEY_OPTIONS.map((option) => [option.value, option.label]),
);

/** Названия классов из записей компендиума, по ключу класса */
const compendiumClassLabels = new Map<string, string>();

/**
 * Запоминает названия классов из записей компендиума. Записи приезжают
 * неразобранными — годные берутся, остальные пропускаются. Повторный вызов
 * дополняет и обновляет прежние названия, а не стирает их: паки грузятся
 * порознь.
 *
 * @param classEntries - записи классов компендиума
 */
export function rememberCompendiumClassLabels(
  classEntries: Iterable<unknown>,
): void {
  for (const classEntry of classEntries) {
    const parsed = classLabelSourceSchema.safeParse(classEntry);

    if (parsed.success) {
      compendiumClassLabels.set(parsed.data.key, parsed.data.name);
    }
  }
}

/**
 * Подпись класса по ключу: таблица книги игрока, затем записи компендиума, а
 * без них — сам ключ, чтобы строка фильтра не осталась пустой.
 *
 * @param classKey - ключ класса
 * @returns название класса
 */
export function resolveClassLabel(classKey: string): string {
  return (
    BUILT_IN_CLASS_LABELS.get(classKey)
    ?? compendiumClassLabels.get(classKey)
    ?? classKey
  );
}
