<!--
  Плашка выбора варианта эффекта перед броском: из каждой группы альтернатив
  («Глухота или слепота») бросающий выбирает одну. Закрытие без выбора — отмена
  действия.
-->
<script setup lang="ts">
  import type {
    EffectVariantChoices,
    EffectVariantGroup,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import { HudPromptChoices, HudPromptPanel } from '@/shared_ui/components';
  import {
    joinVariantChoice,
    splitVariantChoice,
  } from '@vtt/shared/system/dnd.js';

  import { EFFECT_VARIANT_PROMPT_LABELS } from './constants';

  const props = defineProps<{
    open: boolean;
    modalId: string;
    /** Что бросают: заклинание, действие, оружие */
    sourceName: string;
    /** Группы, в которых выбирает бросающий */
    groups: readonly EffectVariantGroup[];
    /** Выбор сделан */
    onConfirm: (choices: EffectVariantChoices) => void;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  /** Выбор по группам: по умолчанию первый вариант каждой */
  const choices = ref<Record<string, string>>(
    Object.fromEntries(
      props.groups.map((group) => [group.group, group.labels[0] ?? '']),
    ),
  );

  /**
   * Меняет выбор в группе с несколькими вариантами. Пустой выбор не пишется:
   * хотя бы один вариант взять надо.
   *
   * @param group - ключ группы
   * @param labels - выбранные варианты
   */
  function selectVariants(group: string, labels: string[]): void {
    const known = props.groups.find((entry) => entry.group === group)?.labels;
    const picked = (known ?? []).filter((label) => labels.includes(label));

    if (picked.length > 0) {
      choices.value = { ...choices.value, [group]: joinVariantChoice(picked) };
    }
  }

  const title = computed(
    () =>
      `${EFFECT_VARIANT_PROMPT_LABELS.titlePrefix}${props.sourceName}${EFFECT_VARIANT_PROMPT_LABELS.titleSuffix}`,
  );

  /** Подпись группы нужна, только когда групп несколько */
  const showGroupLabels = computed(() => props.groups.length > 1);

  /** Строки групп с текущим выбором в форме общего компонента плашки */
  const groupRows = computed(() =>
    props.groups.map((group) => ({
      group: group.group,
      label: showGroupLabels.value ? group.group : undefined,
      items: group.labels.map((label) => ({ label, value: label })),
      multi: group.pick === 'multi',
      modelValue:
        group.pick === 'multi'
          ? splitVariantChoice(choices.value[group.group])
          : choices.value[group.group],
    })),
  );

  /**
   * Меняет выбор в группе.
   *
   * @param group - ключ группы
   * @param label - выбранный вариант
   */
  function selectVariant(group: string, label: string): void {
    const labels = props.groups.find((entry) => entry.group === group)?.labels;
    const variant = labels?.find((option) => option === label);

    if (variant !== undefined) {
      choices.value = { ...choices.value, [group]: variant };
    }
  }

  /**
   * Принимает выбор общего компонента: один вариант или список для `multi`.
   *
   * @param group - ключ группы
   * @param value - выбранный вариант или список вариантов
   */
  function handleChoiceUpdate(group: string, value: string | string[]): void {
    if (Array.isArray(value)) {
      selectVariants(group, value);

      return;
    }

    selectVariant(group, value);
  }

  /** Отдаёт выбор и закрывает плашку */
  function handleConfirm(): void {
    props.onConfirm(choices.value);
    emit('update:open', false);
    emit('close');
  }

  /** Закрывает плашку без выбора: действие не выполняется */
  function handleCancel(): void {
    emit('update:open', false);
    emit('close');
  }
</script>

<template>
  <HudPromptPanel
    :open="open"
    icon="tabler:arrows-split"
    :title="title"
  >
    <HudPromptChoices
      v-for="row in groupRows"
      :key="row.group"
      :model-value="row.modelValue"
      :items="row.items"
      :multi="row.multi"
      :legend="row.label"
      @update:model-value="handleChoiceUpdate(row.group, $event)"
    />

    <template #footer>
      <UButton
        :label="EFFECT_VARIANT_PROMPT_LABELS.confirm"
        color="primary"
        variant="solid"
        size="md"
        @click.left.exact.prevent="handleConfirm"
      />

      <UButton
        :label="EFFECT_VARIANT_PROMPT_LABELS.cancel"
        color="neutral"
        variant="soft"
        size="md"
        @click.left.exact.prevent="handleCancel"
      />
    </template>
  </HudPromptPanel>
</template>
