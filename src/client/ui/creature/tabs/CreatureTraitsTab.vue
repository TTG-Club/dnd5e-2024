<script setup lang="ts">
  import type { CreatureAction, DnDCreature } from '@vtt/shared/system/dnd.js';

  import { computed, ref, useTemplateRef } from 'vue';

  import {
    FILTER_ROW_CONTROL_SIZE,
    MODAL_BUTTON_LABELS,
    SHEET_FILTER_LABELS,
  } from '../../actor/constants';
  import FilterResetButton from '../../actor/FilterResetButton.vue';
  import { CREATURE_EMPTY_LABELS } from '../constants';
  import CreatureActionsBlock from '../CreatureActionsBlock.vue';

  interface Props {
    creature: DnDCreature;
    isEditMode: boolean;
    /** Режим только просмотр (компендиум) */
    isReadOnly?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    isReadOnly: false,
  });

  const emit = defineEmits<{
    'update:traits': [traits: CreatureAction[]];
  }>();

  const searchQuery = ref('');

  /** Форма новой особенности живёт в списке — кнопка ряда открывает её оттуда */
  const traitsBlock =
    useTemplateRef<InstanceType<typeof CreatureActionsBlock>>('traitsBlock');

  /** Кнопку «Добавить» показываем в ряду отбора — раздел на вкладке один */
  const canAdd = computed(() => props.isEditMode && !props.isReadOnly);

  /**
   * Ряд отбора: чипов у одного раздела нет, остаются поиск и «Добавить».
   * Пустой вкладке вне правки листа ряд не нужен — искать в ней нечего.
   */
  const hasFilterControls = computed(
    () => props.creature.system.traits.length > 0 || canAdd.value,
  );

  /** Поиск сужает список — есть что сбросить */
  const hasAnyFilter = computed(() => searchQuery.value.trim() !== '');

  /** Нашлась ли хоть одна особенность под поиском */
  const hasVisibleRows = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();

    return props.creature.system.traits.some(
      (trait) =>
        !query
        || trait.name.toLowerCase().includes(query)
        || (trait.nameEn ?? '').toLowerCase().includes(query),
    );
  });

  function clearSearch(): void {
    searchQuery.value = '';
  }

  function resetFilters(): void {
    searchQuery.value = '';
  }

  function addTrait(): void {
    traitsBlock.value?.openCreateForm();
  }
</script>

<template>
  <div class="flex min-h-50 flex-1 flex-col space-y-3">
    <!-- Шапка вкладки одной строкой: поиск, сброс и «Добавить» держатся
      правого края — тот же ряд, что и у особенностей листа персонажа -->
    <div
      v-if="hasFilterControls"
      class="flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      <UInput
        v-model="searchQuery"
        icon="tabler:search"
        :placeholder="SHEET_FILTER_LABELS.search"
        :size="FILTER_ROW_CONTROL_SIZE"
        class="ml-auto w-40 shrink-0"
        :ui="{ trailing: 'pe-0.5' }"
      >
        <template
          v-if="searchQuery"
          #trailing
        >
          <UButton
            icon="tabler:x"
            color="neutral"
            variant="link"
            :size="FILTER_ROW_CONTROL_SIZE"
            :aria-label="SHEET_FILTER_LABELS.clear"
            @click.left.exact.prevent="clearSearch"
          />
        </template>
      </UInput>

      <!-- Правый край ряда держится одной группой: при переносе сброс уезжает
        на новую строку вместе с кнопкой, а не отрывается от неё -->
      <div class="flex shrink-0 items-center gap-x-1.5">
        <FilterResetButton
          v-if="hasAnyFilter"
          @reset="resetFilters"
        />

        <UButton
          v-if="canAdd"
          icon="tabler:plus"
          color="primary"
          variant="soft"
          :size="FILTER_ROW_CONTROL_SIZE"
          @click.left.exact.prevent="addTrait"
        >
          {{ MODAL_BUTTON_LABELS.add }}
        </UButton>
      </div>
    </div>

    <CreatureActionsBlock
      ref="traitsBlock"
      mode="trait"
      :actions="creature.system.traits"
      :is-edit-mode="isEditMode"
      :is-read-only="isReadOnly"
      :creature-id="creature.id"
      :creature-name="creature.name"
      :search="searchQuery"
      :show-header="false"
      @update="emit('update:traits', $event)"
    />

    <p
      v-if="creature.system.traits.length === 0"
      class="py-4 text-center text-sm text-dimmed"
    >
      {{ CREATURE_EMPTY_LABELS.traits }}
    </p>

    <p
      v-else-if="hasAnyFilter && !hasVisibleRows"
      class="py-4 text-center text-sm text-dimmed"
    >
      {{ SHEET_FILTER_LABELS.empty }}
    </p>
  </div>
</template>
