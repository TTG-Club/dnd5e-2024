<script setup lang="ts">
  import { computed, useSlots } from 'vue';

  /**
   * Строка числовой настройки дара: подпись слева, счётчик посередине, справа —
   * место под спутника (галочку или пояснение).
   *
   * Колонки фиксированной ширины, а не равные ячейки сетки: длинные подписи
   * («За каждый следующий уровень») в равных ячейках переносятся на вторую
   * строку, и соседние ряды перестают читаться единым столбцом. Заданное
   * значение подсвечивается кольцом поля — так видно настроенное, не вчитываясь
   * в ряды нулей.
   */
  const value = defineModel<number>({ required: true });

  const props = withDefaults(
    defineProps<{
      /** Подпись строки */
      label: string;
      min?: number;
      max?: number;
      step?: number;
      disabled?: boolean;
      /**
       * Держать место под спутника, даже когда его нет. Нужно рядам, где
       * галочка есть лишь у части строк: без места колонки разъезжаются.
       */
      reserveTrailing?: boolean;
    }>(),
    {
      min: 0,
      max: 100,
      step: 1,
      disabled: false,
      reserveTrailing: false,
    },
  );

  const slots = useSlots();

  /** Нужна ли строке правая колонка (спутник или место под него). */
  const hasTrailing = computed(
    () => Boolean(slots.trailing) || props.reserveTrailing,
  );

  /** Значение задано — поле подсвечено. Выключенное поле не считается. */
  const isSet = computed(() => !props.disabled && value.value !== 0);
</script>

<template>
  <div class="flex min-h-9 items-center gap-2">
    <!-- Ряд собран из вертикального поля с перекрытой раскладкой, а не из
      `orientation="horizontal"`: та раскладка ставит подпись и счётчик по
      базовой линии и разводит их по краям, а здесь нужна колонка постоянной
      ширины, чтобы счётчики соседних строк стояли ровно друг под другом. -->
    <UFormField
      :label="label"
      size="sm"
      :ui="{
        root: 'flex min-w-0 flex-1 items-center gap-2',
        wrapper: 'min-w-0 flex-1',
        label: 'truncate',
        container: 'mt-0 w-32 shrink-0',
      }"
    >
      <UInputNumber
        v-model="value"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        :highlight="isSet"
        size="sm"
        class="w-full"
      />
    </UFormField>

    <div
      v-if="hasTrailing"
      class="w-40 shrink-0"
    >
      <slot name="trailing" />
    </div>
  </div>
</template>
