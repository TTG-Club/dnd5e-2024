/**
 * Словарь владений инструментами: системный список плюс заведённые в мире.
 *
 * Раньше словарь жил только в коде (`TOOLS_LIST`), поэтому инструмент, которого в
 * нём нет, невозможно было выдать персонажу: окно выбора показывает лишь знакомые
 * ключи и молча выбрасывает остальные. Теперь словарь расширяется предметами типа
 * `tool` из панели «Предметы» — благодаря этому «завести инструмент» действительно
 * создаёт новое владение, доступное и в окне выбора, и мастерам класса/предыстории.
 *
 * @module systems/dnd5e/composables/useToolVocabulary
 */

import type { TypedWebSocketClient } from '@vtt/shared';
import type { GameItem, ToolVocabularyEntry } from '@vtt/shared/system/dnd.js';

import { generateId } from '@vtt/shared';
import { TOOLS_LIST } from '@vtt/shared/system/dnd.js';
import { computed } from 'vue';

import { useItemsStore } from '@/stores/itemsStore';

/**
 * Ключ владения для предмета-инструмента мира: базовый тип, если он выбран в
 * форме предмета, иначе слаг из английского (или русского) названия. Слаг
 * стабилен — от переименования предмета уже выданное владение не потеряется
 * только при сохранённом базовом типе, поэтому форма его и предлагает.
 *
 * @param item - предмет мира типа `tool`
 */
export function toolItemKey(item: GameItem): string {
  if (item.baseToolType) {
    return item.baseToolType;
  }

  const source = item.nameEn?.trim() || item.name.trim();

  return source
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Собирает словарь владений: системные инструменты + предметы мира типа `tool`.
 * Предмет, чей ключ уже есть в системном списке, отдельной позицией не идёт —
 * это тот же инструмент, просто заведённый как предмет.
 */
export function useToolVocabulary() {
  const itemsStore = useItemsStore();

  const vocabulary = computed<ToolVocabularyEntry[]>(() => {
    const entries: ToolVocabularyEntry[] = TOOLS_LIST.map((tool) => ({
      key: tool.key,
      label: tool.label,
    }));

    const known = new Set(entries.map((entry) => entry.key));

    for (const item of itemsStore.itemsByType('tool')) {
      const key = toolItemKey(item);

      if (!key || known.has(key)) {
        continue;
      }

      known.add(key);
      entries.push({ key, label: item.name });
    }

    return entries;
  });

  /** Названия по ключу — для отображения владений, заведённых в мире. */
  const labels = computed<Record<string, string>>(() =>
    Object.fromEntries(vocabulary.value.map((entry) => [entry.key, entry.label])),
  );

  /**
   * Заводит инструмент как предмет мира — так у него появляется ключ владения,
   * который дальше виден и в окне выбора, и в мастерах.
   *
   * @param name - название инструмента, как оно пришло из компендиума
   * @param socket - активный сокет мира
   * @returns ключ созданного владения либо `null`, если создать не удалось
   */
  function createToolItem(
    name: string,
    socket: TypedWebSocketClient | null,
  ): string | null {
    const trimmed = name.trim();

    if (!trimmed || !socket) {
      return null;
    }

    const item: GameItem = {
      id: `item_${generateId('tool')}`,
      name: trimmed,
      description: '',
      type: 'tool',
      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common',
      equipped: false,
      isReadOnly: false,
      toolCategory: 'other',
    };

    const key = toolItemKey(item);

    if (!key) {
      return null;
    }

    itemsStore.saveItem(socket, item, true);

    return key;
  }

  return { vocabulary, labels, createToolItem };
}
