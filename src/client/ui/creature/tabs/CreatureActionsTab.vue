<script setup lang="ts">
  import type { CreatureAction, DnDCreature } from '@vtt/shared/system/dnd.js';

  import type { CreatureActionSectionKey } from '../constants';

  import { computed, ref } from 'vue';

  import {
    FILTER_ROW_CONTROL_SIZE,
    SHEET_FILTER_LABELS,
  } from '../../actor/constants';
  import FilterChip from '../../actor/FilterChip.vue';
  import FilterResetButton from '../../actor/FilterResetButton.vue';
  import {
    CREATURE_ACTION_SECTIONS,
    CREATURE_EMPTY_LABELS,
  } from '../constants';
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
    'update:actions': [actions: CreatureAction[]];
    'update:bonusActions': [actions: CreatureAction[]];
    'update:reactions': [actions: CreatureAction[]];
    'update:legendaryActions': [actions: CreatureAction[]];
    'update:legendaryCount': [count: number];
  }>();

  const searchQuery = ref('');

  /** Отмеченные чипами разделы; пусто — вкладка показывает все */
  const pickedSections = ref<Set<CreatureActionSectionKey>>(new Set());

  /** Записи раздела: легендарные лежат внутри своего блока данных */
  function getSectionActions(key: CreatureActionSectionKey): CreatureAction[] {
    const system = props.creature.system;

    if (key === 'legendary') {
      return system.legendary.actions;
    }

    return system[key];
  }

  /**
   * Разделы, которые есть у существа: по ним и отбирают. В режиме правки видны
   * все — иначе в пустой раздел нечем было бы добавить запись.
   */
  const availableSections = computed(() =>
    CREATURE_ACTION_SECTIONS.filter(
      (section) =>
        props.isEditMode || getSectionActions(section.key).length > 0,
    ),
  );

  /** Действующий отбор: отмеченные чипами разделы */
  const activeSections = computed(() =>
    CREATURE_ACTION_SECTIONS.map((section) => section.key).filter((key) =>
      pickedSections.value.has(key),
    ),
  );

  /** Вкладка сужена: отбор есть что сбросить */
  const hasAnyFilter = computed(
    () => activeSections.value.length > 0 || searchQuery.value.trim() !== '',
  );

  /**
   * Чипы разделов. Их всегда четыре, и стоят они в постоянном порядке: разделы
   * задаёт не запись существа, а сами правила, поэтому чип остаётся в ряду и у
   * пустого раздела — иначе ряд отбора менялся бы от существа к существу.
   */
  const sectionChips = computed(() =>
    CREATURE_ACTION_SECTIONS.map((section) => ({
      ...section,
      isPicked: activeSections.value.includes(section.key),
    })),
  );

  /**
   * Разделы на виду после отбора по чипам, уже со всем, что нужно списку:
   * счётчик легендарных действий есть только у своего раздела.
   */
  const visibleSections = computed(() => {
    const picked =
      activeSections.value.length === 0
        ? availableSections.value
        : availableSections.value.filter((section) =>
            activeSections.value.includes(section.key),
          );

    return picked.map((section) => ({
      ...section,
      actions: getSectionActions(section.key),
      legendaryCount:
        section.key === 'legendary'
          ? props.creature.system.legendary.count
          : undefined,
    }));
  });

  /**
   * Нашлась ли хоть одна запись под поиском. Считается по видимым разделам:
   * подпись «под отбор ничего не подошло» ставит вкладка, а не каждый раздел.
   */
  const hasVisibleRows = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();

    return visibleSections.value.some((section) =>
      getSectionActions(section.key).some(
        (action) =>
          !query
          || action.name.toLowerCase().includes(query)
          || (action.nameEn ?? '').toLowerCase().includes(query),
      ),
    );
  });

  /** Вкладка пуста: у существа нет ни одной записи */
  const isEmpty = computed(() =>
    CREATURE_ACTION_SECTIONS.every(
      (section) => getSectionActions(section.key).length === 0,
    ),
  );

  /** Ряд отбора: пустой вкладке он не нужен — ни отбирать, ни искать нечего */
  const hasFilterControls = computed(() => !isEmpty.value);

  /**
   * Нажатие на чип раздела: разделы набираются по одному, повторное нажатие
   * снимает раздел с отбора.
   *
   * @param key - раздел вкладки
   */
  function toggleSectionFilter(key: CreatureActionSectionKey): void {
    const next = new Set(pickedSections.value);

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    pickedSections.value = next;
  }

  function clearSearch(): void {
    searchQuery.value = '';
  }

  /** Нажатие на «Сбросить»: вкладка возвращается целиком */
  function resetFilters(): void {
    pickedSections.value = new Set();
    searchQuery.value = '';
  }

  /**
   * Передаёт наверх обновлённый список раздела: каждый раздел живёт в своём
   * поле системы, и общего события у них нет.
   *
   * @param key - раздел вкладки
   * @param actions - новый список раздела
   */
  function handleSectionUpdate(
    key: CreatureActionSectionKey,
    actions: CreatureAction[],
  ): void {
    if (key === 'actions') {
      emit('update:actions', actions);
    } else if (key === 'bonusActions') {
      emit('update:bonusActions', actions);
    } else if (key === 'reactions') {
      emit('update:reactions', actions);
    } else {
      emit('update:legendaryActions', actions);
    }
  }
</script>

<template>
  <div class="flex min-h-50 flex-1 flex-col space-y-3">
    <!-- Шапка вкладки одной строкой: слева чипы разделов, справа поиск и
      сброс. Ряд тот же, что у вкладок листа персонажа -->
    <div
      v-if="hasFilterControls"
      class="flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      <FilterChip
        v-for="chip in sectionChips"
        :key="chip.key"
        :label="chip.chipLabel"
        :tooltip="chip.chipHint"
        :picked="chip.isPicked"
        @toggle="toggleSectionFilter(chip.key)"
      />

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

      <FilterResetButton
        v-if="hasAnyFilter"
        @reset="resetFilters"
      />
    </div>

    <!-- Разделы вкладки: между ними тот же промежуток, что между группами
      снаряжения на листе персонажа -->
    <div class="flex flex-col gap-5">
      <CreatureActionsBlock
        v-for="section in visibleSections"
        :key="section.key"
        :title="section.title"
        mode="action"
        :actions="section.actions"
        :is-edit-mode="isEditMode"
        :is-read-only="isReadOnly"
        :creature-id="creature.id"
        :creature-name="creature.name"
        :search="searchQuery"
        :legendary-count="section.legendaryCount"
        @update="handleSectionUpdate(section.key, $event)"
        @update:legendary-count="emit('update:legendaryCount', $event)"
      />
    </div>

    <!-- Пустая вкладка объясняется один раз: в режиме правки её место занимают
      заголовки разделов с кнопкой «Добавить» -->
    <p
      v-if="isEmpty && !isEditMode"
      class="py-4 text-center text-sm text-dimmed"
    >
      {{ CREATURE_EMPTY_LABELS.actions }}
    </p>

    <p
      v-else-if="hasAnyFilter && !hasVisibleRows"
      class="py-4 text-center text-sm text-dimmed"
    >
      {{ SHEET_FILTER_LABELS.empty }}
    </p>
  </div>
</template>
