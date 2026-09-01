<script setup lang="ts">
  import type {
    StartingEquipmentItem,
    StartingEquipmentOption,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import {
    currencyShortLabel,
    startingEquipmentQuantity,
  } from '@vtt/shared/system/dnd.js';

  /**
   * Содержимое карточки варианта стартового снаряжения — общее для мастера
   * класса, мастера предыстории и карточки класса.
   *
   * Показываются ПОЗИЦИИ, а не строка варианта: позиции задаёт форма, и ровно
   * они лягут в инвентарь — строка же досталась варианту из выгрузки сайта и
   * после первой же правки списка разошлась бы с ним. Строка остаётся запасным
   * видом для записей без позиций (старые паки, свои классы): показывать по ним
   * больше нечего.
   */
  const props = defineProps<{
    option: StartingEquipmentOption;
  }>();

  const items = computed(() => props.option.items ?? []);

  /** Краткая подпись монеты: стартовые деньги везде золотые */
  const coinLabel = currencyShortLabel();

  /**
   * Строка позиции: название, количество сверх одного и уточнение.
   *
   * @param item - позиция варианта
   */
  function itemLine(item: StartingEquipmentItem): string {
    const quantity = startingEquipmentQuantity(item);
    const count = quantity > 1 ? ` ×${quantity}` : '';
    const note = item.note ? ` (${item.note})` : '';

    return `${item.name}${count}${note}`;
  }
</script>

<template>
  <div class="flex flex-col gap-2 text-sm text-toned">
    <ul
      v-if="items.length > 0"
      class="flex flex-col gap-1"
    >
      <li
        v-for="(item, index) in items"
        :key="index"
        class="flex gap-1.5"
      >
        <span class="shrink-0 text-dimmed">•</span>

        <span>{{ itemLine(item) }}</span>
      </li>
    </ul>

    <ItemDescriptionRenderer
      v-else
      :content="option.description"
    />

    <div
      v-if="option.coins"
      class="flex items-center gap-2 text-warning"
    >
      <UIcon
        name="tabler:coin"
        class="h-4 w-4 shrink-0"
      />

      <span>{{ option.coins }} {{ coinLabel }}</span>
    </div>
  </div>
</template>
