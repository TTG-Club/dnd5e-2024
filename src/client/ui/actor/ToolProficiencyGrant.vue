<script setup lang="ts">
  /**
   * Выдача владения инструментами по тексту из компендиума.
   *
   * Компендиум присылает владение прозой («Инструменты каллиграфа», «Один
   * музыкальный инструмент на ваш выбор»), а лист персонажа хранит ключи словаря.
   * Блок сопоставляет текст со словарём и показывает три исхода: узнанное —
   * готовым владением, «на выбор» — выбором из категории, неузнанное — предложением
   * завести инструмент. Общий для мастеров класса и предыстории: логика разбора
   * одна, дублировать её по мастерам незачем.
   */
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    ResolvedToolProficiency,
    ToolVocabularyEntry,
  } from '@vtt/shared/system/dnd.js';

  import { computed, watch } from 'vue';

  import {
    resolveToolProficiencies,
    TOOL_GROUP_CATEGORY,
    toolChoiceGroupId,
    TOOLS_LIST,
  } from '@vtt/shared/system/dnd.js';

  import { useToolVocabulary } from '../../composables/useToolVocabulary';
  import {
    GRANT_SECTION_LABELS,
    TOOL_PROFICIENCY_GRANT_LABELS,
  } from './constants';

  const props = defineProps<{
    /** Позиции владения, как они пришли из компендиума (текст или готовые ключи) */
    sources: string[];
    socket: TypedWebSocketClient | null;
  }>();

  const emit = defineEmits<{
    /** Все обязательные выборы сделаны — мастер может пускать дальше */
    'update:complete': [value: boolean];
  }>();

  /**
   * Группа «инструмент на выбор» вместе с вариантами и состоянием набора.
   * Счётчик и предел выбора у каждой группы свои: позиций «на выбор» может
   * прийти сразу несколько («три музыкальных инструмента» и «инструмент
   * ремесленника»), и общий на всех счётчик засчитывал бы выбор одной группы
   * в другую.
   */
  interface ToolChoiceGroup {
    /** Ключ показа: позиция может предлагать выбор сразу из нескольких групп */
    key: string;
    /** Подпись позиции, как её прислал компендиум */
    source: string;
    /** Сколько инструментов выбирают в этой группе */
    required: number;
    /** Варианты выбора — инструменты категорий группы */
    options: ToolVocabularyEntry[];
    /** Выбранное в этой группе, в порядке выбора */
    chosen: string[];
    isComplete: boolean;
  }

  /** Ключи владений, которые уедут на лист персонажа */
  const selected = defineModel<string[]>('selected', { default: () => [] });

  const { vocabulary, createToolItem } = useToolVocabulary();

  const resolved = computed<ResolvedToolProficiency[]>(() =>
    resolveToolProficiencies(props.sources, vocabulary.value),
  );

  /** Узнанные инструменты — выдаются без вопросов */
  const fixed = computed(() =>
    resolved.value.filter(
      (entry): entry is Extract<ResolvedToolProficiency, { kind: 'tool' }> =>
        entry.kind === 'tool',
    ),
  );

  /** Группы «инструмент на выбор» */
  const groups = computed(() =>
    resolved.value.filter(
      (entry): entry is Extract<ResolvedToolProficiency, { kind: 'group' }> =>
        entry.kind === 'group',
    ),
  );

  /** Позиции, которых в словаре нет — их можно завести */
  const unknowns = computed(() =>
    resolved.value.filter(
      (entry): entry is Extract<ResolvedToolProficiency, { kind: 'unknown' }> =>
        entry.kind === 'unknown',
    ),
  );

  /** Ключи узнанных инструментов — они всегда в выборе */
  const fixedKeys = computed(() => fixed.value.map((entry) => entry.key));

  /** Группы «на выбор» со своими вариантами, счётчиком и пределом */
  const choiceGroups = computed<ToolChoiceGroup[]>(() =>
    groups.value.map((group) => {
      // Категорий может быть несколько: «инструменты ремесленника ИЛИ
      // музыкальный инструмент» — один выбор, варианты из обеих.
      const categories = group.keys.map((key) => TOOL_GROUP_CATEGORY[key]);

      // Узнанное владение вариантом не показываем: оно уже выдано, выбирать
      // его повторно нечего — и место в группе оно не занимает.
      const options: ToolVocabularyEntry[] = TOOLS_LIST.filter(
        (tool) =>
          categories.includes(tool.category)
          && !fixedKeys.value.includes(tool.key),
      );

      const optionKeys = new Set(options.map((option) => option.key));

      // Порядок берём из `selected` — это и есть порядок выбора, по нему
      // вытесняется самый ранний. Заодно в группу не попадает инструмент,
      // заведённый по неузнанной позиции: его в вариантах категории нет.
      const chosen = selected.value.filter((key) => optionKeys.has(key));

      return {
        key: toolChoiceGroupId(group.keys),
        source: group.source,
        required: group.count,
        options,
        chosen,
        isComplete: chosen.length >= group.count,
      };
    }),
  );

  const isComplete = computed(() =>
    choiceGroups.value.every((group) => group.isComplete),
  );

  /** Класс счётчика группы: зелёный, когда в ней набрано нужное количество */
  function counterClass(group: ToolChoiceGroup): string {
    return group.isComplete ? 'text-healing' : 'text-dimmed';
  }

  /** Цвет бейджа варианта: выбранный подсвечен основным цветом */
  function optionColor(key: string): 'primary' | 'neutral' {
    return selected.value.includes(key) ? 'primary' : 'neutral';
  }

  /** Начертание бейджа варианта: выбранный залит */
  function optionVariant(key: string): 'solid' | 'soft' {
    return selected.value.includes(key) ? 'solid' : 'soft';
  }

  /**
   * Переключает выбор инструмента внутри его группы.
   *
   * @param group - группа, из вариантов которой выбирают
   * @param key - ключ инструмента
   */
  function toggleTool(group: ToolChoiceGroup, key: string): void {
    if (group.chosen.includes(key)) {
      selected.value = selected.value.filter((entry) => entry !== key);

      return;
    }

    // Достигли нужного количества — новый выбор вытесняет самый ранний в этой
    // же группе, иначе игрок упирается в предел и не понимает, что снимать.
    const excess = group.chosen.length + 1 - group.required;
    const dropped = excess > 0 ? group.chosen.slice(0, excess) : [];

    selected.value = [
      ...selected.value.filter((entry) => !dropped.includes(entry)),
      key,
    ];
  }

  /** Заводит неузнанный инструмент предметом мира и сразу выдаёт владение. */
  function createAndGrant(source: string): void {
    const key = createToolItem(source, props.socket);

    if (key && !selected.value.includes(key)) {
      selected.value = [...selected.value, key];
    }
  }

  // Узнанные владения держим в выборе всегда: они не обсуждаются, а список
  // пересобирается при смене класса/предыстории.
  watch(
    fixedKeys,
    (keys) => {
      const missing = keys.filter((key) => !selected.value.includes(key));

      if (missing.length > 0) {
        selected.value = [...selected.value, ...missing];
      }
    },
    { immediate: true },
  );

  watch(isComplete, (value) => emit('update:complete', value), {
    immediate: true,
  });
