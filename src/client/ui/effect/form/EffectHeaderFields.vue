<!--
  Шапка эффекта: название, иконка, включён ли эффект и шаблон состояния.
-->
<script setup lang="ts">
  import type { ActiveEffect, ConditionRef } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    applyConditionPresetToEffect,
    buildConditionActiveEffect,
    listSelectableConditions,
  } from '@vtt/shared/system/dnd.js';

  import {
    FORM_FIELD_LABELS,
    SCROLLABLE_DROPDOWN_UI,
  } from '../../actor/constants';
  import {
    ACTIVE_EFFECT_FORM_LABELS,
    CONDITION_PRESET_EXCLUDED_KEY,
  } from '../constants';

  defineProps<{
    /** Показывать кнопку «Шаблон состояния» */
    showConditionPreset: boolean;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const name = computed({
    get: () => effect.value.name,
    set: (value: string) => {
      effect.value = { ...effect.value, name: value };
    },
  });

  const icon = computed({
    get: () => effect.value.icon ?? '',
    set: (value: string) => {
      effect.value = { ...effect.value, icon: value || undefined };
    },
  });

  const isActive = computed({
    get: () => !effect.value.disabled,
    set: (value: boolean) => {
      effect.value = { ...effect.value, disabled: !value };
    },
  });

  /** Подпись переключателя «работает / отключён» */
  const statusLabel = computed(() =>
    isActive.value
      ? ACTIVE_EFFECT_FORM_LABELS.statusActive
      : ACTIVE_EFFECT_FORM_LABELS.statusDisabled,
  );

  /**
   * Заполняет эффект тем, что делает состояние, не трогая срабатывание.
   *
   * @param conditionKey - ключ состояния
   */
  function applyConditionPreset(conditionKey: ConditionRef): void {
    const condition = buildConditionActiveEffect(conditionKey);

    if (!condition) {
      return;
    }

    effect.value = applyConditionPresetToEffect(effect.value, condition);
  }

  // Список вычисляемый: кроме канона в него входят состояния, заведённые в
  // мире, — они появляются и исчезают, пока окно открыто
  const conditionPresetItems = computed(() => [
    listSelectableConditions()
      .filter((condition) => condition.key !== CONDITION_PRESET_EXCLUDED_KEY)
      .map((condition) => ({
        label: condition.nameRu,
        icon: condition.icon,
        onSelect: () => applyConditionPreset(condition.key),
      })),
  ]);
</script>

<template>
  <div class="flex flex-wrap items-end gap-3">
    <UFormField
      :label="FORM_FIELD_LABELS.name"
      class="min-w-48 flex-1"
    >
      <UInput
        v-model="name"
        class="w-full"
      />
    </UFormField>

    <UFormField
      :label="ACTIVE_EFFECT_FORM_LABELS.icon"
      class="w-56"
    >
      <UInput
        v-model="icon"
        :icon="icon || undefined"
        :placeholder="ACTIVE_EFFECT_FORM_LABELS.iconPlaceholder"
        class="w-full"
      />
    </UFormField>

    <UDropdownMenu
      v-if="showConditionPreset"
      :items="conditionPresetItems"
      :content="{ align: 'end' }"
      :ui="SCROLLABLE_DROPDOWN_UI"
    >
      <UButton
        icon="tabler:template"
        :label="ACTIVE_EFFECT_FORM_LABELS.conditionPreset"
        :title="ACTIVE_EFFECT_FORM_LABELS.conditionPresetHint"
        color="neutral"
        variant="outline"
      />
    </UDropdownMenu>

    <!-- Высота — как у полей рядом; корень переключателя прижимает его к верху -->
    <USwitch
      v-model="isActive"
      :label="statusLabel"
      class="h-8 items-center"
    />
  </div>
</template>
