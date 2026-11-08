/**
 * Формы хранилищ предметов из контракта ядра — местная копия до публикации.
 *
 * Хранилище (мешок, сундук, куча на земле) — сущность ядра, а не D&D. Хост
 * пока не выпустил эти типы в `@vtt/shared`, поэтому они объявлены здесь
 * ровно по плану ядра (`docs/STORAGE_PLAN.md` в VTTG). Когда хост их опубликует,
 * файл заменяется реэкспортом из `@vtt/shared` одной правкой, а всё, что
 * импортирует отсюда, остаётся как есть.
 *
 * @module system/dnd/storageContract
 */

import type { BaseGameItem, SceneEntity } from '@vtt/shared';

/** Где лежит хранилище: у сущности, в другом хранилище или на земле */
export type StorageLocation =
  | { kind: 'entity'; entityId: string }
  | { kind: 'storage'; storageId: string }
  | {
      kind: 'scene';
      sceneId: string;
      x: number;
      y: number;
      floorId?: string;
    };

/** Хранилище предметов ядра */
export interface ItemStorage {
  /** Идентификатор хранилища */
  id: string;
  /** Название (имя мешка или «Куча») */
  name: string;
  /** Картинка хранилища */
  image?: string;
  /** Где хранилище лежит */
  location: StorageLocation;
  /** Предметы как есть: ядро читает только поля `BaseGameItem`, остальное — система */
  items: BaseGameItem[];
  /** Кто может открывать и брать, когда хранилище не несут */
  access: 'everyone' | 'owners' | 'gm';
  /** Владельцы хранилища */
  ownerIds?: string[];
  /** Заперто: открывает только ГМ */
  locked?: boolean;
  /** Скрыто от игроков */
  hidden?: boolean;
  /** Куча, созданная броском на землю: исчезает, когда опустела */
  isPile?: boolean;
  /** Мягкое удаление (несущий предмет удалён) */
  deletedAt?: number;
}

/** Итог взятия или выдачи предмета: сущность после правки и сам предмет */
export interface EntityItemChange {
  /** Сущность с обновлённым инвентарём */
  entity: SceneEntity;
  /** Взятый предмет или предмет в том виде, в каком он лёг в инвентарь */
  item: BaseGameItem;
}

/** Вход проверки «влезет ли предмет в хранилище» */
export interface CanStoreItemInput {
  /** Хранилище, куда кладут */
  storage: ItemStorage;
  /** Предмет-мешок, чьё это хранилище; `null` — сундук или куча без предмета */
  container: BaseGameItem | null;
  /** Предмет, который кладут */
  item: BaseGameItem;
}

/** Ответ проверки вместимости: да или нет с причиной для игрока */
export type CanStoreItemResult = { ok: true } | { ok: false; reason: string };
