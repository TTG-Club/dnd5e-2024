/**
 * Классы по пакам: каталог записей класса с уже свёрнутыми подклассами.
 *
 * Поверх общего каталога ({@link useCompendiumCatalog}) добавляет то, что есть
 * только у классов: записи-подклассы (`parentClassKey`) сворачиваются внутрь
 * родителя — и делается это ВНУТРИ пака. Подкласс из DEV-компендиума липнет к
 * DEV-волшебнику, из ПРОД — к ПРОД-волшебнику; подклассы, заведённые в самом
 * мире, — к родителю любого пака: хоумбрю к компендиумному классу и пишут.
 *
 * Копия класса из компендиума получает НОВЫЙ ключ и ложится в предметы мира,
 * поэтому в паках она не находится — без записей мира лист не увидел бы ни
 * таблицы уровней, ни чисел подготовки такого персонажа.
 */

import type { Ref } from 'vue';

import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  ClassDefinition,
  CompendiumRecordRef,
} from '@vtt/shared/system/dnd.js';

import type { CatalogPack } from './useCompendiumCatalog';

import { computed, getCurrentInstance, onMounted } from 'vue';

import { useChatStore } from '@/stores/chatStore';
import { useItemsStore } from '@/stores/itemsStore';
import {
  isClassDefinition,
  isDnDGameItem,
  isSubclassRecord,
  mergeSubclassRecords,
  WORLD_PACK_ID,
} from '@vtt/shared/system/dnd.js';

import { COMPENDIUM_PICKER_LABELS } from '../ui/actor/constants';
import {
  flattenPreferring,
  resolveIn,
  useCompendiumCatalog,
} from './useCompendiumCatalog';

/**
 * Каталог классов по пакам.
 *
 * @param socket - сокет мира; не задан — берётся из стора чата (окна, которым
 *   сокет пропом не приходит)
 */
export function useClassCatalog(socket?: Ref<TypedWebSocketClient | null>) {
  const chatStore = useChatStore();
  const itemsStore = useItemsStore();

  const socketRef = socket ?? computed(() => chatStore.getSocket());

  /**
   * Записи классов мира вместе с записями-подклассами: предмет с вложенным
   * `classData`. Поле читается после гварда, а не приведением типа: стор хоста
   * отдаёт нейтральные предметы, и `classData` — уже наше расширение формы.
   */
  const worldRecords = computed<ClassDefinition[]>(() =>
    itemsStore.items
      .filter(isDnDGameItem)
      .filter((worldItem) => worldItem.type === 'class')
      .map((worldItem) => worldItem.classData)
      .filter(isClassDefinition),
  );

  const catalog = useCompendiumCatalog<ClassDefinition>({
    socket: socketRef,
    kind: 'class',
    isEntry: isClassDefinition,
    worldEntries: () => worldRecords.value,
    worldPackName: COMPENDIUM_PICKER_LABELS.worldPack,
  });

  /** Подклассы, заведённые в мире: приклеиваются к родителю любого пака */
  const worldSubclassRecords = computed(() =>
    worldRecords.value.filter(isSubclassRecord),
  );

  /**
   * Паки с определениями: записи-подклассы свёрнуты внутрь родителей своего
   * пака, подклассы мира — внутрь родителей каждого пака.
   */
  const definitionPacks = computed<CatalogPack<ClassDefinition>[]>(() =>
    catalog.packs.value.map((pack) => ({
      ...pack,
      entries: mergePackDefinitions(pack, worldSubclassRecords.value),
    })),
  );

  /**
   * Записи как есть — вместе с записями-подклассами — для того, кто клеит
   * подклассы к одному классу сам (`withSubclassRecords`): записи пака, в
   * котором нашлась ссылка, плюс подклассы мира.
   *
   * @param recordRef - класс, к которому клеят
   */
  function recordsFor(recordRef: CompendiumRecordRef): ClassDefinition[] {
    const found = resolveIn(catalog.packs.value, recordRef);

    const pack = found
      ? catalog.packs.value.find((entry) => entry.packId === found.packId)
      : undefined;

    if (!pack) {
      return worldSubclassRecords.value;
    }

    return pack.packId === WORLD_PACK_ID
      ? pack.entries
      : [...pack.entries, ...worldSubclassRecords.value];
  }

  /**
   * Определение класса по ссылке: копия из названного пака, иначе первая по
   * ключу в порядке паков (старые записи без пака).
   *
   * @param recordRef - ключ класса и пак записи актора
   */
  function resolve(
    recordRef: CompendiumRecordRef,
  ): ClassDefinition | undefined {
    return resolveIn(definitionPacks.value, recordRef)?.entry;
  }

  /**
   * Определение вместе с паком, в котором оно нашлось: у ссылки без пака пак
   * становится известен здесь и дальше ложится на запись актора.
   *
   * @param recordRef - ключ класса и предпочтённый пак
   */
  function resolveWithPack(recordRef: CompendiumRecordRef) {
    return resolveIn(definitionPacks.value, recordRef);
  }

  /**
   * Классы одним списком без повторов ключа — копия предпочтённого пака
   * побеждает.
   *
   * @param preferredPackId - пак записи, ради которой список собирают
   */
  function flatPreferring(preferredPackId?: string): ClassDefinition[] {
    return flattenPreferring(definitionPacks.value, preferredPackId);
  }

  /** Классы одним списком в порядке паков — для мест без записи-адресата */
  const classDefinitions = computed(() => flatPreferring());

  // Окна, которым сокет не приходит пропом, грузят каталог сами при монтировании
  if (getCurrentInstance()) {
    onMounted(() => {
      void catalog.load();
    });
  }

  return {
    packs: definitionPacks,
    isLoaded: catalog.isLoaded,
    load: catalog.load,
    resolve,
    resolveWithPack,
    flatPreferring,
    recordsFor,
    classDefinitions,
  };
}

/**
 * Определения одного пака: подклассы свёрнуты внутрь родителей.
 *
 * Подклассы мира подмешиваются только для склейки: они принадлежат паку мира и
 * в списке чужого пака своей записью стоять не должны — отсюда отсев по тем же
 * ссылкам, что и подмешали (`mergeSubclassRecords` отдаёт сирот тем же
 * объектом).
 *
 * @param pack - пак с записями как есть
 * @param worldSubclasses - записи-подклассы мира
 */
function mergePackDefinitions(
  pack: CatalogPack<ClassDefinition>,
  worldSubclasses: ReadonlyArray<ClassDefinition>,
): ClassDefinition[] {
  if (pack.packId === WORLD_PACK_ID || worldSubclasses.length === 0) {
    return mergeSubclassRecords(pack.entries);
  }

  const foreign = new Set<ClassDefinition>(worldSubclasses);

  return mergeSubclassRecords([...pack.entries, ...worldSubclasses]).filter(
    (definition) => !foreign.has(definition),
  );
}
