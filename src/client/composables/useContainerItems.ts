/**
 * Мешки в инвентаре листа: открыть окно хранилища и показать заполненность.
 *
 * Хранилища — сущность ядра: окно, стор и сервер у хоста. Система решает
 * только, какой предмет — мешок (`isContainerItem`), и как его заполненность
 * читается по правилам D&D (вместимость, «содержимое не весит»).
 */

import type { BaseGameItem } from '@vtt/shared';

import { getItemStorageService } from '@/core/api/itemStorageService';
import { buildItemStorageFailureToast } from '@/core/itemStorageRequest';
import { useItemStorageStore } from '@/stores/itemStorageStore';
import { isStorageItem } from '@vtt/shared';
import {
  formatContainerFill,
  isContainerItem,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { EQUIPMENT_CONTAINER_LABELS } from '../ui/actor/constants';

/**
 * Мешок ли предмет: уже есть хранилище или предмет — контейнер по правилам.
 *
 * @param item - предмет инвентаря
 * @returns `true`, если у предмета есть «Открыть»
 */
export function isContainerRow(item: BaseGameItem): boolean {
  return isStorageItem(item, isContainerItem);
}

/**
 * Открытие мешков и подпись их заполненности для листа.
 *
 * @returns подпись заполненности и открытие мешка
 */
export function useContainerItems(): {
  getContainerFillLabel: (item: BaseGameItem) => string;
  openContainer: (entityId: string, itemId: string) => Promise<void>;
} {
  const itemStorageStore = useItemStorageStore();
  const toastStore = useSystemToastStore();

  /**
   * Подпись «12 / 30» для плитки мешка. Хранилища ещё нет — мешок пуст.
   *
   * @param item - предмет-мешок
   * @returns подпись в фунтах
   */
  function getContainerFillLabel(item: BaseGameItem): string {
    const storage = item.storageId
      ? itemStorageStore.getStorage(item.storageId)
      : undefined;

    return formatContainerFill(item, storage);
  }

  /**
   * Открывает окно мешка. Хранилище, если его ещё нет, заводит сервер; отказ
   * показывается тостом словами ядра или пояснением системы.
   *
   * @param entityId - сущность, в чьём инвентаре мешок
   * @param itemId - предмет-мешок
   */
  async function openContainer(
    entityId: string,
    itemId: string,
  ): Promise<void> {
    const outcome = await getItemStorageService().openContainerItem(
      entityId,
      itemId,
    );

    if (!outcome.ok) {
      toastStore.add(
        buildItemStorageFailureToast(
          outcome,
          EQUIPMENT_CONTAINER_LABELS.openRefusedTitle,
        ),
      );
    }
  }

  return { getContainerFillLabel, openContainer };
}
