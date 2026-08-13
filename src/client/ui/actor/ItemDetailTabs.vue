<script setup lang="ts">
  import { computed, useSlots } from 'vue';

  import { FORM_TAB_LABELS } from './constants';

  /**
   * Переиспользуемый таб-контейнер для модалок ПРОСМОТРА предметов.
   * Вкладки «Основное» и «Эффекты» — всегда; «Бой» — опциональна и
   * показывается только если передан слот `combat`. Каждая модалка наполняет
   * одноимённые слоты своим содержимым.
   */
  const slots = useSlots();

  const tabItems = computed(() => {
    const items: { label: string; slot: string }[] = [
      { label: FORM_TAB_LABELS.main, slot: 'general' },
    ];

    if (slots.combat) {
      items.push({ label: FORM_TAB_LABELS.combat, slot: 'combat' });
    }

    items.push({ label: FORM_TAB_LABELS.effects, slot: 'effects' });

    return items;
  });
</script>

<template>
  <UTabs
    :items="tabItems"
    variant="pill"
    class="flex flex-col"
    :ui="{
      list: 'mb-3',
      trigger: 'flex-1 justify-center',
      content: 'overflow-y-auto max-h-150',
    }"
  >
    <template #general>
      <slot name="general" />
    </template>

    <template
      v-if="slots.combat"
      #combat
    >
      <slot name="combat" />
    </template>

    <template #effects>
      <slot name="effects" />
    </template>
  </UTabs>
</template>
