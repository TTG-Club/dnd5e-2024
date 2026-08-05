<script setup lang="ts">
  /**
   * Плейсхолдер незаполненного раздела шапки листа (вид, класс, предыстория).
   *
   * Вид, класс и предыстория попадают на лист только переносом записи из
   * компендиума, и по надписи «Вид не выбран» этого не видно. Поэтому надпись
   * кликабельна: клик открывает подсказку, что и откуда перетащить. Наведение
   * открывает её же — клик нужен там, где наведения нет (тач-устройства).
   */

  import type { MissingSheetSection } from './constants';

  import { ref } from 'vue';

  defineProps<{
    /** Описание раздела: текст-плейсхолдер и подсказка */
    section: MissingSheetSection;
  }>();

  /** Открыта ли подсказка (клик открывает, уход курсора или Escape закрывают) */
  const isHintOpen = ref(false);

  /** Показывает подсказку по клику по плейсхолдеру */
  function showHint() {
    isHintOpen.value = true;
  }
</script>

<template>
  <UTooltip
    v-model:open="isHintOpen"
    :text="section.hint"
    :delay-duration="150"
    :content="{ side: 'bottom' }"
    disable-closing-trigger
  >
    <button
      type="button"
      class="cursor-help text-dimmed italic underline decoration-dotted underline-offset-4 transition-colors hover:text-toned"
      @click.left.exact.prevent="showHint"
    >
      {{ section.label }}
    </button>
  </UTooltip>
</template>
