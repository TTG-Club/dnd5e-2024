<!--
  Плашка «вырваться»: сложность — словами, навыки — кнопками в одну строку с
  бонусом бросающего («Атлетика (+2)»), крестик — отказ.

  Когда Сл взять неоткуда («Схваченный», повешенный рукой ведущего), её
  называет бросающий в поле плашки: навыки без своей Сл ждут числа.
-->
<script setup lang="ts">
  import { computed, ref } from 'vue';

  import { MIN_ESCAPE_SKILL_DC } from '@vtt/shared/system/dnd.js';

  import {
    HUD_PROMPT_PANEL_CLASS,
    HUD_PROMPTS_TELEPORT_TARGET,
  } from '../actor/constants';
  import {
    EFFECT_ESCAPE_ICON,
    EFFECT_ESCAPE_PROMPT_LABELS,
  } from './escapeLabels';

  /** Навык на кнопке плашки */
  interface EscapePromptOption {
    /** Ключ варианта */
    id: string;
    /** Подпись: «Атлетика (+2)» */
    label: string;
    /** У навыка нет своей Сл — он ждёт числа из поля */
    needsDc: boolean;
  }

  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    open: boolean;
    modalId: string;
    /** Заголовок: «Вырваться — Схваченный» */
    title: string;
    /** Кто бросает: ведущий с несколькими фишками видит, за кого действует */
    actorName?: string;
    /** Сл словами; `null` — известной Сл нет */
    difficulty: string | null;
    /** Сл называет бросающий */
    asksDc: boolean;
    /** Сл, названная в прошлую попытку */
    initialDc?: number;
    /** Навыки на выбор */
    options: readonly EscapePromptOption[];
    /** Выбрали навык: ключ варианта и названная Сл, если её спрашивали */
    onAnswer: (optionId: string, askedDc?: number) => void;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  /** Сл, которую вписывает бросающий */
  const askedDc = ref<number | null>(props.initialDc ?? null);

  /** Названная Сл, если она годится для броска */
  const validAskedDc = computed<number | undefined>(() =>
    askedDc.value !== null && askedDc.value >= MIN_ESCAPE_SKILL_DC
      ? Math.trunc(askedDc.value)
      : undefined,
  );

  /** Кнопки навыков: навык без Сл ждёт, пока её назовут */
  const optionRows = computed(() =>
    props.options.map((option) => {
      const isWaiting = option.needsDc && validAskedDc.value === undefined;

      return {
        id: option.id,
        label: option.label,
        disabled: isWaiting,
        title: isWaiting
          ? EFFECT_ESCAPE_PROMPT_LABELS.difficultyMissing
          : option.label,
      };
    }),
  );

  /** Закрывает плашку */
  function closePrompt(): void {
    emit('update:open', false);
    emit('close');
  }

  /**
   * Отдаёт выбранный навык и закрывает плашку.
   *
   * @param optionId - ключ выбранного навыка
   */
  function handleAnswer(optionId: string): void {
    props.onAnswer(optionId, validAskedDc.value);
    closePrompt();
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
            :name="EFFECT_ESCAPE_ICON"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ title }}
          </span>

          <span
            v-if="actorName"
            class="ml-auto min-w-0 truncate text-xs text-dimmed"
          >
            {{ actorName }}
          </span>
        </div>

        <p
          v-if="difficulty"
          class="text-sm break-words text-toned"
        >
          {{ difficulty }}
        </p>

        <label
          v-if="asksDc"
          class="flex items-center justify-between gap-2 text-sm text-toned"
        >
          <span class="min-w-0 break-words">
            {{ EFFECT_ESCAPE_PROMPT_LABELS.difficultyInput }}
          </span>

          <UInputNumber
            v-model="askedDc"
            :min="MIN_ESCAPE_SKILL_DC"
            size="sm"
            class="w-28 shrink-0"
          />
        </label>

        <div class="flex items-center gap-2">
          <UButton
            v-for="option in optionRows"
            :key="option.id"
            :label="option.label"
            :title="option.title"
            :disabled="option.disabled"
            color="primary"
            variant="soft"
            size="sm"
            class="min-w-0 flex-1 justify-center"
            @click.left.exact.prevent="handleAnswer(option.id)"
          />

          <UButton
            icon="tabler:x"
            color="neutral"
            variant="ghost"
            size="sm"
            class="shrink-0"
            :title="EFFECT_ESCAPE_PROMPT_LABELS.cancel"
            @click.left.exact.prevent="closePrompt"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
