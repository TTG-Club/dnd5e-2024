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
  ItemGrantSource,
  RefSearchPack,
  StartingEquipmentItem,
} from '@vtt/shared/system/dnd.js';

import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
import { generateId, isRecord } from '@vtt/shared';
import {
  isDnDGameItem,
  normalizeCompendiumItem,
  STARTING_EQUIPMENT_ITEM_KINDS,
  startingEquipmentNote,
  startingEquipmentQuantity,
} from '@vtt/shared/system/dnd.js';

import { orderPacksPreferring } from './useCompendiumCatalog';
import { describeCandidate, resolveRefForActor } from './usePackChoicePrompt';

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
  const note = startingEquipmentNote(item);

  return {
    id: generateId('eq'),
    name: note ? `${item.name} (${note})` : item.name,
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

/** Записи предметов компендиума по слагу страницы — см. {@link loadEquipmentIndex}. */
export type EquipmentIndex = ReadonlyMap<string, DnDGameItem>;

/**
 * Собирает индекс предметов компендиума по слагу страницы.
 *
 * Паки обходятся с предпочтением пака записи, чьё это снаряжение: слаг у копий
 * одного предмета в разных компендиумах один, и первым должен встретиться свой.
 *
 * Отдельно от разворачивания, потому что источник позиций бывает и без
 * ожидания: существо из компендиума собирается прямо в обработчике `dragstart`,
 * а тот ничего не ждёт. Такие места греют индекс заранее и зовут
 * {@link buildEquipmentItems}.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param preferredPackId - пак записи-владельца снаряжения; пусто — порядок хоста
 */
export async function loadEquipmentIndex(
  socket: TypedWebSocketClient | null | undefined,
  preferredPackId?: string,
): Promise<EquipmentIndex> {
  const bySrcUrl = new Map<string, DnDGameItem>();

  if (!socket) {
    return bySrcUrl;
  }

  for (const kind of STARTING_EQUIPMENT_ITEM_KINDS) {
    const packs = await loadCompendiumKindByPack(socket, kind);

    for (const pack of orderPacksPreferring(packs, preferredPackId)) {
      for (const entry of pack.entries) {
        const srcUrl = entrySrcUrl(entry);

        // Первая запись с этим слагом и остаётся: у раскрытых магических
        // предметов слаг общий, и якорная запись идёт в паке первой
        if (srcUrl && !bySrcUrl.has(srcUrl) && isDnDGameItem(entry)) {
          bySrcUrl.set(srcUrl, entry);
        }
      }
    }
  }

  return bySrcUrl;
}

/**
 * Собирает предметы инвентаря по позициям и готовому индексу. Позиция, которой
 * в индексе не нашлось, становится простым предметом по названию.
 *
 * @param index - индекс предметов компендиума ({@link loadEquipmentIndex})
 * @param items - позиции снаряжения
 */
export function buildEquipmentItems(
  index: EquipmentIndex,
  items: StartingEquipmentItem[],
): DnDGameItem[] {
  return items.map((item) => {
    const found = item.url ? index.get(item.url.toLowerCase()) : undefined;

    return found ? itemFromEntry(found, item) : fallbackItem(item);
  });
}

/**
 * Предметы компендиума по пакам: в каждом паке — первая запись со слагом (у
 * раскрытых магических предметов слаг общий, и якорная запись идёт первой).
 *
 * @param socket - WebSocket-клиент
 * @returns паки с предметами, у которых есть слаг страницы
 */
async function loadEquipmentPacks(
  socket: TypedWebSocketClient,
): Promise<RefSearchPack<DnDGameItem>[]> {
  const byPack = new Map<
    string,
    RefSearchPack<DnDGameItem> & { seen: Set<string> }
  >();

  for (const kind of STARTING_EQUIPMENT_ITEM_KINDS) {
    const packs = await loadCompendiumKindByPack(socket, kind);

    for (const pack of packs) {
      const target = byPack.get(pack.packId) ?? {
        packId: pack.packId,
        packName: pack.packName,
        entries: [],
        seen: new Set<string>(),
      };

      const entries: DnDGameItem[] = [...target.entries];

      for (const entry of pack.entries) {
        const srcUrl = entrySrcUrl(entry);

        if (srcUrl && !target.seen.has(srcUrl) && isDnDGameItem(entry)) {
          target.seen.add(srcUrl);
          entries.push(entry);
        }
      }

      byPack.set(pack.packId, { ...target, entries });
    }
  }

  return [...byPack.values()].map(({ packId, packName, entries }) => ({
    packId,
    packName,
    entries,
  }));
}

/**
 * Предмет инвентаря из записи компендиума для позиции снаряжения.
 *
 * @param found - запись предмета
 * @param item - позиция снаряжения
 */
function itemFromEntry(
  found: DnDGameItem,
  item: StartingEquipmentItem,
): DnDGameItem {
  return normalizeCompendiumItem({
    ...found,
    id: generateId('eq'),
    quantity: startingEquipmentQuantity(item),
    equipped: false,
    isReadOnly: false,
  });
}

/**
 * Разворачивает позиции для персонажа по правилу «свой пак → единственный
 * другой → выбор игрока». Не нашлось нигде или окно закрыли — простой предмет
 * по названию, как и раньше: строка снаряжения не должна пропасть.
 *
 * @param socket - WebSocket-клиент
 * @param items - позиции снаряжения
 * @param actor - персонаж и что выдаёт снаряжение
 * @param actor.actorId - персонаж, которому выдаётся снаряжение
 * @param actor.grantedByName - что выдаёт: подпись окна выбора
 * @param ownPackId - пак записи класса или предыстории
 */
async function resolveEquipmentForActor(
  socket: TypedWebSocketClient,
  items: StartingEquipmentItem[],
  actor: { actorId: string; grantedByName: string },
  ownPackId: string | undefined,
): Promise<DnDGameItem[]> {
  const packs = await loadEquipmentPacks(socket);
  const result: DnDGameItem[] = [];

  for (const item of items) {
    const url = item.url?.toLowerCase();

    // Вопросы идут по одному: следующий ждёт ответа на предыдущий
    const found = url
      ? await resolveRefForActor(actor.actorId, {
          packs,
          key: url,
          keyOf: entrySrcUrl,
          ownPackId,
          grantedBy: actor.grantedByName,
          toOption: describeCandidate,
        })
      : undefined;

    result.push(found ? itemFromEntry(found.entry, item) : fallbackItem(item));
  }

  return result;
}

/**
 * Разворачивает позиции варианта снаряжения в предметы инвентаря.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param items - позиции выбранного варианта
 * @param preferredPackId - пак записи класса или предыстории; пусто — порядок хоста
 * @param grantedBy - кто выдаёт снаряжение: пометка ложится на каждый предмет,
 * и по ней удаление класса или предыстории предложит его забрать; пусто —
 * предметы остаются без пометки
 * @param recipient - кому выдаётся: с ним копия предмета, лежащая в нескольких
 * чужих компендиумах, выбирается игроком; без него — первая по порядку паков
 * @param recipient.actorId - персонаж, которому выдаётся снаряжение
 * @param recipient.grantedByName - что выдаёт: подпись окна выбора
 * @returns предметы, готовые лечь в `actor.equipment`
 */
export async function resolveStartingEquipment(
  socket: TypedWebSocketClient | null | undefined,
  items: StartingEquipmentItem[],
  preferredPackId?: string,
  grantedBy?: ItemGrantSource,
  recipient?: { actorId: string; grantedByName: string },
): Promise<DnDGameItem[]> {
  if (items.length === 0) {
    return [];
  }

  const granted =
    recipient && socket
      ? await resolveEquipmentForActor(
          socket,
          items,
          recipient,
          preferredPackId,
        )
      : buildEquipmentItems(
          await loadEquipmentIndex(socket, preferredPackId),
          items,
        );

  return grantedBy ? granted.map((item) => ({ ...item, grantedBy })) : granted;
}
