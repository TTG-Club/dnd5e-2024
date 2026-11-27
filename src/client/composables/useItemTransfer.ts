/**
 * Передача предмета между листами перетаскиванием.
 *
 * Жест начинается в строке инвентаря (`ActorEquipmentTab` кладёт нагрузку в
 * буфер перетаскивания) и заканчивается на другом ОТКРЫТОМ листе. Сцена здесь
 * ни при чём: перетаскивание токена на токен ведёт ядро (с VTTG 0.9.635 — и на
 * фишку существа).
 *
 * Стороны обмена — любые сущности с инвентарём: персонаж, существо и любой
 * будущий носитель предметов. Само правило переноса живёт в движке
 * (`transferItem`) и исполняется на СЕРВЕРЕ: лист только просит ядро передать
 * предмет (`entity:transfer-item`, VTTG 0.9.649) — тем же запросом, что и
 * перенос с фишки на фишку. Сервер сам проверяет права, берёт предмет из своих
 * данных и пишет обе стороны, либо обе, либо ни одной; листы узнают итог из
 * обычной рассылки сущностей. Поэтому отдать предмет можно и сущности, которой
 * игрок не управляет, а потерять или размножить его нельзя.
 *
 * Предмет из окна хранилища (мешок, сундук, куча) лист тоже принимает: тогда
 * перенос просится у ядра запросом хранилищ (`storage:move-item`), а правила
 * взятия и выдачи — те же методы движка (`takeItemFromEntity` /
 * `giveItemToEntity`).
 *
 * Так же лист принимает предмет из компендиума: сервер кладёт в инвентарь его
 * копию (`storage:move-item` из каталога `compendium`, VTTG 0.9.857). Запись
 * «Мастерской» лист принимает по-прежнему своим форматом (`GAME_ITEM_MIME`).
 */

import type { ItemTransferOutcome } from '@/core/entityUtils';
import type { DraggedGameItem } from '@/core/itemStorageDrag';
import type { ItemStorageOutcome } from '@/core/itemStorageRequest';
import type {
  CatalogItemSource,
  SceneEntity,
  StorageItemEndpoint,
  TypedWebSocketClient,
} from '@vtt/shared';
import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

import {
  ITEM_TRANSFER_FAILURE_MESSAGES,
  requestItemTransfer,
} from '@/core/entityUtils';
import { readDraggedGameItem } from '@/core/itemStorageDrag';
import { buildItemStorageFailureToast } from '@/core/itemStorageRequest';
import { useHotbarStore } from '@/stores/hotbarStore';
import { useItemStorageStore } from '@/stores/itemStorageStore';
import { useWorldStore } from '@/stores/worldStore';
import { isEntityOwner, isRecord } from '@vtt/shared';

import {
  GAME_ITEM_TRANSFER_MIME,
  ITEM_TRANSFER_REFUSED_TITLE,
} from '../ui/actor/constants';
import { useWorldEntities } from './useWorldEntities';

/**
 * Нагрузка перетаскивания предмета между листами.
 *
 * Форма общая с хостом: её же собирает сцена при перетаскивании токена на
 * токен, поэтому имя поля отправителя историческое (`sourceActorId`), хотя
 * отправителем может быть и существо.
 */
export interface ItemTransferPayload {
  /** Снимок переносимого предмета, снятый в начале жеста */
  item: DnDGameItem;
  /** Идентификатор сущности-отправителя */
  sourceActorId: string;
}

/**
 * Проверяет нагрузку перетаскивания. Она приезжает из события браузера, поэтому
 * разбирается, а не принимается на веру: испорченная запись иначе ушла бы в
 * перенос и вынула бы предмет из чужого инвентаря по мусорному идентификатору.
 *
 * @param value - разобранная нагрузка
 * @returns `true`, если это нагрузка переноса предмета
 */
function isItemTransferPayload(value: unknown): value is ItemTransferPayload {
  return (
    isRecord(value)
    && typeof value.sourceActorId === 'string'
    && isRecord(value.item)
    && typeof value.item.id === 'string'
    && typeof value.item.name === 'string'
  );
}

/**
 * Разбирает нагрузку переноса из события перетаскивания.
 *
 * @param event - событие drop
 * @returns нагрузка либо `null`, если это не перенос предмета
 */
