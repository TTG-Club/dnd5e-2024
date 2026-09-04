<script setup lang="ts">
  /**
   * Строка выбора в мастерах персонажа: что выбирают, сколько уже набрано,
   * плашки взятого и кнопка «Выбрать», открывающая {@link ChoicePickerModal}.
   *
   * Одна строка на все выборы листа — заклинания, навыки, инструменты, оружие,
   * варианты умений, черту, происхождение. Смысл в том, чтобы жест был один:
   * длина пула на вид строки больше не влияет, и игрок, проходя подряд десяток
   * вопросов уровня, каждый раз делает одно и то же.
   *
   * Рамку строка себе не рисует: её ставит вызывающий. Одни выборы стоят
   * карточкой в общем списке, другие — внутри уже открытой карточки умения, и
   * своя рамка в них дала бы карточку внутри карточки.
   */

  import type { ChoicePickerOption } from './ChoicePickerModal.vue';

  import { computed, ref } from 'vue';

  import { useModalManager } from '@/shared_ui/composables/useModalManager';

  import ChoicePickerModal from './ChoicePickerModal.vue';
  import { CHOICE_PICKER_LABELS } from './constants';

  const props = withDefaults(
    defineProps<{
      /** Что выбирают: заголовок строки и окна */
      label: string;
      /** Подзаголовок окна: источник выбора — умение, черта, предыстория */
      subtitle?: string;
      /** Варианты в порядке показа */
      options: ReadonlyArray<ChoicePickerOption>;
      /** Отмеченные значения */
      selected: ReadonlyArray<string>;
      /** Сколько вариантов берут */
      max: number;
      /**
       * Что написать вместо кнопки, когда вариантов нет вовсе. Причина у пустого
       * пула бывает разная («уже владеет всем» против «справочник не загружен»),
       * и называет её вызывающий.
       */
      emptyText?: string;
    }>(),
    { subtitle: undefined, emptyText: '' },
  );

  const emit = defineEmits<{
    'update:selected': [values: string[]];
  }>();

  const { getNextZIndex } = useModalManager();

  const isPickerOpen = ref(false);

  /** Z-index окна выбора: оно встаёт поверх окна мастера */
  const pickerZIndex = ref<number | undefined>(undefined);

  /** Счётчик набранного: «Выбрано 1 из 2» */
  const counter = computed(
    () =>
      `${CHOICE_PICKER_LABELS.chosenPrefix}${props.selected.length}`
      + `${CHOICE_PICKER_LABELS.chosenMiddle}${props.max}`,
  );

  /** Оформление счётчика: пока не набрано — предупреждением */
  const counterClass = computed(() =>
    props.selected.length >= props.max ? 'text-dimmed' : 'text-warning',
  );

  /**
   * Плашки взятого. Порядок — как у отметок, а не как в пуле: игрок видит их в
   * том порядке, в каком отмечал. Незнакомое пулу значение показывается своим
   * ключом — так виден ответ, оставшийся от прежней записи.
   */
  const chosenLabels = computed(() =>
    props.selected.map(
      (value) =>
        props.options.find((option) => option.value === value)?.name ?? value,
    ),
  );

  /** Открывает окно выбора поверх мастера */
  function openPicker(): void {
    pickerZIndex.value = getNextZIndex();
    isPickerOpen.value = true;
  }

  /**
   * Забирает отметки из окна.
   *
   * @param values - отмеченные значения
   */
  function applySelection(values: string[]): void {
    emit('update:selected', values);
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <span class="font-medium text-highlighted">
        {{ label }}
      </span>

      <span
        class="text-xs"
        :class="counterClass"
      >
        {{ counter }}
      </span>

      <!-- Пометки выбора: компетентность, пересмотр на отдыхе -->
      <slot name="badges" />
    </div>

    <slot name="hint" />

    <p
      v-if="options.length === 0"
      class="text-xs text-dimmed italic"
    >
      {{ emptyText }}
    </p>

    <div
      v-else
      class="flex flex-wrap items-center gap-2"
    >
      <UBadge
        v-for="(name, index) in chosenLabels"
        :key="`${name}-${index}`"
        color="primary"
        variant="subtle"
        size="md"
      >
        {{ name }}
      </UBadge>

      <span
        v-if="chosenLabels.length === 0"
        class="text-xs text-dimmed italic"
      >
        {{ CHOICE_PICKER_LABELS.nothingChosen }}
      </span>

      <UButton
        :label="CHOICE_PICKER_LABELS.open"
        icon="tabler:list-check"
        color="neutral"
        variant="soft"
        size="xs"
        class="ml-auto"
        @click.left.exact.prevent="openPicker"
      />
    </div>

    <!-- Окно монтируется только открытым: строк выбора на уровне бывает
      десяток, и держать под каждой свою модалку незачем -->
    <ChoicePickerModal
      v-if="isPickerOpen"
      v-model:open="isPickerOpen"
      :title="label"
      :subtitle="subtitle"
      :options="options"
      :selected="selected"
      :max="max"
      :z-index="pickerZIndex"
      @apply="applySelection"
    />
  </div>
</template>
