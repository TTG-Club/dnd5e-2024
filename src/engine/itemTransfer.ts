/**
 * Взятие предмета из инвентаря, выдача в инвентарь и передача между сущностями.
 *
 * Правило одно на все стороны обмена: и лист персонажа, и статблок существа, и
 * любой будущий носитель предметов участвуют в нём одинаково — переносу важен
 * только сам инвентарь ({@link hasInventory}), а не сорт сущности. Поэтому
 * здесь нет ни `DnDActor`, ни `DnDCreature`.
 *
 * Живёт в движке, а не в UI: одним и тем же расчётом пользуются контракт
 * системы (перетаскивание токена на токен и перенос в хранилище, их зовёт
 * ядро) и лист, на который предмет бросили мышью. Разойдись эти копии —
 * предмет начал бы дублиться на одном пути и пропадать на другом.
 *
 * Все функции не мутируют вход: возвращаются обновлённые копии. Записи
 * приезжают из сторов хоста и являются общими объектами — править их на месте
 * нельзя. Права на перенос (владелец или ГМ) здесь не проверяются: это
 * правило VTT, а не D&D, и его знает вызывающая сторона.
 *
 * @module system/dnd/itemTransfer
 */

import type { BaseGameItem, SceneEntity } from '@vtt/shared';

import type { DnDGameItem } from './dndEntities.js';
import type { DnDInventoryEntity } from './entityGuards.js';

import { generateId } from '@vtt/shared';

import { hasInventory } from './entityGuards.js';
import { isDnDGameItem } from './itemSchemas.js';

/** Префикс идентификатора предмета инвентаря */
const INVENTORY_ITEM_ID_PREFIX = 'eq';

/** Обе стороны переноса в обновлённом виде */
export interface ItemTransferResult {
  /** Отправитель без переданного предмета */
  source: DnDInventoryEntity;
  /** Получатель с копией предмета в инвентаре */
  target: DnDInventoryEntity;
}

/** Сущность после взятия или выдачи предмета и сам предмет */
export interface InventoryItemChange {
  /** Сущность с обновлённым инвентарём */
  entity: DnDInventoryEntity;
  /** Взятый предмет или предмет в том виде, в каком он лёг в инвентарь */
  item: DnDGameItem;
}

/**
 * Предметы в инвентаре сущности, только для чтения.
 *
 * @param entity - сущность сцены
 * @returns снаряжение сущности; у сущности без инвентаря — пустой список
 */
export function listEntityItems(entity: SceneEntity): readonly DnDGameItem[] {
  return hasInventory(entity) ? entity.equipment : [];
}

/**
 * Забирает предмет из инвентаря сущности целиком или частью стопки.
 *
 * Без `quantity` (или если просят не меньше, чем есть) уходит весь предмет со
 * своим id. Часть стопки уходит копией с новым id, а в инвентаре остаётся
 * остаток: иначе в мире на время переноса оказались бы два предмета с одним
 * id. Взятый предмет снимается со снаряжения — вне инвентаря он не надет.
 *
 * @param entity - сущность, у которой берут
 * @param itemId - id предмета в её инвентаре
 * @param quantity - сколько взять из стопки; нет — весь предмет
 * @returns сущность без взятого и взятый предмет либо `null`, если брать
 *   неоткуда, предмета нет или количество не целое положительное
 */
