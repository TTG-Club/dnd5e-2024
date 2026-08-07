<script setup lang="ts">
  import { TOOL_CATEGORIES, TOOLS_LIST } from '@vtt/shared/system/dnd.js';
  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  import { useToolVocabulary } from '../../composables/useToolVocabulary';

  /** Блокирующий модал — фиксированный z-index поверх остальных */
  const MODAL_Z_INDEX = Z_INDEX.MODAL_ELEVATED;

  interface Props {
    open: boolean;
    /** Текущие владения инструментами (ключи) */
    selected: string[];
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [selected: string[]];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Системный список + инструменты, заведённые в мире */
  const { vocabulary } = useToolVocabulary();

  /** Локальная копия владений */
  const localSelected = ref<Set<string>>(new Set());

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        // Незнакомые ключи отсеиваются: сохранить можно только то, что окно
        // показывает, иначе «Применить» без правок стёрло бы владение. Словарь
        // включает заведённые в мире инструменты — они сюда и попадают.
        const knownKeys = new Set(vocabulary.value.map((entry) => entry.key));

        localSelected.value = new Set(
          props.selected.filter((key) => knownKeys.has(key)),
        );
      }
    },
  );

  /**
   * Инструменты мира, которых нет в системном списке — отдельной панелью, чтобы
   * категории из системного словаря остались нетронутыми.
   */
  const worldTools = computed(() => {
    const systemKeys = new Set(TOOLS_LIST.map((tool) => tool.key));

    return vocabulary.value
      .filter((entry) => !systemKeys.has(entry.key))
      .map((entry) => ({ key: entry.key, name: entry.label }));
  });

  /** Конфигурация панелей */
  const panels = computed(() => {
    // Получаем уникальные категории из TOOLS_LIST
    const categories = Array.from(
      new Set(TOOLS_LIST.map((token) => token.category)),
    );

    const result: Array<{
      key: string;
      title: string;
      color: string;
      items: Array<{ key: string; name: string }>;
    }> = categories.map((catKey) => {
      return {
        key: String(catKey),
        title: TOOL_CATEGORIES[catKey],
        color: 'text-primary',
        items: TOOLS_LIST.filter((bt) => bt.category === catKey).map(
          (toolEntry) => ({
            key: toolEntry.key,
            name: toolEntry.label,
          }),
        ),
      };
    });

    if (worldTools.value.length > 0) {
      result.push({
        key: 'world',
        title: 'Заведённые в мире',
        color: 'text-primary',
        items: worldTools.value,
      });
    }

    return result;
  });

  /**
   * Переключает владение конкретным инструментом
   */
  function toggleItem(key: string): void {
    const set = new Set(localSelected.value);

    if (set.has(key)) {
      set.delete(key);
    } else {
      set.add(key);
    }

    localSelected.value = set;
  }

  /**
   * Переключает «Все» в категории
   */
  function toggleAllCategory(category: string): void {
    const panel = panels.value.find((playlist) => playlist.key === category);

    if (!panel) {
      return;
    }

    const allKeys = panel.items.map((item) => item.key);
    const set = new Set(localSelected.value);
    const allSelected = allKeys.every((key) => set.has(key));

    if (allSelected) {
      for (const key of allKeys) {
        set.delete(key);
      }
    } else {
      for (const key of allKeys) {
        set.add(key);
      }
    }

    localSelected.value = set;
  }

  /**
   * Проверяет, выбраны ли все элементы категории
   */
  function isAllCategorySelected(category: string): boolean {
    const panel = panels.value.find((playlist) => playlist.key === category);

    if (!panel || panel.items.length === 0) {
      return false;
    }

    return panel.items.every((item) => localSelected.value.has(item.key));
  }

  /**
   * Применяет выбранные владения
   */
  function applySelection(): void {
    emit('apply', [...localSelected.value]);
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="600"
    :min-height="350"
    title="Владение инструментами"
    :z-index="MODAL_Z_INDEX"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <!-- 4 панели: 2×2 -->
        <div class="grid grid-cols-2 gap-4">
          <div
            v-for="panel in panels"
            :key="panel.key"
            class="rounded-lg border border-default/50 bg-elevated/30 p-2"
          >
            <div
              class="mb-2 border-b border-default/50 pb-2 text-center text-xs font-bold tracking-wider uppercase"
              :class="panel.color"
            >
              {{ panel.title }}
            </div>

            <!-- Заголовок столбца -->
            <div
              class="mb-1 grid items-center px-1"
              style="grid-template-columns: 1fr 16px; gap: 4px"
            >
              <span />

              <UTooltip text="Владение">
                <UIcon
                  name="tabler:circle-dot"
                  class="mx-auto block h-3.5 w-3.5 text-healing"
                />
              </UTooltip>
            </div>

            <!-- Все категории -->
            <div
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 text-sm font-semibold text-highlighted">
                Все {{ panel.title }}
              </span>

              <UCheckbox
                :model-value="isAllCategorySelected(panel.key)"
                @update:model-value="toggleAllCategory(panel.key)"
              />
            </div>

            <!-- Список -->
            <div
              v-for="item in panel.items"
              :key="item.key"
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 truncate text-sm text-toned">
                {{ item.name }}
              </span>

              <UCheckbox
                :model-value="localSelected.has(item.key)"
                @update:model-value="toggleItem(item.key)"
              />
            </div>
          </div>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            Отмена
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applySelection"
          >
            Применить
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
