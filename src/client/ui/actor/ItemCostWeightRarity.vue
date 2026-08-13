<script setup lang="ts">
  import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { formatItemCost } from '@vtt/shared';
  import { RARITY_COLORS, RARITY_LABELS } from '@vtt/shared/system/dnd.js';

  import { ITEM_FORM_LABELS, WEIGHT_UNIT_LABEL } from './constants';

  const props = defineProps<{
    /** Стоимость предмета */
    cost: DnDGameItem['cost'];
    /** Вес предмета (фунты) */
    weight: DnDGameItem['weight'];
    /** Редкость предмета */
    rarity: DnDGameItem['rarity'];
  }>();

  /** Показывать ли блок — есть хотя бы одно значимое поле */
  const isVisible = computed(
    () =>
      Boolean(props.cost)
      || Boolean(props.weight)
      || (props.rarity && props.rarity !== 'none'),
  );

  /** CSS-класс цвета для текущей редкости */
  const rarityColorClass = computed(
    () => RARITY_COLORS[props.rarity] ?? 'text-highlighted',
  );

  /** Локализованное название редкости */
  const rarityLabel = computed(
    () => RARITY_LABELS[props.rarity] ?? props.rarity,
  );
</script>

<template>
  <div
    v-if="isVisible"
    class="flex gap-6 border-t border-default/50 pt-3 text-sm"
  >
    <div v-if="cost">
      <span class="text-xs text-dimmed">{{ ITEM_FORM_LABELS.cost }}</span>

      <p class="text-primary">{{ formatItemCost(cost) }}</p>
    </div>

    <div v-if="weight">
      <span class="text-xs text-dimmed">{{
        ITEM_FORM_LABELS.weightShort
      }}</span>

      <p class="text-highlighted">{{ weight }} {{ WEIGHT_UNIT_LABEL }}</p>
    </div>

    <div v-if="rarity && rarity !== 'none'">
      <span class="text-xs text-dimmed">{{ ITEM_FORM_LABELS.rarity }}</span>

      <p :class="rarityColorClass">{{ rarityLabel }}</p>
    </div>
  </div>
</template>
