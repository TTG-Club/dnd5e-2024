<!--
  Шаг «Урон»: урон в момент срабатывания и урон каждый ход.
-->
<script setup lang="ts">
  import type { DamagePart } from '@vtt/shared';
  import type {
    ActiveEffect,
    EffectFormLayout,
    EffectSaveTiming,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import DamagePartsEditor from '../../actor/DamagePartsEditor.vue';
  import {
    DEFAULT_RECURRING_DAMAGE_TIMING,
    EFFECT_DAMAGE_STEP_LABELS,
  } from '../constants';
  import { EFFECT_SAVE_TIMING_OPTIONS } from '../effectFormOptions';

  defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const systemDataStore = useSystemDataStore();

  const damageTypeOptions = computed(() =>
    systemDataStore.damageTypes.map((damageType) => ({
      label: damageType.name,
      value: damageType.key,
    })),
  );

  const triggerDamage = computed({
    get: () => effect.value.damageParts ?? [],
    set: (parts: DamagePart[]) => {
      effect.value = {
        ...effect.value,
        damageParts: parts.length > 0 ? parts : undefined,
      };
    },
  });

  const hasRecurringDamage = computed({
    get: () => effect.value.recurringDamage !== undefined,
    set: (enabled: boolean) => {
      effect.value = {
        ...effect.value,
        recurringDamage: enabled
          ? { damageParts: [], timing: DEFAULT_RECURRING_DAMAGE_TIMING }
          : undefined,
      };
    },
  });

  const recurringDamageParts = computed({
    get: () => effect.value.recurringDamage?.damageParts ?? [],
    set: (damageParts: DamagePart[]) => {
      const { recurringDamage } = effect.value;

      if (recurringDamage) {
        effect.value = {
          ...effect.value,
          recurringDamage: { ...recurringDamage, damageParts },
        };
      }
    },
  });

  const recurringDamageTiming = computed({
    get: () =>
      effect.value.recurringDamage?.timing ?? DEFAULT_RECURRING_DAMAGE_TIMING,
    set: (timing: EffectSaveTiming) => {
      const { recurringDamage } = effect.value;

      if (recurringDamage) {
        effect.value = {
          ...effect.value,
          recurringDamage: { ...recurringDamage, timing },
        };
      }
    },
  });
</script>

<template>
  <div
    v-if="layout.showTriggerDamage"
    class="flex flex-col gap-2"
  >
    <div>
      <span class="text-xs font-medium text-default">
        {{ EFFECT_DAMAGE_STEP_LABELS.triggerTitle }}
      </span>

      <p class="text-xs text-muted">
        {{ EFFECT_DAMAGE_STEP_LABELS.triggerHint }}
      </p>
    </div>

    <DamagePartsEditor
      v-model="triggerDamage"
      :damage-type-options="damageTypeOptions"
      :include-spell-modifier="false"
      :hide-modifiers="true"
      :hide-healing="true"
      :allow-empty="true"
      :add-label="EFFECT_DAMAGE_STEP_LABELS.addDamage"
    />
  </div>

  <div
    v-if="layout.showRecurringDamage"
    class="flex flex-col gap-2"
  >
    <USwitch
      v-model="hasRecurringDamage"
      :label="EFFECT_DAMAGE_STEP_LABELS.recurringToggle"
      :description="EFFECT_DAMAGE_STEP_LABELS.recurringHint"
    />

    <template v-if="effect.recurringDamage">
      <UFormField
        :label="EFFECT_DAMAGE_STEP_LABELS.recurringWhen"
        class="w-48"
      >
        <USelect
          v-model="recurringDamageTiming"
          :items="EFFECT_SAVE_TIMING_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <DamagePartsEditor
        v-model="recurringDamageParts"
        :damage-type-options="damageTypeOptions"
        :include-spell-modifier="false"
        :hide-modifiers="true"
        :hide-healing="true"
        :allow-empty="true"
        :add-label="EFFECT_DAMAGE_STEP_LABELS.addDamage"
      />
    </template>
  </div>
</template>
