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
  import type { ResolvedToolProficiency } from '@vtt/shared/system/dnd.js';

  import { computed, watch } from 'vue';

  import {
    resolveToolProficiencies,
    TOOL_GROUP_CATEGORY,
    TOOLS_LIST,
  } from '@vtt/shared/system/dnd.js';

  import { useToolVocabulary } from '../../composables/useToolVocabulary';

  const props = defineProps<{
    /** Позиции владения, как они пришли из компендиума (текст или готовые ключи) */
    sources: string[];
    socket: TypedWebSocketClient | null;
  }>();

  const emit = defineEmits<{
    /** Все обязательные выборы сделаны — мастер может пускать дальше */
    'update:complete': [value: boolean];
  }>();

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

  /** Сколько инструментов игрок должен выбрать сверх узнанных */
  const requiredChoices = computed(() =>
    groups.value.reduce((sum, group) => sum + group.count, 0),
  );

  /** Выбранное игроком сверх узнанных */
  const chosen = computed(() =>
    selected.value.filter((key) => !fixedKeys.value.includes(key)),
  );

  const isComplete = computed(
    () => chosen.value.length >= requiredChoices.value,
  );

  /** Класс счётчика выбранного: зелёный, когда набрано нужное количество */
  const counterClass = computed(() =>
    isComplete.value ? 'text-healing' : 'text-dimmed',
  );

  /** Варианты выбора для группы — инструменты её категории */
  function groupOptions(groupKey: string) {
    const category = TOOL_GROUP_CATEGORY[groupKey];

    return TOOLS_LIST.filter((tool) => tool.category === category);
  }

  /** Цвет бейджа варианта: выбранный подсвечен основным цветом */
  function optionColor(key: string): 'primary' | 'neutral' {
    return selected.value.includes(key) ? 'primary' : 'neutral';
  }

  /** Начертание бейджа варианта: выбранный залит */
  function optionVariant(key: string): 'solid' | 'soft' {
    return selected.value.includes(key) ? 'solid' : 'soft';
  }

  function toggleTool(key: string): void {
    if (fixedKeys.value.includes(key)) {
      return;
    }

    if (selected.value.includes(key)) {
      selected.value = selected.value.filter((entry) => entry !== key);

      return;
    }

    // Достигли нужного количества — новый выбор вытесняет самый ранний,
    // иначе игрок упирается в предел и не понимает, что снимать.
    const next = [...chosen.value, key];

    if (next.length > requiredChoices.value) {
      next.splice(0, next.length - requiredChoices.value);
    }

    selected.value = [...fixedKeys.value, ...next];
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
      <span class="mb-1 block text-sm font-medium text-muted">Инструменты</span>

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
      v-for="group in groups"
      :key="group.key"
      class="rounded-lg border border-default/50 bg-elevated/30 p-3"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm font-medium text-toned">
          {{ group.source }}
        </span>

        <span
          class="text-xs"
          :class="counterClass"
        >
          {{ chosen.length }} / {{ requiredChoices }}
        </span>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="option in groupOptions(group.key)"
          :key="option.key"
          :label="option.label"
          :color="optionColor(option.key)"
          :variant="optionVariant(option.key)"
          size="md"
          class="cursor-pointer"
          @click.left.exact.prevent="toggleTool(option.key)"
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
          Такого инструмента нет в справочнике — можно завести
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
        Завести и выдать
      </UButton>
    </div>
  </div>
</template>
