import type { DnDGameItem, Spell } from '@vtt/shared/system/dnd.js';

/**
 * Извлекает данные заклинания из GameItem-обёртки.
 *
 * Используется при отображении заклинаний, хранящихся как GameItem
 * (в предметах, экипировке). Метаданные верхнего уровня (`name`, `description`, `source`)
 * переносятся из GameItem, объединяясь со вложенным `spellData`.
 *
 * Обёртка без `spellData` — не заклинание: круга, школы и времени сотворения
 * взять неоткуда, поэтому такая запись отдаётся как `null`, а не собирается
 * из одних метаданных.
 *
 * @param item - GameItem с type === 'spell' и заполненным spellData
 * @returns объект Spell с мета-полями из GameItem либо `null`
 */
export function extractSpellFromGameItem(item: DnDGameItem): Spell | null {
  if (!item.spellData) {
    return null;
  }

  return {
    ...item.spellData,
    id: item.id,
    name: item.name,
    nameEn: item.nameEn,
    description: item.description,
    isSRD: item.isSRD,
    sourceKey: item.sourceKey,
  };
}
