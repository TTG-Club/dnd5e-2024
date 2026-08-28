/**
 * Разворачивание стартового снаряжения в предметы инвентаря.
 *
 * Вариант снаряжения предыстории или класса везёт позиции со слагом страницы
 * предмета на сайте ({@link StartingEquipmentItem.url}). По этому слагу позиция
 * ищется в компендиуме — в записях он лежит в `srcUrl`. Нашлась запись —
 * персонаж получает полноценный предмет со своим весом, стоимостью и боевыми
 * полями; не нашлась (позиция без слага или предмета нет в паках) — простой
 * предмет по названию, чтобы строка снаряжения не потерялась совсем.
 *
 * @module systems/dnd5e/composables/useStartingEquipment
 */

import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  DnDGameItem,
  StartingEquipmentItem,
} from '@vtt/shared/system/dnd.js';

import { loadCompendiumKind } from '@/core/compendiumDataClient';
import { generateId, isRecord } from '@vtt/shared';
import {
  isDnDGameItem,
  normalizeCompendiumItem,
  STARTING_EQUIPMENT_ITEM_KINDS,
  startingEquipmentQuantity,
} from '@vtt/shared/system/dnd.js';

/** Слаг страницы записи компендиума; пусто — запись в индекс не попадает. */
function entrySrcUrl(entry: unknown): string | undefined {
  if (!isRecord(entry) || typeof entry.srcUrl !== 'string') {
    return undefined;
  }

  return entry.srcUrl.toLowerCase();
}

/**
 * Собирает предмет инвентаря из позиции, которой не нашлось записи. Полей,
 * кроме названия и количества, у такой позиции нет — вес и стоимость мастер
 * проставит сам.
 */
function fallbackItem(item: StartingEquipmentItem): DnDGameItem {
  return {
    id: generateId('eq'),
    name: item.note ? `${item.name} (${item.note})` : item.name,
    type: 'equipment',
    description: '',
    quantity: startingEquipmentQuantity(item),
    weight: 0,
    cost: '',
    rarity: 'none',
    equipped: false,
    isReadOnly: false,
  };
}

/**
 * Разворачивает позиции варианта снаряжения в предметы инвентаря.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param items - позиции выбранного варианта
 * @returns предметы, готовые лечь в `actor.equipment`
 */
export async function resolveStartingEquipment(
  socket: TypedWebSocketClient | null | undefined,
  items: StartingEquipmentItem[],
): Promise<DnDGameItem[]> {
  if (items.length === 0) {
    return [];
  }

  const bySrcUrl = new Map<string, DnDGameItem>();

  if (socket) {
    for (const kind of STARTING_EQUIPMENT_ITEM_KINDS) {
      const entries = await loadCompendiumKind(socket, kind);

      for (const entry of entries) {
        const srcUrl = entrySrcUrl(entry);

        // Первая запись с этим слагом и остаётся: у раскрытых магических
        // предметов слаг общий, и якорная запись идёт в паке первой
        if (srcUrl && !bySrcUrl.has(srcUrl) && isDnDGameItem(entry)) {
          bySrcUrl.set(srcUrl, entry);
        }
      }
    }
  }

  return items.map((item) => {
    const found = item.url ? bySrcUrl.get(item.url.toLowerCase()) : undefined;

    if (!found) {
      return fallbackItem(item);
    }

    return normalizeCompendiumItem({
      ...found,
      id: generateId('eq'),
      quantity: startingEquipmentQuantity(item),
      equipped: false,
      isReadOnly: false,
    });
  });
}
