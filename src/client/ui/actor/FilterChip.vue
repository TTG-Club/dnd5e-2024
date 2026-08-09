<script setup lang="ts">
  import type { FilterChipShape } from './constants';

  import { computed } from 'vue';

  import { getFilterChipClass } from './utils/filterChipClass';

  const props = defineProps<{
    /** Подсказка по наведению — она же полное название отбора */
    tooltip: string;
    /** Чип отмечен: горит тёплым */
    picked: boolean;
    /** Подпись чипа; без неё чип сжимается в квадрат с одним значком */
    label?: string;
    /** Значок перед подписью либо вместо неё */
    icon?: string;
  }>();

  const emit = defineEmits<{
    /** Нажатие: отбор ставится либо снимается — решает хозяин ряда */
    toggle: [];
  }>();

  /** Форма чипа: без подписи он остаётся квадратом под значок */
  const shape = computed<FilterChipShape>(() =>
    props.label ? 'text' : 'icon',
  );

  const chipClass = computed(() =>
    getFilterChipClass(props.picked, shape.value),
  );
</script>

<template>
  <!-- Подсказка идёт и в `aria-label`: подпись чипа короткая (цифра круга,
    буква пометки), а скринридеру нужно полное название отбора -->
  <UTooltip :text="tooltip">
    <button
      type="button"
      :class="chipClass"
      :aria-pressed="picked"
      :aria-label="tooltip"
      @click.left.exact.prevent="emit('toggle')"
    >
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-3.5"
      />

      <template v-if="label">
        {{ label }}
      </template>
    </button>
  </UTooltip>
</template>
