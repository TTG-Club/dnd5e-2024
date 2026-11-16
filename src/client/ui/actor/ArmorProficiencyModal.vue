<script setup lang="ts">
  import type { ProficiencyBaseType } from './utils/proficiencySelection';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  import { useSystemDataStore } from '../../stores/systemDataStore';
  import { MODAL_BUTTON_LABELS, PROFICIENCY_MODAL_LABELS } from './constants';
  import {
    isProficiencyCategorySelected,
    isProficiencyItemSelected,
    toggleProficiencyCategory,
    toggleProficiencyItem,
  } from './utils/proficiencySelection';

  /** Блокирующий модал — фиксированный z-index поверх остальных */
  const MODAL_Z_INDEX = Z_INDEX.MODAL_ELEVATED;

  interface Props {
    open: boolean;
    /** Текущие владения бронёй (ключи) */
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

  const systemDataStore = useSystemDataStore();

  /** Локальная копия владений */
  const localSelected = ref<Set<string>>(new Set());

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        localSelected.value = new Set(props.selected);
      }
    },
  );

  /** Конфигурация панелей */
  const panels = computed(() => [
    {
      key: 'light' as const,
      title: PROFICIENCY_MODAL_LABELS.armorLight,
      color: 'text-primary',
      items: systemDataStore.armorBaseTypes.filter(
        (baseType) => baseType.category === 'light',
      ),
    },
    {
      key: 'medium' as const,
      title: PROFICIENCY_MODAL_LABELS.armorMedium,
      color: 'text-primary',
      items: systemDataStore.armorBaseTypes.filter(
        (baseType) => baseType.category === 'medium',
      ),
    },
    {
      key: 'heavy' as const,
      title: PROFICIENCY_MODAL_LABELS.armorHeavy,
      color: 'text-primary',
      items: systemDataStore.armorBaseTypes.filter(
        (baseType) => baseType.category === 'heavy',
      ),
    },
    {
      key: 'shield' as const,
      title: PROFICIENCY_MODAL_LABELS.armorShields,
      color: 'text-primary',
      items: systemDataStore.armorBaseTypes.filter(
        (baseType) => baseType.category === 'shield',
      ),
    },
  ]);

  /**
   * Переключает владение конкретной бронёй с учётом владения всей категорией.
   *
   * @param item - базовый тип доспеха
   */
  function toggleItem(item: ProficiencyBaseType): void {
    localSelected.value = toggleProficiencyItem(
      localSelected.value,
      item,
      systemDataStore.armorBaseTypes.filter(
        (baseType) => baseType.category === item.category,
      ),
    );
  }

  /**
   * Переключает «Все» в категории.
   *
   * @param category - ключ категории
   */
  function toggleAllCategory(category: string): void {
    const panel = panels.value.find((entry) => entry.key === category);

    if (!panel) {
      return;
    }

    localSelected.value = toggleProficiencyCategory(
      localSelected.value,
      category,
      panel.items,
    );
  }

  /**
   * Проверяет, выбраны ли все элементы категории явно либо её ключом.
   *
   * @param category - ключ категории
   */
  function isAllCategorySelected(category: string): boolean {
    const panel = panels.value.find((entry) => entry.key === category);

    return panel
      ? isProficiencyCategorySelected(
          localSelected.value,
          category,
          panel.items,
        )
      : false;
  }

  /**
   * Проверяет владение конкретным доспехом с учётом его категории.
   *
   * @param item - базовый тип доспеха
   */
  function isItemSelected(item: ProficiencyBaseType): boolean {
    return isProficiencyItemSelected(localSelected.value, item);
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
    :title="PROFICIENCY_MODAL_LABELS.armorTitle"
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

              <UTooltip :text="PROFICIENCY_MODAL_LABELS.proficient">
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
                {{ PROFICIENCY_MODAL_LABELS.allPrefix }}{{ panel.title }}
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
                :model-value="isItemSelected(item)"
                @update:model-value="toggleItem(item)"
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
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applySelection"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
