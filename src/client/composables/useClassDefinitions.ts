import type { ClassDefinition } from '@vtt/shared/system/dnd.js';

import { computed, onMounted, ref } from 'vue';

import { loadCompendiumKind } from '@/core/compendiumDataClient';
import { useChatStore } from '@/stores/chatStore';
import { useItemsStore } from '@/stores/itemsStore';
import {
  isClassDefinition,
  mergeSubclassRecords,
} from '@vtt/shared/system/dnd.js';

/**
 * Определения классов, доступные листу: компендиум (все паки) плюс классы,
 * созданные в самом мире.
 *
 * Оба источника нужны вместе: копия класса из компендиума получает НОВЫЙ ключ и
 * ложится в предметы мира, поэтому по компендиуму она не находится, — а без неё
 * лист не видит ни таблицы уровней, ни чисел подготовки такого персонажа.
 *
 * Компендиум приоритетен при совпадении ключей — как и при сборке списка в
 * листе актёра.
 *
 * Записи-подклассы (`parentClassKey`) в списке не остаются: они сворачиваются
 * внутрь своих родителей, и дальше лист знает одну форму подкласса.
 */
export function useClassDefinitions() {
  const chatStore = useChatStore();
  const itemsStore = useItemsStore();

  /** Определения классов компендиума (все паки), загружены с сервера */
  const compendiumClasses = ref<ClassDefinition[]>([]);

  onMounted(async () => {
    const socket = chatStore.getSocket();

    if (!socket) {
      return;
    }

    // CompendiumEntry[] расширяем до unknown[], т.к. ClassDefinition не подтип
    // CompendiumEntry и guard иначе не сузит при filter.
    const entries: unknown[] = await loadCompendiumKind(socket, 'class');

    compendiumClasses.value = entries.filter(isClassDefinition);
  });

  /**
   * Классы, созданные в мире: предмет с вложенным `classData`.
   *
   * Поле читается проверкой, а не приведением типа: стор хоста отдаёт
   * нейтральные предметы, и `classData` — уже наше, D&D-расширение формы.
   */
  const worldClasses = computed(() =>
    itemsStore.items
      .filter((worldItem) => worldItem.type === 'class')
      .map((worldItem) =>
        'classData' in worldItem ? worldItem.classData : undefined,
      )
      .filter(isClassDefinition),
  );

  /**
   * Все записи как есть — вместе с записями-подклассами. Нужны тому, кто клеит
   * подклассы к одному классу сам ({@link withSubclassRecords}): в итоговом
   * списке таких записей уже нет.
   */
  const classRecords = computed(() => {
    const merged = [...compendiumClasses.value];

    for (const worldClass of worldClasses.value) {
      if (!merged.some((definition) => definition.key === worldClass.key)) {
        merged.push(worldClass);
      }
    }

    return merged;
  });

  const classDefinitions = computed(() =>
    mergeSubclassRecords(classRecords.value),
  );

  return { classDefinitions, classRecords };
}
