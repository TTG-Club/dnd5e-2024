<!--
  Шаг «Длительность»: сколько держится эффект. Повторный спасбросок и снятие
  после атаки — строки списка «Срабатывания».
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    EffectDurationType,
    EffectFormLayout,
    EffectTurnAnchor,
    EffectTurnTiming,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { EFFECT_DURATION_STEP_LABELS } from '../constants';
  import {
    durationHint,
    EFFECT_DURATION_TYPE_OPTIONS,
    EFFECT_TURN_ANCHOR_OPTIONS,
    EFFECT_TURN_TIMING_OPTIONS,
    isCountedDuration,
    writeDurationType,
  } from '../effectFormOptions';

  defineProps<{
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
</template>
