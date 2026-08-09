<script setup lang="ts">
  import { FILTER_ROW_CONTROL_SIZE, SHEET_FILTER_LABELS } from './constants';

  const emit = defineEmits<{
    /** Нажатие: хозяин ряда снимает свой отбор */
    reset: [];
  }>();
</script>

<template>
  <!-- Сброс замыкает ряд отбора. Значка хватает — название несёт подсказка, а
    от подписи ряд разъезжался бы каждый раз, как что-то отмечено. Показывать
    кнопку или нет, решает хозяин ряда: без отбора ей делать нечего -->
  <UTooltip :text="SHEET_FILTER_LABELS.resetHint">
    <UButton
      icon="tabler:filter-off"
      color="neutral"
      variant="ghost"
      :size="FILTER_ROW_CONTROL_SIZE"
      square
      :aria-label="SHEET_FILTER_LABELS.reset"
      @click.left.exact.prevent="emit('reset')"
    />
  </UTooltip>
</template>
