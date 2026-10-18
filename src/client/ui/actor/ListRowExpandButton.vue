<script setup lang="ts">
  /**
   * Стрелка раскрытия в начале строки списка — у вида с подвидами. Одна на окно
   * выбора и компендиум: строки обоих окон должны совпадать, отличаясь только
   * флажками. Нажимается во всю высоту строки и подсвечивается отдельно от неё —
   * видно, что нажатие раскрывает, а не открывает карточку.
   */

  import { computed } from 'vue';

  import {
    LIST_ROW_LEADING_ACTIVE_CLASS,
    LIST_ROW_LEADING_CLASS,
  } from './constants';

  /** Подписи стрелки: что сделает нажатие у свёрнутой и у раскрытой строки */
  export interface ListRowExpandLabels {
    expand: string;
    collapse: string;
  }

  const props = defineProps<{
    /** Раскрыта ли строка — стрелка смотрит вниз */
    expanded: boolean;
    /** Подписи стрелки */
    labels: ListRowExpandLabels;
  }>();

  const emit = defineEmits<{ toggle: [] }>();

  /** Подпись: что сделает нажатие */
  const label = computed(() =>
    props.expanded ? props.labels.collapse : props.labels.expand,
  );

  /** Значок стрелки: вниз у раскрытой строки */
  const icon = computed(() =>
    props.expanded ? 'tabler:chevron-down' : 'tabler:chevron-right',
  );
</script>

<template>
  <button
    type="button"
    :class="[LIST_ROW_LEADING_CLASS, LIST_ROW_LEADING_ACTIVE_CLASS]"
    :aria-label="label"
    :title="label"
    @click.left.exact.prevent="emit('toggle')"
  >
    <UIcon
      :name="icon"
      class="size-4"
    />
  </button>
</template>
