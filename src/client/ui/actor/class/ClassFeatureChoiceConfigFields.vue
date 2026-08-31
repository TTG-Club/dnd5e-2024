<script setup lang="ts">
  import type { EditableClassFeatureChoiceConfig } from './classEditorTypes';

  import { computed } from 'vue';

  import ChoiceScalingRows from '../ChoiceScalingRows.vue';
  import {
    CHOICE_CONFIG_DEFAULT_COUNT,
    CHOICE_COUNT_MAX,
    CHOICE_COUNT_MIN,
    CLASS_FEATURE_CHOICE_CONFIG_LABELS,
  } from '../constants';
  import FieldHint from '../FieldHint.vue';

  /**
   * Настройка выбора из вариантов умения.
   *
   * Список бывает справочным и выбираемым: справочный только показывается
   * описанием умения, выбираемый ещё и спрашивается на уровне. Отличает их
   * наличие самой настройки, поэтому галочка не отдельное поле, а заведение и
   * снятие всей настройки целиком — так же читает запись потребитель.
   *
   * Блок идёт перед списком вариантов: сначала автор решает, выбирают из списка
   * или он справочный, и лишь потом набирает варианты.
   */
  const config = defineModel<EditableClassFeatureChoiceConfig | undefined>({
    required: true,
  });

  /** Выбираемый ли список: настройка есть — значит, да. */
  const isSelectable = computed(() => config.value !== undefined);

  /**
   * Включает и выключает выбор. Настройка снимается целиком: оставленный рядом
   * с выключенной галочкой счёт спросил бы игрока в мастере уровня.
   *
   * @param enabled - новое состояние галочки
   */
  function toggleSelectable(enabled: boolean | 'indeterminate'): void {
    config.value =
      enabled === true
        ? {
            label: '',
            count: CHOICE_CONFIG_DEFAULT_COUNT,
            scaling: [],
          }
        : undefined;
  }
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-md border border-default bg-elevated/40 p-3"
  >
    <div class="flex items-center gap-1">
      <UCheckbox
        :model-value="isSelectable"
        :label="CLASS_FEATURE_CHOICE_CONFIG_LABELS.selectable"
        @update:model-value="toggleSelectable"
      />

      <FieldHint :text="CLASS_FEATURE_CHOICE_CONFIG_LABELS.selectableHint" />
    </div>

    <template v-if="config">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField class="w-27.5">
          <template #label>
            <span class="flex items-center gap-1">
              {{ CLASS_FEATURE_CHOICE_CONFIG_LABELS.count }}

              <FieldHint :text="CLASS_FEATURE_CHOICE_CONFIG_LABELS.countHint" />
            </span>
          </template>

          <UInputNumber
            v-model="config.count"
            :min="CHOICE_COUNT_MIN"
            :max="CHOICE_COUNT_MAX"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="CLASS_FEATURE_CHOICE_CONFIG_LABELS.label"
          class="min-w-48 flex-1"
        >
          <UInput
            v-model="config.label"
            :placeholder="CLASS_FEATURE_CHOICE_CONFIG_LABELS.labelPlaceholder"
            class="w-full"
          />
        </UFormField>
      </div>

      <!-- Рост количества: ступень называет итог к уровню, а не прибавку —
        мастеру уровня остаётся спросить разницу с предыдущей -->
      <ChoiceScalingRows
        v-model="config.scaling"
        :base-count="config.count"
        :empty-text="CLASS_FEATURE_CHOICE_CONFIG_LABELS.scalingEmpty"
        :hint="CLASS_FEATURE_CHOICE_CONFIG_LABELS.scalingHint"
      />
    </template>
  </div>
</template>
