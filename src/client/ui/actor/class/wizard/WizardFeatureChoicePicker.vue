<script setup lang="ts">
  import type { ChoicePickerOption } from '../../ChoicePickerModal.vue';
  import type { WizardFeatureChoicePick } from './useClassWizard';

  import { computed } from 'vue';

  import ChoicePickerField from '../../ChoicePickerField.vue';
  import { CLASS_WIZARD_LABELS } from '../../constants';

  /**
   * Выбор вариантов одного умения: боевой стиль, манёвры, воззвания.
   *
   * Вариантов берут столько, сколько назначила настройка выбора умения, и это
   * число растёт по уровням — поэтому пикер не «одна кнопка из списка», а набор
   * со счётчиком. Когда берут один вариант, нажатие переносит выбор на него:
   * снимать прежний вручную незачем.
   *
   * Сами варианты выбираются в общем окне ({@link ChoicePickerField}), а не
   * списком прямо в шаге: у колдуна их два десятка, и стеной строк за ними не
   * было видно ни счётчика, ни остальных умений уровня. В шаге остаётся строка
   * со взятым и кнопкой — так же, как у всех прочих выборов листа.
   *
   * Взятое на прошлых уровнях показывается отдельной строкой и не выбирается —
   * второй раз одно и то же воззвание не берут. Помеченные повторяемыми
   * остаются в общем списке: их для того и помечают.
   */
  const props = defineProps<{
    pick: WizardFeatureChoicePick;
    /** Ключи вариантов, выбранных на этом уровне */
    selected: string[];
  }>();

  const emit = defineEmits<{
    'update:selected': [featureKey: string, choiceKeys: string[]];
  }>();

  /** Варианты для окна выбора: описание открывается в нём отдельным окном */
  const options = computed<ChoicePickerOption[]>(() =>
    props.pick.options.map((choice) => ({
      value: choice.key,
      name: choice.name,
      nameEn: choice.nameEn,
      additional: choice.additional,
      prerequisite: choice.prerequisite,
      description: choice.description,
      repeatable: choice.repeatable,
    })),
  );

  /**
   * Записывает выбранные варианты.
   *
   * @param choiceKeys - ключи отмеченных вариантов
   */
  function applySelection(choiceKeys: string[]): void {
    emit('update:selected', props.pick.featureKey, choiceKeys);
  }
</script>

<template>
  <ChoicePickerField
    :label="props.pick.label"
    :subtitle="props.pick.featureName"
    :options="options"
    :selected="props.selected"
    :max="props.pick.count"
    @update:selected="applySelection"
  >
    <!-- Взятое раньше: видно, что уже потрачено, но выбрать нельзя -->
    <template
      v-if="props.pick.taken.length > 0"
      #hint
    >
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-dimmed">
          {{ CLASS_WIZARD_LABELS.choiceTakenTitle }}
        </span>

        <UBadge
          v-for="choice in props.pick.taken"
          :key="choice.key"
          size="sm"
          color="neutral"
          variant="subtle"
        >
          {{ choice.name }}
        </UBadge>
      </div>
    </template>
  </ChoicePickerField>
</template>