export function takeItemFromEntity(
  entity: SceneEntity,
  itemId: string,
  quantity?: number,
): InventoryItemChange | null {
  if (!hasInventory(entity)) {
    return null;
  }

  const takenItem = entity.equipment.find((entry) => entry.id === itemId);

  if (!takenItem) {
    return null;
  }

  if (
    quantity !== undefined
    && (!Number.isInteger(quantity) || quantity <= 0)
  ) {
    return null;
  }

  const isWholeItem = quantity === undefined || quantity >= takenItem.quantity;

  if (isWholeItem) {
    // Промежуточная переменная, а не литерал в `return`: инвентарь не входит в
    // нейтральный `SceneEntity`, и проверка лишних свойств отвергла бы литерал
    const updatedEntity: DnDInventoryEntity = {
      ...entity,
      equipment: entity.equipment.filter((entry) => entry.id !== itemId),
    };

    return {
      entity: updatedEntity,
      item: { ...takenItem, equipped: false },
    };
  }

  const updatedEntity: DnDInventoryEntity = {
    ...entity,
    equipment: entity.equipment.map((entry) =>
      entry.id === itemId
        ? { ...entry, quantity: entry.quantity - quantity }
        : entry,
    ),
  };

  return {
    entity: updatedEntity,
    item: {
      ...takenItem,
      id: generateId(INVENTORY_ITEM_ID_PREFIX),
      quantity,
      equipped: false,
    },
  };
}

/**
 * Кладёт предмет D&D в инвентарь сущности (общая часть выдачи и передачи).
 *
 * @param entity - сущность с инвентарём
 * @param item - предмет D&D
 * @returns сущность с предметом и предмет в том виде, в каком он лёг
 */
function addItemToInventory(
  entity: DnDInventoryEntity,
  item: DnDGameItem,
): InventoryItemChange {
  // Новый id: иначе предмет, вернувшийся тем же путём, мог бы встретить в
  // инвентаре свою старую копию. Слоты у нового владельца свои — «надет»
  // снимается. Остальное (в том числе `storageId` мешка) едет как есть.
  const receivedItem: DnDGameItem = {
    ...item,
    id: generateId(INVENTORY_ITEM_ID_PREFIX),
    equipped: false,
  };

  const updatedEntity: DnDInventoryEntity = {
    ...entity,
    equipment: [...entity.equipment, receivedItem],
  };

  return { entity: updatedEntity, item: receivedItem };
}

/**
 * Кладёт предмет в инвентарь сущности.
 *
 * Предмет приходит в нейтральной форме (из хранилища ядра), поэтому сначала
 * проверяется, что это запись D&D: предмет чужой системы в снаряжение не
 * кладётся.
 *
 * @param entity - сущность, которой дают предмет
 * @param item - предмет
 * @returns сущность с предметом и предмет с новым id либо `null`, если
 *   инвентаря нет или предмет не D&D
 */
export function giveItemToEntity(
  entity: SceneEntity,
  item: BaseGameItem,
): InventoryItemChange | null {
  if (!hasInventory(entity) || !isDnDGameItem(item)) {
    return null;
  }

  return addItemToInventory(entity, item);
}

/**
 * Переносит предмет из инвентаря отправителя в инвентарь получателя.
 *
 * Предмет берётся из инвентаря отправителя по идентификатору, а не из
 * переданного объекта: нагрузка перетаскивания — снимок, снятый в начале жеста,
 * и за время перетаскивания предмет могли изменить или уже отдать. Копия у
 * получателя получает новый идентификатор и снимается со снаряжения.
 *
 * @param source - сущность-отправитель
 * @param target - сущность-получатель
 * @param item - переносимый предмет
 * @returns обновлённые копии обеих сторон либо `null`, если перенос невозможен
 */
export function transferItem(
  source: SceneEntity,
  target: SceneEntity,
  item: BaseGameItem,
): ItemTransferResult | null {
  // Перенос самому себе удалил бы предмет из копии-отправителя и добавил в
  // копию-получателя: какая из двух копий одной сущности победит при записи —
  // не определено, поэтому жест игнорируется целиком.
  if (source.id === target.id) {
    return null;
  }

  // Получателя проверяем до взятия: иначе предмет ушёл бы от отправителя в
  // никуда
  if (!hasInventory(target)) {
    return null;
  }

  const taken = takeItemFromEntity(source, item.id);

  if (!taken) {
    return null;
  }

  const given = addItemToInventory(target, taken.item);

  return { source: taken.entity, target: given.entity };
}
