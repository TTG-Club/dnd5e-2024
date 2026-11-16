<!--
  Поля контейнера предмета: «Это контейнер», вместимость в фунтах и
  «Содержимое не весит». Само содержимое мешка хранит ядро — здесь только
  правила D&D, по которым система решает, влезет ли вещь и весит ли она.
-->
<script setup lang="ts">
  import { EQUIPMENT_FORM_LABELS } from './constants';

  const isContainer = defineModel<boolean>('isContainer', { required: true });

  const capacity = defineModel<number | null>('capacity', { required: true });

  const weightless = defineModel<boolean>('weightless', { required: true });
</script>

<template>
  <div class="flex flex-col gap-3">
    <UCheckbox
      v-model="isContainer"
      variant="card"
      icon="tabler:check"
      :label="EQUIPMENT_FORM_LABELS.isContainer"
      :description="EQUIPMENT_FORM_LABELS.isContainerDescription"
    />

    <template v-if="isContainer">
      <UFormField :label="EQUIPMENT_FORM_LABELS.containerCapacity">
        <UInput
          v-model.number="capacity"
          type="number"
          :min="0"
          :placeholder="EQUIPMENT_FORM_LABELS.containerCapacityPlaceholder"
          class="w-full"
        />
      </UFormField>

      <UCheckbox
        v-model="weightless"
        variant="card"
        icon="tabler:check"
        :label="EQUIPMENT_FORM_LABELS.containerWeightless"
        :description="EQUIPMENT_FORM_LABELS.containerWeightlessDescription"
      />
    </template>
  </div>
</template>
