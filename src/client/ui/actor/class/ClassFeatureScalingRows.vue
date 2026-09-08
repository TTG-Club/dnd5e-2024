<script setup lang="ts">
  import type { EditableClassFeatureScaling } from './classEditorTypes';

  import { CLASS_FEATURE_LABELS, CLASS_LEVEL_MAX } from '../constants';

  /**
   * Ступени роста умения по уровням: строка — уровень, на котором умение
   * повторяется или усиливается.
   *
   * Кнопка добавления живёт в шапке блока, а не здесь: пустому блоку хватает
   * одной строки заголовка.
   */
  const scaling = defineModel<EditableClassFeatureScaling[]>({
    required: true,
  });

  /**
   * Убирает ступень.
   *
   * @param index - позиция ступени в списке
   */
  function removeStep(index: number): void {
    scaling.value.splice(index, 1);
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(step, stepIndex) in scaling"
      :key="step.uid"
      class="flex flex-col gap-2 rounded-md border border-default bg-elevated/30 p-2"
    >
      <div class="flex flex-wrap items-end gap-2">
        <UFormField
          :label="CLASS_FEATURE_LABELS.scalingLevel"
          class="w-27.5"
        >
          <UInputNumber
            v-model="step.level"
            :min="1"
            :max="CLASS_LEVEL_MAX"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="CLASS_FEATURE_LABELS.scalingName"
          class="min-w-48 flex-1"
        >
          <UInput
            v-model="step.name"
            :placeholder="CLASS_FEATURE_LABELS.scalingNamePlaceholder"
            class="w-full"
          />
        </UFormField>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          class="mb-1"
          :aria-label="CLASS_FEATURE_LABELS.scalingRemove"
          @click.left.exact.prevent="removeStep(stepIndex)"
        />
      </div>

      <UFormField :label="CLASS_FEATURE_LABELS.scalingDescription">
        <UTextarea
          v-model="step.description"
          :rows="2"
          autoresize
          :placeholder="CLASS_FEATURE_LABELS.scalingDescriptionPlaceholder"
          class="w-full"
        />
      </UFormField>
    </div>
  </div>
</template>
