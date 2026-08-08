import type { CompendiumEntry } from '../types/index.js';

/**
 * Читает строковое поле `key` из произвольного значения (определения класса/
 * вида/предыстории уникальны по `key`, а не `id`). Источник — доверенный JSON.
 *
 * @param value - произвольное значение
 * @returns значение `key` или `undefined`
 */
function readDefinitionKey(value: unknown): string | undefined {
  if (
    typeof value === 'object'
    && value !== null
    && 'key' in value
    && typeof value.key === 'string'
    && value.key.length > 0
  ) {
    return value.key;
  }

  return undefined;
}

/**
 * Ключ записи внутри её типа: `id` (предметы/заклинания/существа) либо `key`
 * (определения класса/вида/предыстории). У разделителя ключа нет.
 *
 * Живёт в `shared`, потому что считать его обязаны ОБЕ стороны одинаково: сервер
 * дедуплицирует им записи и кладёт его в индекс страниц-источников, а клиент по
 * нему же находит запись в загруженном типе. Разъедься реализации — ссылка молча
 * перестанет открываться, и ни один тип этого не поймает.
 *
 * @param entry - запись компедиума
 * @returns ключ записи или `undefined` (разделитель, запись без `id`/`key`)
 */
export function compendiumEntryKey(entry: CompendiumEntry): string | undefined {
  // `'id' in entry` сужает к предмету (у разделителя нет id). Прямое сужение по
  // `type` не работает: `GameItemType` открыт для систем (`(string & {})`),
  // поэтому 'separator' формально входит в него.
  if (entry.type === 'separator' || !('id' in entry)) {
    return undefined;
  }

  if (typeof entry.id === 'string' && entry.id.length > 0) {
    return entry.id;
  }

  return readDefinitionKey(entry);
}
