<!--
  Сворачиваемый раздел «Для опытных»: включает у модификаторов режим, условие и
  приоритет. Большинству эффектов хватает «что меняется» и значения.
-->
<script setup lang="ts">
  import { EFFECT_ADVANCED_LABELS } from '../constants';

  /** Показывать режим, условие и приоритет у всех модификаторов */
  const showAdvancedFields = defineModel<boolean>('showAdvancedFields', {
    required: true,
  });
</script>

<template>
  <UCollapsible class="flex flex-col gap-2">
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      icon="tabler:settings"
      trailing-icon="tabler:chevron-down"
      :label="EFFECT_ADVANCED_LABELS.title"
      class="w-full justify-start"
      :ui="{
        trailingIcon:
          'ms-auto transition-transform duration-200 group-data-[state=open]:rotate-180',
      }"
    />

    <template #content>
      <div class="px-1 pb-1">
        <USwitch
          v-model="showAdvancedFields"
          :label="EFFECT_ADVANCED_LABELS.advancedFields"
          :description="EFFECT_ADVANCED_LABELS.advancedFieldsHint"
        />
      </div>
    </template>
  </UCollapsible>
</template>
