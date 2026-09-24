<!--
  Шаг «Срабатывания»: урон каждый ход, повторный спасбросок, снятие после атаки
  и свои срабатывания одним списком. Запись — «сначала старые поля»: то, что
  выражает старое поле, пишется в него, остальное — в `triggers`.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    EffectFormLayout,
    EffectTrigger,
    EffectTriggerPreset,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    createEffectTriggerPreset,
    DEFAULT_EFFECT_CHARGES,
    listEffectListTriggers,
    listEffectTriggerPresets,
    listTriggerTags,
    MAX_EFFECT_CHARGES,
    MIN_EFFECT_CHARGES,
    writeEffectTriggerRow,
  } from '@vtt/shared/system/dnd.js';

  import {
    EFFECT_TRIGGER_PRESET_ICONS,
    EFFECT_TRIGGER_PRESET_LABELS,
    EFFECT_TRIGGERS_STEP_LABELS,
  } from '../triggerLabels';
  import EffectTriggerRow from './EffectTriggerRow.vue';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
    /** Сл источника для «Авто», если окно её знает */
    sourceSaveDc?: number;
  }>();

  /** Эффект окна: строки списка пишутся в него «сначала старые поля» */
  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const rows = computed(() => listEffectListTriggers(effect.value));

  /** Заряды: выключены — поля нет вовсе, а не ноль зарядов */
  const hasCharges = computed({
    get: () => effect.value.charges !== undefined,
    set: (enabled: boolean) => {
      effect.value = {
        ...effect.value,
        charges: enabled
          ? { max: DEFAULT_EFFECT_CHARGES, current: DEFAULT_EFFECT_CHARGES }
          : undefined,
      };
    },
  });

  const chargesMax = computed({
    get: () => effect.value.charges?.max ?? DEFAULT_EFFECT_CHARGES,
    set: (max: number | null) => {
      const value = Math.max(
        MIN_EFFECT_CHARGES,
        Math.trunc(max ?? DEFAULT_EFFECT_CHARGES),
      );

      effect.value = {
        ...effect.value,
        charges: { ...effect.value.charges, max: value, current: value },
      };
    },
  });

  const chargesEndsWhenEmpty = computed({
    get: () => effect.value.charges?.endsWhenEmpty === true,
    set: (ends: boolean) => {
      const charges = effect.value.charges;

      if (!charges) {
        return;
      }

      effect.value = {
        ...effect.value,
        charges: { ...charges, endsWhenEmpty: ends ? true : undefined },
      };
    },
  });

  const knownTags = computed(() => listTriggerTags(rows.value));

  const presets = computed(() => listEffectTriggerPresets(props.layout));

  /**
   * Записывает строку.
   *
   * @param index - номер строки
   * @param trigger - новая строка; `null` — убрать
   */
  function writeRow(index: number, trigger: EffectTrigger | null): void {
    effect.value = writeEffectTriggerRow(effect.value, index, trigger);
  }

  /**
   * Добавляет готовое срабатывание в конец списка.
   *
   * @param preset - пресет
   */
  function addPreset(preset: EffectTriggerPreset): void {
    writeRow(
      rows.value.length,
      createEffectTriggerPreset(preset, effect.value, props.layout),
    );
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs text-muted">
      {{ EFFECT_TRIGGERS_STEP_LABELS.hint }}
    </p>

    <p
      v-if="rows.length === 0"
      class="rounded-md border border-dashed border-default px-3 py-2 text-center text-xs text-dimmed"
    >
      {{ EFFECT_TRIGGERS_STEP_LABELS.empty }}
    </p>

    <EffectTriggerRow
      v-for="(row, index) in rows"
      :key="`${index}-${row.id}`"
      :trigger="row"
      :layout="layout"
      :source-save-dc="sourceSaveDc"
      :known-tags="knownTags"
      @update:trigger="writeRow(index, $event)"
      @remove="writeRow(index, null)"
    />

    <div
      v-if="layout.showCharges"
      class="flex flex-wrap items-center gap-2"
    >
      <USwitch
        v-model="hasCharges"
        :label="EFFECT_TRIGGERS_STEP_LABELS.chargesToggle"
        size="sm"
      />

      <template v-if="hasCharges">
        <UInputNumber
          v-model="chargesMax"
          :min="MIN_EFFECT_CHARGES"
          :max="MAX_EFFECT_CHARGES"
          size="sm"
          class="w-24"
        />

        <USwitch
          v-model="chargesEndsWhenEmpty"
          :label="EFFECT_TRIGGERS_STEP_LABELS.chargesEndsWhenEmpty"
          size="sm"
        />
      </template>
    </div>

    <p
      v-if="layout.showCharges && hasCharges"
      class="text-xs text-muted"
    >
      {{ EFFECT_TRIGGERS_STEP_LABELS.chargesToggleHint }}
    </p>

    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-muted">
        {{ EFFECT_TRIGGERS_STEP_LABELS.addTitle }}
      </span>

      <UButton
        v-for="preset in presets"
        :key="preset"
        color="primary"
        variant="soft"
        size="xs"
        :icon="EFFECT_TRIGGER_PRESET_ICONS[preset]"
        :label="EFFECT_TRIGGER_PRESET_LABELS[preset]"
        @click.left.exact.prevent="addPreset(preset)"
      />
    </div>
  </div>
</template>
