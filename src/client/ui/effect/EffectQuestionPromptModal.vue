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

  import {
    HUD_PROMPT_PANEL_CLASS,
    HUD_PROMPTS_TELEPORT_TARGET,
  } from '../actor/constants';
  import { EFFECT_QUESTION_PROMPT_LABELS } from './constants';
  import { formatPromptTitle } from './utils/promptTitle';

  defineOptions({
    inheritAttrs: false,
  });

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
  <Teleport :to="HUD_PROMPTS_TELEPORT_TARGET">
    <Transition name="slide-up">
      <div
        v-if="open"
        :class="HUD_PROMPT_PANEL_CLASS"
      >
        <div class="flex items-center gap-2 border-b border-muted/50 pb-2">
          <UIcon
            name="tabler:help-circle"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ title }}
          </span>
        </div>

        <p class="text-sm break-words text-toned">
          {{ question }}
        </p>

        <p
          v-if="effectSummary"
          class="text-xs break-words text-dimmed"
        >
          {{ EFFECT_QUESTION_PROMPT_LABELS.summaryPrefix }}{{ effectSummary }}
        </p>

        <div class="flex flex-wrap items-center justify-end gap-2">
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
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