function readTransferPayload(event: DragEvent): ItemTransferPayload | null {
  const rawPayload = event.dataTransfer?.getData(GAME_ITEM_TRANSFER_MIME);

  if (!rawPayload) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawPayload);

    return isItemTransferPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Несёт ли событие передачу предмета с другого листа. Листу, который жест
 * сейчас не принимает (режим правки), этого хватает, чтобы сказать причину,
 * не трогая отправителя.
 *
 * @param event - событие drop
 * @returns `true`, если нагрузка — передача предмета
 */
export function isItemTransferDrop(event: DragEvent): boolean {
  return readTransferPayload(event) !== null || readStorageDrop(event) !== null;
}

/** Предмет, брошенный на лист из окна хранилища или из компендиума */
interface StorageItemDrop {
  /** Откуда предмет берут: хранилище либо компендиум (тогда — копией) */
  from: StorageItemEndpoint | CatalogItemSource;
  /** id предмета в хранилище или записи в компендиуме */
  itemId: string;
  /** Название предмета для сообщения игроку */
  itemName: string;
  /** Брошенное как есть: по нему ядро решает, спрашивать ли количество */
  dragged: DraggedGameItem;
}

/**
 * Разбирает перенос из окна хранилища или из компендиума. Перенос из листа
 * сюда не попадает — у него свой путь (`entity:transfer-item`); запись
 * «Мастерской» — тоже: её лист берёт своим форматом.
 *
 * @param event - событие drop
 * @returns предмет хранилища или компендиума либо `null`
 */
function readStorageDrop(event: DragEvent): StorageItemDrop | null {
  const dragged = readDraggedGameItem(event.dataTransfer);
  const from = dragged?.from;

  if (!dragged || (from?.kind !== 'storage' && from?.kind !== 'compendium')) {
    return null;
  }

  return {
    from,
    itemId: dragged.item.id,
    itemName: dragged.item.name,
    dragged,
  };
}

/** Чем кончилась передача предмета на лист */
export type ItemTransferResult =
  | {
      /** Предмет пришёл с другого листа */
      kind: 'entity';
      /** Ответ сервера: передан либо причина отказа */
      outcome: ItemTransferOutcome;
      /** Название предмета для сообщения игроку */
      itemName: string;
    }
  | {
      /** Предмет пришёл из окна хранилища */
      kind: 'storage';
      /** Ответ сервера хранилищ */
      outcome: ItemStorageOutcome;
      /** Название предмета для сообщения игроку */
      itemName: string;
    };

/** Сообщение игроку об итоге передачи */
export interface ItemTransferNotice {
  title: string;
  description: string;
  color: 'success' | 'error';
}

/**
 * Собирает сообщение об итоге передачи: «передан» — только после согласия
 * сервера, иначе причина словами ядра.
 *
 * @param result - итог передачи
 * @param receivedTitle - заголовок удачной передачи у листа-получателя
 * @returns сообщение для игрока
 */
export function describeItemTransfer(
  result: ItemTransferResult,
  receivedTitle: string,
): ItemTransferNotice {
  if (result.outcome.ok) {
    return {
      title: receivedTitle,
      description: result.itemName,
      color: 'success',
    };
  }

  if (result.kind === 'storage') {
    const toast = buildItemStorageFailureToast(
      result.outcome,
      ITEM_TRANSFER_REFUSED_TITLE,
    );

    return {
      title: toast.title,
      description: toast.description,
      color: 'error',
    };
  }

  return {
    title: ITEM_TRANSFER_REFUSED_TITLE,
    description: ITEM_TRANSFER_FAILURE_MESSAGES[result.outcome.reason],
    color: 'error',
  };
}

/**
 * Приём предмета, переданного с другого листа.
 *
 * @returns обработчик события drop для листа-получателя
 */
