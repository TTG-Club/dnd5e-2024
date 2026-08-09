import type { ClassDefinition } from '@vtt/shared/system/dnd.js';

import { computed, onMounted, ref } from 'vue';

import { loadCompendiumKind } from '@/core/compendiumDataClient';
import { useChatStore } from '@/stores/chatStore';
import { useItemsStore } from '@/stores/itemsStore';

/**
 * Проверяет, что значение — определение класса.
 *
 * @param value - произвольное значение
 */
function isClassDefinition(value: unknown): value is ClassDefinition {
  return (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'class'
  );
}

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

  const classDefinitions = computed(() => {
    const merged = [...compendiumClasses.value];

    for (const worldClass of worldClasses.value) {
      if (!merged.some((definition) => definition.key === worldClass.key)) {
        merged.push(worldClass);
      }
    }

    return merged;
  });

  return { classDefinitions };
}
