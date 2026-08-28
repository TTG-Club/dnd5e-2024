<script setup lang="ts">
  /**
   * Строка списка в окнах выбора: отметка, название и пометка справа.
   *
   * Одна на все окна выбора — и то, что берёт записи компендиума, и то, что
   * берёт значения справочников. Строки в них означают одно и то же, и разный
   * вид сбивал бы: автор ходит по этим окнам подряд.
   *
   * Второй строкой идёт английское название, если оно есть; пометкой справа —
   * то, чем строка отличается от соседних: источник у записи компендиума, приём
   * или категория у значения справочника.
   */

  defineProps<{
    /** Название — первая строка */
    name: string;
    /** Английское название — вторая строка; пусто, и строки не будет */
    nameEn?: string;
    /** Пометка справа: источник, категория, приём */
    badge?: string;
    /** Отмечена ли строка */
    selected: boolean;
  }>();

  const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-primary/10"
    @click.left.exact.prevent="emit('toggle')"
  >
    <!-- Отметку ставит вся строка: попадать в саму галочку неудобно, а два
      обработчика на строку дали бы двойное переключение -->
    <UCheckbox
      :model-value="selected"
      class="pointer-events-none shrink-0"
    />

    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium text-highlighted">
        {{ name }}
      </span>

      <span
        v-if="nameEn"
        class="block truncate text-xs text-dimmed"
      >
        {{ nameEn }}
      </span>
    </span>

    <UBadge
      v-if="badge"
      color="neutral"
      variant="subtle"
      size="sm"
      class="shrink-0"
    >
      {{ badge }}
    </UBadge>
  </button>
</template>