export function useItemTransfer() {
  const { findCurrentWorldEntity } = useWorldEntities();
  const worldStore = useWorldStore();
  const hotbarStore = useHotbarStore();
  const itemStorageStore = useItemStorageStore();

  /**
   * Вправе ли текущий игрок ВЫНУТЬ предмет из этой сущности: ГМ либо владелец.
   *
   * Окончательно права проверяет сервер; здесь — та часть правила, которую
   * клиент знает сам, чтобы отказ был виден сразу, без похода на сервер. Право
   * на получателя сервер решает один: получить предмет может и сущность,
   * которой игрок не управляет.
   *
   * @param entity - сущность-отправитель
   * @returns `true`, если предмет можно забрать
   */
  function canTakeFrom(entity: SceneEntity): boolean {
    if (worldStore.isGM) {
      return true;
    }

    const userId = worldStore.connectionState.loggedAsUserId;

    return isEntityOwner(entity, userId);
  }

  /**
   * Просит сервер передать предмет и дожидается ответа.
   *
   * @param payload - нагрузка жеста
   * @param target - сущность-получатель
   * @param socket - сокет мира; без него спросить некого
   * @returns итог передачи
   */
  async function requestTransfer(
    payload: ItemTransferPayload,
    target: SceneEntity,
    socket: TypedWebSocketClient | null | undefined,
  ): Promise<ItemTransferResult> {
    const itemName = payload.item.name;
    const source = findCurrentWorldEntity(payload.sourceActorId);

    if (!socket) {
      return {
        kind: 'entity',
        outcome: { ok: false, reason: 'noResponse' },
        itemName,
      };
    }

    if (!source) {
      return {
        kind: 'entity',
        outcome: { ok: false, reason: 'notFound' },
        itemName,
      };
    }

    if (!canTakeFrom(source)) {
      return {
        kind: 'entity',
        outcome: { ok: false, reason: 'sourceForbidden' },
        itemName,
      };
    }

    const outcome = await requestItemTransfer(socket, {
      sourceEntityId: source.id,
      targetEntityId: target.id,
      item: payload.item,
    });

    if (outcome.ok) {
      // Кнопка отданного предмета на панели быстрого доступа снимается: у
      // получателя копия заводится с новым идентификатором, и прежняя кнопка
      // осталась бы мёртвой. Тот же порядок, что при удалении предмета с листа
      hotbarStore.removeByRef(payload.item.id);
    }

    return { kind: 'entity', outcome, itemName };
  }

  /**
   * Просит ядро переложить предмет из хранилища (или копию записи
   * компендиума) в инвентарь листа. Права и вместимость проверяет сервер;
   * лист узнаёт итог из обычной рассылки.
   *
   * @param drop - предмет хранилища или компендиума
   * @param target - сущность-получатель
   * @returns итог переноса; `null` — игрок передумал в окне «сколько
   *   переложить», и предмет остался на месте
   */
  async function requestStorageTake(
    drop: StorageItemDrop,
    target: SceneEntity,
  ): Promise<ItemTransferResult | null> {
    // Стопку ядро перекладывает с вопросом «сколько штук»
    const outcome = await itemStorageStore.moveDraggedItem(drop.dragged, {
      kind: 'entity',
      entityId: target.id,
    });

    return outcome
      ? { kind: 'storage', outcome, itemName: drop.itemName }
      : null;
  }

  /**
   * Принимает предмет, переданный с другого листа.
   *
   * Ни отправителя, ни получателя сама не пишет: обе стороны меняет сервер
   * одним действием, а листы получают итог обычной рассылкой сущностей.
   *
   * Лист в режиме правки этот жест принимать не должен: там открыт черновик, и
   * его «Сохранить» положило бы поверх пришедшего предмета прежний инвентарь.
   *
   * @param event - событие drop
   * @param target - сущность-получатель (лист, на который бросили предмет)
   * @param socket - сокет мира
   * @returns обещание итога передачи (итог `null` — игрок передумал, сообщать
   *   нечего); `null` вместо обещания — нагрузка не наша, и лист
   *   проверяет остальные её виды. Нашу нагрузку событие к этому моменту уже
   *   погасило
   */
  function receiveTransferredItem(
    event: DragEvent,
    target: SceneEntity,
    socket: TypedWebSocketClient | null | undefined,
  ): Promise<ItemTransferResult | null> | null {
    const storageDrop = readStorageDrop(event);

    if (storageDrop) {
      event.preventDefault();
      event.stopPropagation();

      return requestStorageTake(storageDrop, target);
    }

    const payload = readTransferPayload(event);

    if (!payload) {
      return null;
    }

    // Нагрузка наша — событие дальше по цепочке не идёт, даже если перенос
    // окажется невозможным: браузеру и другим обработчикам тут делать нечего
    event.preventDefault();
    event.stopPropagation();

    return requestTransfer(payload, target, socket);
  }

  return { receiveTransferredItem };
}
