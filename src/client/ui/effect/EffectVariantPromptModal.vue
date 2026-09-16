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

  import { HUD_PROMPTS_TELEPORT_TARGET } from '../actor/constants';
  import { EFFECT_VARIANT_PROMPT_LABELS } from './constants';

  defineOptions({
    inheritAttrs: false,
  });

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

  const title = computed(
    () =>
      `${EFFECT_VARIANT_PROMPT_LABELS.titlePrefix}${props.sourceName}${EFFECT_VARIANT_PROMPT_LABELS.titleSuffix}`,
  );

  /** Подпись группы нужна, только когда групп несколько */
  const showGroupLabels = computed(() => props.groups.length > 1);

  /** Варианты выбора по ключу группы */
  const itemsByGroup = computed(
    () =>
      new Map(
        props.groups.map((group) => [
          group.group,
          group.labels.map((label) => ({ label, value: label })),
        ]),
      ),
  );

  /**
   * Меняет выбор в группе.
   *
   * @param group - ключ группы
   * @param label - выбранный вариант
   */
  function selectVariant(group: string, label: string): void {
    choices.value = { ...choices.value, [group]: label };
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
  <Teleport :to="HUD_PROMPTS_TELEPORT_TARGET">
    <Transition name="slide-up">
      <div
        v-if="open"
        class="pointer-events-auto flex w-95 max-w-full flex-col gap-3 rounded-xl border border-default/50 bg-default/90 px-4 py-3 text-highlighted shadow-xl ring-accented backdrop-blur-sm"
      >
        <div class="flex items-center gap-2 border-b border-muted/50 pb-2">
          <UIcon
            name="tabler:arrows-split"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ title }}
          </span>
        </div>

        <UFormField
          v-for="group in groups"
          :key="group.group"
          :label="showGroupLabels ? group.group : undefined"
        >
          <USelect
            :model-value="choices[group.group]"
            :items="itemsByGroup.get(group.group)"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
            @update:model-value="selectVariant(group.group, $event)"
          />
        </UFormField>

        <div class="flex items-center justify-end gap-2">
          <UButton
            icon="tabler:check"
            color="primary"
            variant="solid"
            size="sm"
            :title="EFFECT_VARIANT_PROMPT_LABELS.confirm"
            @click.left.exact.prevent="handleConfirm"
          />

          <UButton
            icon="tabler:x"
            color="neutral"
            variant="ghost"
            size="sm"
            :title="EFFECT_VARIANT_PROMPT_LABELS.cancel"
            @click.left.exact.prevent="handleCancel"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
