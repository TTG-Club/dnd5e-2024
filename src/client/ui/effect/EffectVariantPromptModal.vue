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
  import {
    EFFECT_VARIANT_PROMPT_LABELS,
    EFFECT_VARIANT_SWITCH_MAX,
  } from './constants';

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

  /**
   * Строки групп: подпись, варианты и чем выбирать. Немного коротких
   * вариантов — переключателем, всё видно сразу; длинный список — выпадающим.
   */
  const groupRows = computed(() =>
    props.groups.map((group) => ({
      group: group.group,
      label: showGroupLabels.value ? group.group : undefined,
      items: group.labels.map((label) => ({ label, value: label })),
      asSwitch: group.labels.length <= EFFECT_VARIANT_SWITCH_MAX,
    })),
  );

  /**
   * Меняет выбор в группе.
   *
   * @param group - ключ группы
   * @param label - выбранный вариант
   */
  function selectVariant(group: string, label: string | number): void {
    const labels = props.groups.find((entry) => entry.group === group)?.labels;
    const variant = labels?.find((option) => option === label);

    if (variant !== undefined) {
      choices.value = { ...choices.value, [group]: variant };
    }
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
          v-for="row in groupRows"
          :key="row.group"
          :label="row.label"
          size="md"
        >
          <UTabs
            v-if="row.asSwitch"
            :model-value="choices[row.group]"
            :items="row.items"
            :content="false"
            size="md"
            color="primary"
            class="w-full"
            @update:model-value="selectVariant(row.group, $event)"
          />

          <USelect
            v-else
            :model-value="choices[row.group]"
            :items="row.items"
            value-key="value"
            size="md"
            class="w-full"
            :portal="false"
            @update:model-value="selectVariant(row.group, $event)"
          />
        </UFormField>

        <div class="flex items-center justify-center gap-2">
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
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
