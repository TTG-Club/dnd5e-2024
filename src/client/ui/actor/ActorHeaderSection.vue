<script setup lang="ts">
  /**
   * Раздел шапки листа, заполняемый записью компендиума (вид, класс,
   * предыстория) — и заполненный, и пустой.
   *
   * Клик открывает окно выбора: слева компендиумы, справа записи. Заполненный
   * раздел кликается так же — оттуда его можно заменить или снять. Без права
   * правки раздел остаётся обычным текстом.
   */

  import { computed } from 'vue';

  import {
    SHEET_INLINE_EDITABLE_CLASS,
    SHEET_SECTION_EMPTY_CLASS,
  } from './constants';

  const props = defineProps<{
    /** Текст раздела: название записи либо «Вид не выбран» */
    label: string;
    /** Подпись кнопки: что откроется по клику */
    title: string;
    /** Заполнен ли раздел — пустой показывается приглушённым курсивом */
    isFilled?: boolean;
    /** Можно ли менять раздел (право правки листа) */
    canEdit?: boolean;
  }>();

  const emit = defineEmits<{
    /** Запрос на открытие окна выбора записи */
    open: [];
  }>();

  /** Тон текста: незаполненный раздел приглушён и набран курсивом */
  const toneClass = computed(() =>
    props.isFilled ? '' : SHEET_SECTION_EMPTY_CLASS,
  );

  /**
   * Оформление кликабельного раздела. Пунктир и подсветка — те же, что у
   * остальных строк листа, которые правит окно; отступ подчёркивания
   * дописывается на месте (так задумано в самой константе).
   */
  const buttonClass = computed(() =>
    [SHEET_INLINE_EDITABLE_CLASS, 'underline-offset-4', toneClass.value]
      .filter(Boolean)
      .join(' '),
  );

  /** Открывает окно выбора записи для этого раздела */
  function handleClick(): void {
    emit('open');
  }
</script>

<template>
  <button
    v-if="canEdit"
    type="button"
    :class="buttonClass"
    :title="title"
    @click.left.exact.prevent="handleClick"
  >
    {{ label }}
  </button>

  <span
    v-else
    :class="toneClass"
  >
    {{ label }}
  </span>
</template>
