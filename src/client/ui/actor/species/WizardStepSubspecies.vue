<script setup lang="ts">
  import type { SpeciesDefinition } from '@vtt/shared/system/dnd.js';

  import type { ChoicePickerOption } from '../ChoicePickerModal.vue';
  import type { SpeciesWizardState } from './useSpeciesWizard';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';

  import ChoicePickerField from '../ChoicePickerField.vue';
  import { LEVEL_BADGE_SUFFIX, SPECIES_WIZARD_LABELS } from '../constants';

  /**
   * Шаг выбора происхождения (записи-подвида) в мастере настройки вида.
   *
   * Происхождение — самостоятельная запись вида со ссылкой на родителя, поэтому
   * шаг показывает её собственное описание и особенности целиком, а не текст
   * встроенного варианта, как у легаси-формата.
   */
  const props = defineProps<{
    /** Записи-подвиды выбранного вида, по алфавиту */
    subspeciesOptions: SpeciesDefinition[];
    state: SpeciesWizardState;
  }>();

  const emit = defineEmits<{
    'update:state': [value: SpeciesWizardState];
  }>();

  /** Происхождения для окна выбора: описание читают, не закрывая окна */
  const pickerOptions = computed<ChoicePickerOption[]>(() =>
    props.subspeciesOptions.map((option) => ({
      value: option.key,
      name: option.name,
      nameEn: option.nameEn,
      description: option.description,
    })),
  );

  /** Выбранное происхождение набором отметок — так его ждёт строка выбора */
  const pickerSelected = computed(() =>
    props.state.subspeciesKey ? [props.state.subspeciesKey] : [],
  );

  const selectedSubspecies = computed(
    () =>
      props.subspeciesOptions.find(
        (option) => option.key === props.state.subspeciesKey,
      ) ?? null,
  );

  /**
   * Записывает выбранное происхождение в состояние мастера. Ответы на выборы
   * даров прежнего происхождения сбрасываются — вопросы у нового свои.
   *
   * Окно выбора отдаёт набор отметок, а происхождение берут одно. Снятый выбор
   * записывается пустотой, а не пустой строкой: пройденность шага мастер
   * проверяет сравнением с `null`, и `''` считался бы выбранным происхождением.
   *
   * @param subspeciesKeys - ключи отмеченных записей-подвидов
   */
  function selectSubspecies(subspeciesKeys: string[]): void {
    emit('update:state', {
      ...props.state,
      subspeciesKey: subspeciesKeys[0] ?? null,
      featDataChoices: {},
    });
  }
</script>

<template>
  <div class="flex flex-col gap-4 p-1">
    <div class="rounded-lg bg-elevated p-4">
      <ChoicePickerField
        :label="SPECIES_WIZARD_LABELS.chooseSubspecies"
        :options="pickerOptions"
        :selected="pickerSelected"
        :max="1"
        @update:selected="selectSubspecies"
      />

      <p class="mt-2 text-xs text-dimmed">
        {{ SPECIES_WIZARD_LABELS.subspeciesHint }}
      </p>
    </div>

    <template v-if="selectedSubspecies">
      <div class="rounded-lg bg-elevated p-4">
        <span class="font-medium text-primary">
          {{ selectedSubspecies.name }}
        </span>

        <ItemDescriptionRenderer
          :content="selectedSubspecies.description"
          class="mt-2"
        />
      </div>

      <div
        v-for="feature in selectedSubspecies.features"
        :key="feature.key"
        class="rounded-md border border-default/40 bg-default/40 p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium text-healing">
            {{ feature.name }}
          </span>

          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ feature.level ?? 1 }}{{ LEVEL_BADGE_SUFFIX }}
          </UBadge>
        </div>

        <ItemDescriptionRenderer
          :content="feature.description"
          class="mt-1"
        />
      </div>
    </template>
  </div>
</template>
