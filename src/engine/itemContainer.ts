/**
 * Контейнеры D&D: что считается мешком и сколько в него влезает.
 *
 * Само содержимое мешка хранит ядро (хранилище `ItemStorage`), а система
 * отвечает только на правила 2024 года: предмет — контейнер или нет, и
 * поместится ли в него ещё один предмет по весу.
 *
 * @module system/dnd/itemContainer
 */

import type {
  BaseGameItem,
  ItemStorageFitInput,
  ItemStorageVerdict,
} from '@vtt/shared';

import type { ItemContainer } from './dndEntities.js';

import { z } from 'zod';

/**
 * Допуск сравнения весов: дробные фунты складываются с хвостом плавающей точки
 * (0,1 × 3 = 0,30000000000000004), и ровно полный мешок иначе считался бы
 * переполненным.
 */
const WEIGHT_EPSILON = 1e-9;

/**
 * Схема поля `container` предмета. Числа через `coerce`: паки компендиума
 * хранят числа и строками (`"30"`), как и вес предмета.
 */
export const ItemContainerSchema = z.object({
  capacityWeight: z.coerce.number().nonnegative().optional(),
  weightless: z.boolean().optional(),
});

/**
 * Читает поле контейнера у предмета в нейтральной форме.
 *
 * @param item - предмет
 * @returns описание контейнера либо `undefined`, если предмет не контейнер
 *   или поле испорчено
 */
export function readItemContainer(
  item: BaseGameItem,
): ItemContainer | undefined {
  if (!('container' in item)) {
    return undefined;
  }

  const parsed = ItemContainerSchema.safeParse(item.container);

  return parsed.success ? parsed.data : undefined;
}

/**
 * Может ли предмет стать мешком (у него есть поле контейнера).
 *
 * @param item - предмет
 * @returns `true`, если предмет — контейнер
 */
export function isContainerItem(item: BaseGameItem): boolean {
  return readItemContainer(item) !== undefined;
}

/**
 * Вес стопки предмета в фунтах. Испорченный вес или количество считаются
 * нулём: иначе один `NaN` сделал бы мешок «бездонным» — любое сравнение с ним
 * ложно.
 *
 * @param item - предмет
 * @returns вес × количество
 */
function getStackWeight(item: BaseGameItem): number {
  const total = item.weight * item.quantity;

  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Округляет фунты для подписи (вес бывает дробным: 0,5 фнт.).
 *
 * @param pounds - вес в фунтах
 * @returns число без хвоста плавающей точки
 */
function formatPounds(pounds: number): string {
  return String(Math.round(pounds * 100) / 100).replace('.', ',');
}

/**
 * Влезет ли предмет в хранилище по весу.
 *
 * Считается вес всего, что уже лежит в хранилище, плюс вес кладущейся стопки
 * против вместимости мешка. Пускать ли мешок в мешок, решает ядро
 * (`canStorageHoldStorages`) до этого вызова, здесь это не повторяется. Если
 * пустило, вложенный мешок считается весом самого мешка: его содержимое лежит
 * в другом хранилище, а читать хранилища хост пока не даёт. Нет мешка или
 * вместимости — влезает всё: сундук и куча на земле не ограничены.
 *
 * @param input - хранилище, предмет-мешок и кладущийся предмет
 * @returns `{ ok: true }` или отказ с причиной для игрока
 */
export function canStoreItem(input: ItemStorageFitInput): ItemStorageVerdict {
  const capacity = input.container
    ? readItemContainer(input.container)?.capacityWeight
    : undefined;

  if (capacity === undefined) {
    return { ok: true };
  }

  const storedWeight = input.storage.items.reduce(
    (sum, stored) => sum + getStackWeight(stored),
    0,
  );

  const totalWeight = storedWeight + getStackWeight(input.item);

  if (totalWeight <= capacity + WEIGHT_EPSILON) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `«${input.item.name}» не влезет в «${input.storage.name}»: будет ${formatPounds(totalWeight)} фнт. при вместимости ${formatPounds(capacity)} фнт.`,
  };
}
