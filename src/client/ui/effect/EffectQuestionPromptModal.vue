<!--
  Плашка вопроса человеку: одно окно на все «можете» из правил — пустить ли
  срабатывание в ход, потратить ли реакцию, перевести ли эффект на следующую
  ступень.

  Варианты ответа приходят закрытым списком от того, кто спрашивает: ответить
  тем, чего не предлагали, нельзя (движок сверяет ответ с тем же списком).
  Закрытие плашки — отказ; где отказ уже есть среди вариантов, крестика нет
  (`hideCancel`).
-->
<script setup lang="ts">
  import type { EffectPromptOption } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { HudPromptPanel } from '@/shared_ui/components';

  import { EFFECT_QUESTION_PROMPT_LABELS } from './constants';
  import { formatPromptTitle } from './utils/promptTitle';

  const props = defineProps<{
    open: boolean;
    modalId: string;
    /** О чём спрашивают */
    question: string;
    /** Варианты ответа */
    options: readonly EffectPromptOption[];
    /** Чей вопрос — «Опутывание» */
    sourceName?: string;
    /** Что случится по согласию */
    effectSummary?: string;
    /**
     * Без крестика: среди вариантов уже есть отказ («Оставить провал»), и
     * закрытие без ответа значило бы то же самое
     */
    hideCancel?: boolean;
    /** Ответили: ключ выбранного варианта */
    onAnswer: (optionId: string) => void;
    /** Плашку закрыли, не ответив */
    onCancel: () => void;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  const title = computed(() =>
    formatPromptTitle(
      EFFECT_QUESTION_PROMPT_LABELS.titleFallback,
      EFFECT_QUESTION_PROMPT_LABELS.titleSeparator,
      props.sourceName,
    ),
  );

  /**
   * Отдаёт ответ и закрывает плашку.
   *
   * @param optionId - ключ выбранного варианта
   */
  function handleAnswer(optionId: string): void {
    props.onAnswer(optionId);
    emit('update:open', false);
    emit('close');
  }

  /** Закрывает плашку без ответа: согласия нет */
  function handleCancel(): void {
    props.onCancel();
    emit('update:open', false);
    emit('close');
  }
</script>

<template>
  <HudPromptPanel
    :open="open"
    icon="tabler:help-circle"
    :title="title"
  >
    <p class="text-sm break-words text-toned">
      {{ question }}
    </p>

    <p
      v-if="effectSummary"
      class="text-xs break-words text-dimmed"
    >
      {{ EFFECT_QUESTION_PROMPT_LABELS.summaryPrefix }}{{ effectSummary }}
    </p>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton
          v-for="option in options"
          :key="option.id"
          :label="option.label"
          :title="option.hint"
          color="primary"
          variant="soft"
          size="sm"
          @click.left.exact.prevent="handleAnswer(option.id)"
        />

        <UButton
          v-if="!hideCancel"
          icon="tabler:x"
          color="neutral"
          variant="ghost"
          size="sm"
          :title="EFFECT_QUESTION_PROMPT_LABELS.cancel"
          @click.left.exact.prevent="handleCancel"
        />
      </div>
    </template>
  </HudPromptPanel>
</template>
