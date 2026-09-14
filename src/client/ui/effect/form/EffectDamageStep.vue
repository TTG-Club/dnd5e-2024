<!--
  Шаг «Урон»: урон в момент срабатывания и урон каждый ход — по желанию со
  спасброском против него на каждом ходу.
-->
<script setup lang="ts">
  import type { AbilityType, DamagePart } from '@vtt/shared';
  import type {
    ActiveEffect,
    EffectFormLayout,
    EffectSave,
    EffectSaveOutcome,
    EffectSaveTiming,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    writeRecurringDamageSaveEnabled,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import { FORM_FIELD_LABELS } from '../../actor/constants';
  import DamagePartsEditor from '../../actor/DamagePartsEditor.vue';
  import {
    DEFAULT_RECURRING_DAMAGE_TIMING,
    EFFECT_DAMAGE_STEP_LABELS,
    EFFECT_SOURCE_DC_HINTS,
  } from '../constants';
  import {
    EFFECT_RECURRING_DAMAGE_SUCCESS_OPTIONS,
    EFFECT_SAVE_TIMING_OPTIONS,
  } from '../effectFormOptions';

  const props = defineProps<{
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

  const hasRecurringDamageSave = computed({
    get: () => effect.value.recurringDamage?.save !== undefined,
    set: (enabled: boolean) => {
      effect.value = writeRecurringDamageSaveEnabled(
        effect.value,
        enabled,
        props.layout,
      );
    },
  });

  /**
   * Меняет поле спасброска против урона каждый ход.
   *
   * @param patch - изменённые поля
   */
  function updateRecurringDamageSave(patch: Partial<EffectSave>): void {
    const { recurringDamage } = effect.value;

    if (recurringDamage?.save) {
      effect.value = {
        ...effect.value,
        recurringDamage: {
          ...recurringDamage,
          save: { ...recurringDamage.save, ...patch },
        },
      };
    }
  }

  const recurringSaveAbility = computed({
    get: () => effect.value.recurringDamage?.save?.ability ?? 'wisdom',
    set: (ability: AbilityType) => updateRecurringDamageSave({ ability }),
  });

  const recurringSaveDc = computed({
    get: () => effect.value.recurringDamage?.save?.dc ?? props.layout.minSaveDc,
    set: (dc: number | null) => {
      if (dc !== null) {
        updateRecurringDamageSave({ dc });
      }
    },
  });

  const recurringSaveOnSuccess = computed({
    get: () => effect.value.recurringDamage?.save?.onSuccess ?? 'negate',
    set: (onSuccess: EffectSaveOutcome) =>
      updateRecurringDamageSave({ onSuccess }),
  });

  /** Подсказка «0 — Сл источника» там, где Сл 0 допустима */
  const dcHint = computed(() =>
    props.layout.minSaveDc === 0
      ? EFFECT_SOURCE_DC_HINTS[props.layout.context]
      : undefined,
  );
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

      <USwitch
        v-model="hasRecurringDamageSave"
        :label="EFFECT_DAMAGE_STEP_LABELS.recurringSaveToggle"
        :description="EFFECT_DAMAGE_STEP_LABELS.recurringSaveHint"
      />

      <div
        v-if="effect.recurringDamage.save"
        class="flex flex-wrap items-end gap-3"
      >
        <UFormField
          :label="FORM_FIELD_LABELS.ability"
          class="w-48"
        >
          <USelect
            v-model="recurringSaveAbility"
            :items="ABILITY_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>

        <UFormField
          :label="FORM_FIELD_LABELS.saveDc"
          :hint="dcHint"
          class="w-56"
        >
          <UInputNumber
            v-model="recurringSaveDc"
            :min="layout.minSaveDc"
            size="sm"
            class="w-32"
          />
        </UFormField>

        <UFormField
          :label="EFFECT_DAMAGE_STEP_LABELS.recurringSaveSuccess"
          class="w-48"
        >
          <USelect
            v-model="recurringSaveOnSuccess"
            :items="EFFECT_RECURRING_DAMAGE_SUCCESS_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>
      </div>
    </template>
  </div>
</template>
