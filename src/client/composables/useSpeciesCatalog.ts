/**
 * Виды по пакам: каталог записей вида вместе с записями-подвидами.
 *
 * Поверх общего каталога ({@link useCompendiumCatalog}) добавляет то, что есть
 * только у видов: подвиды конкретного вида. Подвид — самостоятельная запись со
 * ссылкой `parentKey`, и берётся он из того же пака, что и вид: у одноимённого
 * вида в соседнем компендиуме подвиды могут быть другими. Подвиды, заведённые
 * в мире, добавляются к виду своего пака (`parentPackId`), а без пака — к виду
 * любого пака.
 */

import type { Ref } from 'vue';

import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  CompendiumRecordRef,
  SpeciesDefinition,
} from '@vtt/shared/system/dnd.js';

import { computed, getCurrentInstance, onMounted } from 'vue';

import { useChatStore } from '@/stores/chatStore';
import { useItemsStore } from '@/stores/itemsStore';
import { isRecord } from '@vtt/shared';
import {
  collectSubspecies,
  isDnDGameItem,
  subspeciesFitsPack,
  WORLD_PACK_ID,
} from '@vtt/shared/system/dnd.js';

import { COMPENDIUM_PICKER_LABELS } from '../ui/actor/constants';
import { resolveIn, useCompendiumCatalog } from './useCompendiumCatalog';

/**
 * Опознаёт определение вида среди сырых записей пака и предметов мира.
 *
 * @param value - запись компендиума или вложенный `speciesData`
 * @returns `true`, если это определение вида
 */
export function isSpeciesDefinitionEntry(
  value: unknown,
): value is SpeciesDefinition {
  return isRecord(value) && value.type === 'species';
}

/**
 * Каталог видов по пакам.
 *
 * @param socket - сокет мира; не задан — берётся из стора чата (окна, которым
 *   сокет пропом не приходит)
 */
export function useSpeciesCatalog(socket?: Ref<TypedWebSocketClient | null>) {
  const chatStore = useChatStore();
  const itemsStore = useItemsStore();

  const socketRef = socket ?? computed(() => chatStore.getSocket());

  /**
   * Виды мира: предмет с вложенным `speciesData`. Поле читается после гварда:
   * стор хоста отдаёт нейтральные предметы.
   */
  const worldRecords = computed<SpeciesDefinition[]>(() =>
    itemsStore.items
      .filter(isDnDGameItem)
      .filter((worldItem) => worldItem.type === 'species')
      .map((worldItem) => worldItem.speciesData)
      .filter(isSpeciesDefinitionEntry),
  );

  const catalog = useCompendiumCatalog<SpeciesDefinition>({
    socket: socketRef,
    kind: 'species',
    isEntry: isSpeciesDefinitionEntry,
    worldEntries: () => worldRecords.value,
    worldPackName: COMPENDIUM_PICKER_LABELS.worldPack,
  });

  /** Подключённые паки — по ним видно, остался ли пак родителя подвида */
  const packIds = computed(
    () => new Set(catalog.packs.value.map((pack) => pack.packId)),
  );

  /**
   * Подвиды вида: записи из пака, в котором вид нашёлся, плюс подвиды мира,
   * относящиеся к виду этого пака.
   *
   * @param recordRef - ключ вида и его пак
   * @returns подвиды по алфавиту
   */
  function subspeciesOf(recordRef: CompendiumRecordRef): SpeciesDefinition[] {
    const packId = resolveIn(catalog.packs.value, recordRef)?.packId;

    const ownPack = catalog.packs.value.find((pack) => pack.packId === packId);

    const worldSubspecies =
      packId === WORLD_PACK_ID
        ? []
        : worldRecords.value.filter((record) =>
            subspeciesFitsPack(record, packId, packIds.value),
          );

    return collectSubspecies(recordRef.key, [
      ...(ownPack?.entries ?? []),
      ...worldSubspecies,
    ]);
  }

  // Окна, которым сокет не приходит пропом, грузят каталог сами при монтировании
  if (getCurrentInstance()) {
    onMounted(() => {
      void catalog.load();
    });
  }

  return {
    ...catalog,
    packIds,
    subspeciesOf,
  };
}
