<!--
  Плашка оплаты цены ресурсом: там, где платить можно по-разному (круг ячейки,
  число костей хитов), платящий выбирает вариант. Закрытие без выбора — отмена
  применения, включения или каста: ничего не списывается.
-->
<script setup lang="ts">
  import type { PricePlan } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import {
    HUD_PROMPT_PANEL_CLASS,
    HUD_PROMPTS_TELEPORT_TARGET,
  } from '../actor/constants';
  import { EFFECT_VARIANT_SWITCH_MAX } from './constants';
  import {
    EFFECT_PAY_PROMPT_ICON,
    EFFECT_PAY_PROMPT_LABELS,
  } from './payLabels';

  defineOptions({
    inheritAttrs: false,
  });

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
   * Строки платежей: варианты и чем выбирать. Немного вариантов —
   * переключателем, длинный список — выпадающим.
   */
  const rows = computed(() =>
    props.prices.map((entry, index) => ({
      index,
      items: entry.options.map((option) => ({
        label: option.label,
        value: option.id,
      })),
      asSwitch: entry.options.length <= EFFECT_VARIANT_SWITCH_MAX,
    })),
  );

  /**
   * Меняет выбор платежа.
   *
   * @param index - номер платежа
   * @param optionId - ключ выбранного варианта
   */
  function selectOption(index: number, optionId: string | number): void {
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
  <Teleport :to="HUD_PROMPTS_TELEPORT_TARGET">
    <Transition name="slide-up">
      <div
        v-if="open"
        :class="HUD_PROMPT_PANEL_CLASS"
      >
        <div class="flex items-center gap-2 border-b border-muted/50 pb-2">
          <UIcon
            :name="EFFECT_PAY_PROMPT_ICON"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ title }}
          </span>
        </div>

        <template
          v-for="row in rows"
          :key="row.index"
        >
          <UTabs
            v-if="row.asSwitch"
            :model-value="picks[row.index]"
            :items="row.items"
            :content="false"
            size="md"
            color="primary"
            class="w-full"
            @update:model-value="selectOption(row.index, $event)"
          />

          <USelect
            v-else
            :model-value="picks[row.index]"
            :items="row.items"
            value-key="value"
            size="md"
            class="w-full"
            :portal="false"
            @update:model-value="selectOption(row.index, $event)"
          />
        </template>

        <div class="flex items-center justify-center gap-2">
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
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
