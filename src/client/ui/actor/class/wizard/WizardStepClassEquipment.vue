<script setup lang="ts">
  /**
   * Шаг мастера: стартовое снаряжение класса.
   *
   * Показывается один раз — при взятии класса на 1 уровне. Вариант с позициями
   * выбирается и уезжает в инвентарь; вариант без позиций (старые паки, свои
   * классы) только показывается строкой. Там, где выбор вообще есть, к нему
   * всегда добавляется отказ: снаряжение бывает уже собрано вручную, и тогда
   * выдавать нечего.
   */
  import type { ClassStartingEquipmentOption } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { hasGrantableEquipment } from '@vtt/shared/system/dnd.js';

  import {
    CLASS_EQUIPMENT_NONE_INDEX,
    CLASS_EQUIPMENT_STEP_LABELS,
  } from '../../constants';
  import StartingEquipmentOptionBody from '../../StartingEquipmentOptionBody.vue';

  const props = defineProps<{
    options: ClassStartingEquipmentOption[];
  }>();

  const selectedIndex = defineModel<number | null>('selectedIndex', {
    default: null,
  });

  /** Есть ли хоть у одного варианта что выдать — иначе выбор не показываем. */
  const isSelectable = computed(() =>
    props.options.some(hasGrantableEquipment),
  );

  /** Тег карточки варианта: выбираемый вариант — кнопка, иначе обычный блок */
  const optionTag = computed(() => (isSelectable.value ? 'button' : 'div'));

  /** Кнопке нужен явный тип, блоку — нет */
  const optionType = computed(() =>
    isSelectable.value ? 'button' : undefined,
  );

  /** Оформление карточки: выбранный вариант подсвечен */
  function optionClass(index: number): string {
    return selectedIndex.value === index
      ? 'border-primary bg-primary/10'
      : 'border-default/50 bg-elevated/30';
  }

  /**
   * Выбирает вариант; повторное нажатие снимает выбор. У вариантов без позиций
   * выбирать нечего — нажатие там ничего не делает.
   *
   * @param index - порядковый номер варианта
   */
  function selectOption(index: number): void {
    if (!isSelectable.value) {
      return;
    }

    selectedIndex.value = selectedIndex.value === index ? null : index;
  }

  /** Оформление карточки отказа — индекс у неё один и тот же */
  const noneOptionClass = computed(() =>
    optionClass(CLASS_EQUIPMENT_NONE_INDEX),
  );

  /** Отказ от снаряжения: инвентарь остаётся как есть */
  function selectNone(): void {
    selectOption(CLASS_EQUIPMENT_NONE_INDEX);
  }
</script>

<template>
  <div class="space-y-3">
    <span class="mb-2 block text-sm font-medium text-toned">
      {{
        isSelectable
          ? CLASS_EQUIPMENT_STEP_LABELS.chooseHint
          : CLASS_EQUIPMENT_STEP_LABELS.textOnlyHint
      }}
    </span>

    <div class="grid gap-3 sm:grid-cols-2">
      <component
        :is="optionTag"
        v-for="(option, index) in options"
        :key="option.key"
        :type="optionType"
        class="flex flex-col rounded-xl border p-3 text-left"
        :class="optionClass(index)"
        @click.left.exact.prevent="selectOption(index)"
      >
        <span
          class="mb-2 text-xs font-bold tracking-wider text-primary uppercase"
        >
          {{ CLASS_EQUIPMENT_STEP_LABELS.optionPrefix }}{{ option.key }}
        </span>

        <!-- Позиции, а не строка варианта: строка досталась варианту из
          выгрузки сайта, а лягут в инвентарь именно позиции -->
        <StartingEquipmentOptionBody
          :option="option"
          class="flex-1"
        />
      </component>

      <button
        v-if="isSelectable"
        type="button"
        class="flex flex-col rounded-xl border p-3 text-left sm:col-span-2"
        :class="noneOptionClass"
        @click.left.exact.prevent="selectNone"
      >
        <span
          class="mb-2 text-xs font-bold tracking-wider text-primary uppercase"
        >
          {{ CLASS_EQUIPMENT_STEP_LABELS.noneTitle }}
        </span>

        <span class="text-sm text-toned">
          {{ CLASS_EQUIPMENT_STEP_LABELS.noneDescription }}
        </span>
      </button>
    </div>
  </div>
</template>
