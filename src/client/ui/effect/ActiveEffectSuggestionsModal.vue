<!--
  Библиотека подсказок для окна эффекта: ключи модификаторов, значения и
  формулы, флаги и шаблоны условий.

  Одно окно на все четыре списка: они отличаются только источником данных и
  подписями, а поиск, разделы, разметка и размеры у них общие.
-->
<script setup lang="ts">
  import type { EffectLibrarySuggestion } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';

  import {
    ACTIVE_EFFECT_TEMPLATES_LABELS,
    EFFECT_TEMPLATES_MODAL_SIZE,
    SUGGESTION_SECTION_BUTTON,
  } from './constants';
  import {
    groupSuggestionsBySection,
    listSuggestionSections,
    matchesSuggestionQuery,
  } from './utils/suggestionSections';

  interface Props {
    open: boolean;
    /** Заголовок окна */
    title: string;
    /** Подсказка поля поиска */
    searchPlaceholder: string;
    /** Текст, когда поиск ничего не нашёл */
    emptyLabel: string;
    /** Список подсказок; разделы идут в порядке первого появления */
    items: readonly EffectLibrarySuggestion[];
    /** Ключ окна в менеджере окон хоста */
    modalId: string;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'select': [value: string];
    'bring-to-front': [];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const searchQuery = ref('');

  /** Выбранный раздел; `undefined` — все разделы */
  const activeSection = ref<string | undefined>(undefined);

  /** Кнопки разделов: «Все» и каждый раздел, выбранный подсвечен */
  const sectionButtons = computed(() =>
    [undefined, ...listSuggestionSections(props.items)].map((section) => ({
      section,
      label: section ?? ACTIVE_EFFECT_TEMPLATES_LABELS.allSections,
      ...(section === activeSection.value
        ? SUGGESTION_SECTION_BUTTON.active
        : SUGGESTION_SECTION_BUTTON.idle),
    })),
  );

  /** Кнопки нужны, только когда разделов больше одного («Все» не в счёт) */
  const showSectionButtons = computed(() => sectionButtons.value.length > 2);

  /** Разделы со строками, прошедшими выбор раздела и поиск */
  const visibleSections = computed(() => {
    const queryText = searchQuery.value.toLowerCase().trim();

    return groupSuggestionsBySection(
      props.items.filter(
        (suggestion) =>
          (activeSection.value === undefined
            || suggestion.section === activeSection.value)
          && (!queryText || matchesSuggestionQuery(suggestion, queryText)),
      ),
    );
  });

  /** Заголовки разделов нужны, только когда на экране их больше одного */
  const showSectionTitles = computed(() => visibleSections.value.length > 1);

  /**
   * Выбирает раздел.
   *
   * @param section - раздел; `undefined` — все
   */
  function selectSection(section: string | undefined): void {
    activeSection.value = section;
  }

  /**
   * Отдаёт выбранное значение и закрывает окно.
   *
   * @param value - значение выбранной строки
   */
  function handleSelect(value: string): void {
    emit('select', value);
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :title="title"
    :initial-width="EFFECT_TEMPLATES_MODAL_SIZE.width"
    :initial-height="EFFECT_TEMPLATES_MODAL_SIZE.height"
    :min-width="EFFECT_TEMPLATES_MODAL_SIZE.minWidth"
    :min-height="EFFECT_TEMPLATES_MODAL_SIZE.minHeight"
    :modal-id="modalId"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div class="flex h-full w-full flex-col gap-2 p-2">
        <UInput
          v-model="searchQuery"
          icon="tabler:search"
          :placeholder="searchPlaceholder"
          size="sm"
          class="w-full shrink-0"
          clearable
        />

        <div
          v-if="showSectionButtons"
          class="flex shrink-0 flex-wrap gap-1"
        >
          <UButton
            v-for="button in sectionButtons"
            :key="button.label"
            :label="button.label"
            :variant="button.variant"
            :color="button.color"
            size="xs"
            @click.left.exact.prevent="selectSection(button.section)"
          />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <section
            v-for="section in visibleSections"
            :key="section.label"
            class="mb-2 space-y-1"
          >
            <div
              v-if="showSectionTitles"
              class="sticky top-0 z-10 bg-default px-2 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase"
            >
              {{ section.label }}
            </div>

            <div
              v-for="row in section.rows"
              :key="row.suggestion.value"
              class="group flex cursor-pointer flex-col gap-0.5 rounded border border-transparent px-2 py-1.5 transition-colors hover:border-default/50 hover:bg-elevated/60"
              @click.left.exact.prevent="handleSelect(row.suggestion.value)"
            >
              <div class="text-[13px] font-medium text-highlighted">
                {{ row.suggestion.label }}
              </div>

              <div class="font-mono text-[11px] text-dimmed">
                {{ row.suggestion.value }}
              </div>

              <div
                v-if="row.showHint"
                class="text-[11px] text-muted"
              >
                {{ row.suggestion.hint }}
              </div>
            </div>
          </section>

          <div
            v-if="visibleSections.length === 0"
            class="py-8 text-center text-sm text-dimmed"
          >
            {{ emptyLabel }}
          </div>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