</script>

<template>
  <div
    v-if="resolved.length > 0"
    class="space-y-3"
  >
    <!-- Узнанные владения -->
    <div v-if="fixed.length > 0">
      <span class="mb-1 block text-sm font-medium text-muted">{{
        GRANT_SECTION_LABELS.tools
      }}</span>

      <div class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="entry in fixed"
          :key="entry.key"
          :label="entry.label"
          color="success"
          variant="soft"
          size="md"
        />
      </div>
    </div>

    <!-- Выбор из категории -->
    <div
      v-for="group in choiceGroups"
      :key="group.key"
      class="rounded-lg border border-default/50 bg-elevated/30 p-3"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm font-medium text-toned">
          {{ group.source }}
        </span>

        <span
          class="text-xs"
          :class="counterClass(group)"
        >
          {{ group.chosen.length }} / {{ group.required }}
        </span>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="option in group.options"
          :key="option.key"
          :label="option.label"
          :color="optionColor(option.key)"
          :variant="optionVariant(option.key)"
          size="md"
          class="cursor-pointer"
          @click.left.exact.prevent="toggleTool(group, option.key)"
        />
      </div>
    </div>

    <!-- Неузнанные позиции -->
    <div
      v-for="entry in unknowns"
      :key="entry.source"
      class="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <div class="min-w-0">
        <p class="truncate text-sm text-toned">{{ entry.source }}</p>

        <p class="text-xs text-dimmed">
          {{ TOOL_PROFICIENCY_GRANT_LABELS.unknownHint }}
        </p>
      </div>

      <UButton
        size="xs"
        color="warning"
        variant="soft"
        icon="tabler:plus"
        :disabled="!socket"
        @click.left.exact.prevent="createAndGrant(entry.source)"
      >
        {{ TOOL_PROFICIENCY_GRANT_LABELS.createAndGrant }}
      </UButton>
    </div>
  </div>
</template>
