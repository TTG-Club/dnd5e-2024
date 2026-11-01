<!--
  Плашка оплаты цены ресурсом: там, где платить можно по-разному (круг ячейки,
  число костей хитов), платящий выбирает вариант. Закрытие без выбора — отмена
  применения, включения или каста: ничего не списывается.
-->
<script setup lang="ts">
  import type { PricePlan } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import { HudPromptChoices, HudPromptPanel } from '@/shared_ui/components';

  import {
    EFFECT_PAY_PROMPT_ICON,
    EFFECT_PAY_PROMPT_LABELS,
  } from './payLabels';

  const props = defineProps<{
    open: boolean;
    modalId: string;
    /** За что платят: заклинание, умение, предмет */
    sourceName: string;
    /** Платежи, у которых есть выбор */
    prices: readonly PricePlan[];
    /** Выбор сделан: ключи вариантов — по одному на платёж */
    onConfirm: (optionIds: string[]) => void;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  /** Выбор по платежам: по умолчанию первый вариант каждого */
  const picks = ref<string[]>(
    props.prices.map((entry) => entry.options[0]?.id ?? ''),
  );

  const title = computed(
    () =>
      `${EFFECT_PAY_PROMPT_LABELS.titlePrefix}${props.sourceName}${EFFECT_PAY_PROMPT_LABELS.titleSuffix}`,
  );

  /**
   * Строки платежей с текущим выбором. Раскладку — рядом или столбиком —
   * выбирает общий компонент плашки по подписям вариантов.
   */
  const rows = computed(() =>
    props.prices.map((entry, index) => ({
      index,
      items: entry.options.map((option) => ({
        label: option.label,
        value: option.id,
      })),
      modelValue: picks.value[index] ?? '',
    })),
  );

  /**
   * Меняет выбор платежа. У платежа вариант всегда один, поэтому список
   * от общего компонента сюда прийти не может и пропускается.
   *
   * @param index - номер платежа
   * @param optionId - ключ выбранного варианта
   */
  function selectOption(index: number, optionId: string | string[]): void {
    if (Array.isArray(optionId)) {
      return;
    }

    const option = props.prices[index]?.options.find(
      (entry) => entry.id === optionId,
    );

    if (option) {
      picks.value = picks.value.map((pick, at) =>
        at === index ? option.id : pick,
      );
    }
  }

  /** Отдаёт выбор и закрывает плашку */
  function handleConfirm(): void {
    props.onConfirm(picks.value);
    emit('update:open', false);
    emit('close');
  }

  /** Закрывает плашку без выбора: ничего не списывается */
  function handleCancel(): void {
    emit('update:open', false);
    emit('close');
  }
</script>

<template>
  <HudPromptPanel
    :open="open"
    :icon="EFFECT_PAY_PROMPT_ICON"
    :title="title"
  >
    <HudPromptChoices
      v-for="row in rows"
      :key="row.index"
      :model-value="row.modelValue"
      :items="row.items"
      @update:model-value="selectOption(row.index, $event)"
    />

    <template #footer>
      <UButton
        :label="EFFECT_PAY_PROMPT_LABELS.confirm"
        color="primary"
        variant="solid"
        size="md"
        @click.left.exact.prevent="handleConfirm"
      />

      <UButton
        :label="EFFECT_PAY_PROMPT_LABELS.cancel"
        color="neutral"
        variant="soft"
        size="md"
        @click.left.exact.prevent="handleCancel"
      />
    </template>
  </HudPromptPanel>
</template>
