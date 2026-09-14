<!--
  Шаг «Длительность и снятие»: сколько держится эффект, повторный спасбросок
  хода и снятие после атаки.
-->
<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type {
    ActiveEffect,
    EffectDurationType,
    EffectFormLayout,
    EffectSaveTiming,
    EffectTurnAnchor,
    EffectTurnTiming,
    RecurringSave,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    writeRecurringSaveEnabled,
  } from '@vtt/shared/system/dnd.js';

  import { FORM_FIELD_LABELS } from '../../actor/constants';
  import {
    EFFECT_CONSUME_ON_NONE,
    EFFECT_CONSUME_ON_OPTIONS,
    EFFECT_DURATION_STEP_LABELS,
    EFFECT_SOURCE_DC_HINTS,
  } from '../constants';
  import {
    durationHint,
    EFFECT_DURATION_TYPE_OPTIONS,
    EFFECT_SAVE_TIMING_OPTIONS,
    EFFECT_TURN_ANCHOR_OPTIONS,
    EFFECT_TURN_TIMING_OPTIONS,
    findConsumeOn,
    isCountedDuration,
    writeDurationType,
  } from '../effectFormOptions';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const durationType = computed({
    get: () => effect.value.duration.type,
    set: (type: EffectDurationType) => {
      effect.value = {
        ...effect.value,
        duration: writeDurationType(effect.value.duration, type),
      };
    },
  });

  const hasDurationValue = computed(() =>
    isCountedDuration(effect.value.duration.type),
  );

  const isTurnDuration = computed(() => effect.value.duration.type === 'turn');

  const durationDescription = computed(() =>
    durationHint(effect.value.duration.type),
  );

  const durationValue = computed({
    get: () => effect.value.duration.value ?? null,
    set: (value: number | null) => {
      effect.value = {
        ...effect.value,
        duration: { ...effect.value.duration, value: value ?? undefined },
      };
    },
  });

  const turnTiming = computed({
    get: () => effect.value.duration.turnTiming ?? 'end',
    set: (timing: EffectTurnTiming) => {
      effect.value = {
        ...effect.value,
        duration: { ...effect.value.duration, turnTiming: timing },
      };
    },
  });

  const turnAnchor = computed({
    get: () => effect.value.duration.turnAnchor ?? 'carrier',
    set: (anchor: EffectTurnAnchor) => {
      effect.value = {
        ...effect.value,
        duration: { ...effect.value.duration, turnAnchor: anchor },
      };
    },
  });

  const hasRecurringSave = computed({
    get: () => effect.value.recurringSave !== undefined,
    set: (enabled: boolean) => {
      effect.value = writeRecurringSaveEnabled(
        effect.value,
        enabled,
        props.layout,
      );
    },
  });

  /**
   * Меняет поле повторного спасброска.
   *
   * @param patch - изменённые поля
   */
  function updateRecurringSave(patch: Partial<RecurringSave>): void {
    const { recurringSave } = effect.value;

    if (recurringSave) {
      effect.value = {
        ...effect.value,
        recurringSave: { ...recurringSave, ...patch },
      };
    }
  }

  const recurringAbility = computed({
    get: () => effect.value.recurringSave?.ability ?? 'wisdom',
    set: (ability: AbilityType) => updateRecurringSave({ ability }),
  });

  const recurringDc = computed({
    get: () => effect.value.recurringSave?.dc ?? props.layout.minSaveDc,
    set: (dc: number | null) => {
      if (dc !== null) {
        updateRecurringSave({ dc });
      }
    },
  });

  const recurringTiming = computed({
    get: () => effect.value.recurringSave?.timing ?? 'endOfTurn',
    set: (timing: EffectSaveTiming) => updateRecurringSave({ timing }),
  });

  /** Подсказка «0 — Сл источника» там, где Сл 0 допустима */
  const dcHint = computed(() =>
    props.layout.minSaveDc === 0
      ? EFFECT_SOURCE_DC_HINTS[props.layout.context]
      : undefined,
  );

  /** Значение переключателя «снять после атаки» */
  const consumeOn = computed(
    () => effect.value.consumeOn ?? EFFECT_CONSUME_ON_NONE,
  );

  /**
   * Меняет снятие после атаки.
   *
   * @param value - значение переключателя
   */
  function selectConsumeOn(value: string | number): void {
    effect.value = { ...effect.value, consumeOn: findConsumeOn(value) };
  }
</script>

<template>
  <div
    v-if="layout.showDuration"
    class="flex flex-col gap-1.5"
  >
    <span class="text-xs font-medium text-default">
      {{ EFFECT_DURATION_STEP_LABELS.durationTitle }}
    </span>

    <div class="flex flex-wrap items-center gap-2">
      <USelect
        v-model="durationType"
        :items="EFFECT_DURATION_TYPE_OPTIONS"
        value-key="value"
        size="sm"
        class="w-48"
        :portal="false"
      />

      <UInputNumber
        v-if="hasDurationValue"
        v-model="durationValue"
        :min="0"
        :placeholder="EFFECT_DURATION_STEP_LABELS.valuePlaceholder"
        size="sm"
        class="w-28"
      />

      <template v-if="isTurnDuration">
        <USelect
          v-model="turnTiming"
          :items="EFFECT_TURN_TIMING_OPTIONS"
          value-key="value"
          size="sm"
          class="w-40"
          :portal="false"
        />

        <USelect
          v-model="turnAnchor"
          :items="EFFECT_TURN_ANCHOR_OPTIONS"
          value-key="value"
          size="sm"
          class="w-48"
          :portal="false"
        />
      </template>
    </div>

    <p class="text-xs text-muted">
      {{ durationDescription }}
    </p>
  </div>

  <div
    v-if="layout.showRecurringSave"
    class="flex flex-col gap-2"
  >
    <USwitch
      v-model="hasRecurringSave"
      :label="EFFECT_DURATION_STEP_LABELS.recurringSaveToggle"
      :description="EFFECT_DURATION_STEP_LABELS.recurringSaveHint"
    />

    <div
      v-if="effect.recurringSave"
      class="flex flex-wrap items-end gap-3"
    >
      <UFormField
        :label="FORM_FIELD_LABELS.ability"
        class="w-48"
      >
        <USelect
          v-model="recurringAbility"
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
          v-model="recurringDc"
          :min="layout.minSaveDc"
          size="sm"
          class="w-32"
        />
      </UFormField>

      <UFormField
        :label="EFFECT_DURATION_STEP_LABELS.recurringSaveWhen"
        class="w-44"
      >
        <USelect
          v-model="recurringTiming"
          :items="EFFECT_SAVE_TIMING_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>
    </div>
  </div>

  <div
    v-if="layout.showConsumeOn"
    class="flex flex-col gap-1.5"
  >
    <span class="text-xs font-medium text-default">
      {{ EFFECT_DURATION_STEP_LABELS.consumeOnTitle }}
    </span>

    <UTabs
      :model-value="consumeOn"
      :items="EFFECT_CONSUME_ON_OPTIONS"
      :content="false"
      size="xs"
      color="primary"
      class="w-fit"
      @update:model-value="selectConsumeOn"
    />

    <p class="text-xs text-muted">
      {{ EFFECT_DURATION_STEP_LABELS.consumeOnHint }}
    </p>
  </div>
</template>
