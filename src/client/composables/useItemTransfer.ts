/**
 * Передача предмета между листами перетаскиванием.
 *
 * Жест начинается в строке инвентаря (`ActorEquipmentTab` кладёт нагрузку в
 * буфер перетаскивания) и заканчивается на другом ОТКРЫТОМ листе. Сцена здесь
 * ни при чём: перетаскивание токена на токен ведёт ядро, и на существе оно пока
 * не работает — см. README, § «Чего не хватает для полноценного SDK», п. 13.
 *
 * Стороны обмена — любые сущности с инвентарём: персонаж, существо и любой
 * будущий носитель предметов. Само правило переноса живёт в движке
 * (`transferItem`), здесь только доставка: найти отправителя в мире, отправить
 * его новую запись на сервер и вернуть листу-получателю новый инвентарь.
 */

import type { SceneEntity, TypedWebSocketClient } from '@vtt/shared';
import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

import { emitEntityUpdate } from '@/core/entityUtils';
import { useHotbarStore } from '@/stores/hotbarStore';
import { useWorldStore } from '@/stores/worldStore';
import { isRecord } from '@vtt/shared';
import { transferItem } from '@vtt/shared/system/dnd.js';

import { GAME_ITEM_TRANSFER_MIME } from '../ui/actor/constants';
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

/** Что лист получил вместе с предметом */
export interface ReceivedTransfer {
  /** Новый инвентарь получателя — листу остаётся положить его и сохранить */
  equipment: DnDGameItem[];
  /** Название предмета для сообщения игроку */
  itemName: string;
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

  /**
   * Вправе ли текущий игрок ВЫНУТЬ предмет из этой сущности.
   *
   * Проверка обязана быть здесь, а не только у листа-получателя: тот знает
   * права на себя, а предмет уходит у другой стороны. Сервер такое обновление
   * отвергает МОЛЧА, без ответа (`entityManager.updateActor`/`updateCreature`),
   * поэтому без проверки предмет не переехал бы, а размножился: у отправителя
   * остался, у получателя появился.
   *
   * Правило то же, что у ядра при переносе между токенами: ГМ либо владелец.
   *
   * @param entity - сущность-отправитель
   * @returns `true`, если предмет можно забрать
   */
  function canTakeFrom(entity: SceneEntity): boolean {
    if (worldStore.isGM) {
      return true;
    }

    const userId = worldStore.connectionState.loggedAsUserId;

    return Boolean(userId) && entity.ownerId === userId;
  }

  /**
   * Принимает предмет, переданный с другого листа.
   *
   * Отправителя обновляет сама и сразу: его лист может быть закрыт, и записать
   * его больше некому. Получателя не трогает — возвращает новый инвентарь, а
   * положит его и сохранит лист своим обычным путём.
   *
   * ⚠️ Отправитель обновляется НЕМЕДЛЕННО, поэтому получатель обязан сохранить
   * инвентарь тоже немедленно. Лист в режиме правки этот жест принимать не
   * должен: там правки копятся до «Сохранить», и «Отмена» стёрла бы предмет уже
   * после того, как он ушёл у отправителя, — предмет пропал бы у обоих.
   *
   * Права на жест проверяет вызывающий лист: он и так знает, можно ли его
   * править (режим просмотра, чужое существо без контроля).
   *
   * @param event - событие drop
   * @param target - сущность-получатель (лист, на который бросили предмет)
   * @param socket - сокет мира; без него отправителя обновить нечем
   * @returns новый инвентарь и название предмета; `null` — переноса не вышло:
   *   либо нагрузка не наша (и лист проверяет остальные её виды), либо перенос
   *   невозможен. Нашу нагрузку событие к этому моменту уже погасило
   */
  function receiveTransferredItem(
    event: DragEvent,
    target: SceneEntity,
    socket: TypedWebSocketClient | null | undefined,
  ): ReceivedTransfer | null {
    const payload = readTransferPayload(event);

    if (!payload) {
      return null;
    }

    // Нагрузка наша — событие дальше по цепочке не идёт, даже если перенос
    // окажется невозможным: браузеру и другим обработчикам тут делать нечего
    event.preventDefault();
    event.stopPropagation();

    if (!socket) {
      return null;
    }

    const source = findCurrentWorldEntity(payload.sourceActorId);

    if (!source || !canTakeFrom(source)) {
      return null;
    }

    const transfer = transferItem(source, target, payload.item);

    if (!transfer) {
      return null;
    }

    // Полной заменой записи, как это делает и ядро при переносе между токенами:
    // узкий боевой канал несёт только хиты и эффекты, инвентарь в него не
    // входит. Событие по типу сущности разводит ядро — своей развилки не держим.
    //
    // Глубокая копия: записи живут в сторе хоста (reactive-прокси), и
    // поверхностная оставила бы прокси во вложенных полях
    const cleanSource: SceneEntity = JSON.parse(
      JSON.stringify(transfer.source),
    );

    emitEntityUpdate(socket, cleanSource);

    // Кнопка отданного предмета на панели быстрого доступа снимается: у
    // получателя копия заводится с новым идентификатором, и прежняя кнопка
    // осталась бы мёртвой. Тот же порядок, что при удалении предмета с листа
    hotbarStore.removeByRef(payload.item.id);

    return {
      equipment: transfer.target.equipment,
      itemName: payload.item.name,
    };
  }

  return { receiveTransferredItem };
}
