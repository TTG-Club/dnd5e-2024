<!--
  Шапка эффекта: название, иконка и включён ли эффект. Шаблон состояния — в
  шаге «Что меняет», рядом с особыми правилами: там его и ищут.
-->
<script setup lang="ts">
  import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { FORM_FIELD_LABELS } from '../../actor/constants';
  import { ACTIVE_EFFECT_FORM_LABELS } from '../constants';

  defineProps<{
    /** Показывать переключатель «Работает» */
    showStatusToggle: boolean;
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

    <!-- Высота — как у полей рядом; корень переключателя прижимает его к верху -->
    <USwitch
      v-if="showStatusToggle"
      v-model="isActive"
      :label="statusLabel"
      class="h-8 items-center"
    />
  </div>
</template>
