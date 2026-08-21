<script setup lang="ts">
  import type { FeatChoiceOption } from '@vtt/shared/system/dnd.js';

  import { FEAT_GRANTS_LABELS } from '../constants';

  /**
   * Построчный ввод вариантов «значение + подпись» — для видов дара, у которых
   * общего справочника нет (вариант черты). Значение уходит в данные как есть,
   * подпись видит игрок.
   */
  const options = defineModel<FeatChoiceOption[]>({ required: true });

  function addOption(): void {
    options.value = [...options.value, { value: '', name: '' }];
  }

  function removeOption(index: number): void {
    options.value = options.value.filter(
      (_, optionIndex) => optionIndex !== index,
    );
  }
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div
      v-for="(option, index) in options"
      :key="index"
      class="flex items-center gap-2"
    >
      <UInput
        v-model="option.value"
        :placeholder="FEAT_GRANTS_LABELS.optionValue"
        size="sm"
        class="flex-1"
      />

      <UInput
        v-model="option.name"
        :placeholder="FEAT_GRANTS_LABELS.optionName"
        size="sm"
        class="flex-1"
      />

      <UButton
        icon="tabler:trash"
        color="error"
        variant="ghost"
        size="xs"
        :aria-label="`${FEAT_GRANTS_LABELS.optionValue} ${index + 1}`"
        @click.left.exact.prevent="removeOption(index)"
      />
    </div>

    <UButton
      icon="tabler:plus"
      :label="FEAT_GRANTS_LABELS.optionAdd"
      color="neutral"
      variant="subtle"
      size="xs"
      class="self-start"
      @click.left.exact.prevent="addOption"
    />
  </div>
</template>
