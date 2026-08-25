/**
 * Передача предмета между сущностями сцены.
 *
 * Правило одно на все стороны обмена: и лист персонажа, и статблок существа, и
 * любой будущий носитель предметов участвуют в нём одинаково — переносу важен
 * только сам инвентарь ({@link hasInventory}), а не сорт сущности. Поэтому
 * здесь нет ни `DnDActor`, ни `DnDCreature`.
 *
 * Живёт в движке, а не в UI: одним и тем же расчётом пользуются контракт
 * системы (перетаскивание токена на токен, его зовёт ядро) и лист, на который
 * предмет бросили мышью. Разойдись эти две копии — предмет начал бы дублиться
 * на одном пути и пропадать на другом.
 *
 * @module system/dnd/itemTransfer
 */

import type { BaseGameItem, SceneEntity } from '@vtt/shared';

import type { DnDGameItem } from './dndEntities.js';
import type { DnDInventoryEntity } from './entityGuards.js';

import { generateId } from '@vtt/shared';

import { hasInventory } from './entityGuards.js';

/** Обе стороны переноса в обновлённом виде */
export interface ItemTransferResult {
  /** Отправитель без переданного предмета */
  source: DnDInventoryEntity;
  /** Получатель с копией предмета в инвентаре */
  target: DnDInventoryEntity;
}

/**
 * Переносит предмет из инвентаря отправителя в инвентарь получателя.
 *
 * Предмет берётся из инвентаря отправителя по идентификатору, а не из
 * переданного объекта: нагрузка перетаскивания — снимок, снятый в начале жеста,
 * и за время перетаскивания предмет могли изменить или уже отдать. Копия у
 * получателя получает новый идентификатор (иначе в мире окажутся два предмета с
 * одним id) и снимается со снаряжения — слоты у нового владельца свои.
 *
 * Сущности не мутируются: возвращаются их обновлённые копии. Записи приезжают
 * из сторов хоста и являются общими объектами — править их на месте нельзя.
 *
 * Права на перенос (владелец или ГМ) здесь не проверяются: это правило VTT, а
 * не D&D, и его знает вызывающая сторона.
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

  if (!hasInventory(source) || !hasInventory(target)) {
    return null;
  }

  const transferredItem = source.equipment.find(
    (entry) => entry.id === item.id,
  );

  if (!transferredItem) {
    return null;
  }

  const receivedItem: DnDGameItem = {
    ...transferredItem,
    id: generateId('eq'),
    equipped: false,
  };

  // Промежуточные переменные, а не литералы прямо в `return`: инвентарь не
  // входит в нейтральный `SceneEntity`, и проверка лишних свойств отвергла бы
  // литерал с `equipment`
  const updatedSource: DnDInventoryEntity = {
    ...source,
    equipment: source.equipment.filter((entry) => entry.id !== item.id),
  };

  const updatedTarget: DnDInventoryEntity = {
    ...target,
    equipment: [...target.equipment, receivedItem],
  };

  return { source: updatedSource, target: updatedTarget };
}
