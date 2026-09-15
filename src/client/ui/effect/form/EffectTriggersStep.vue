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
    listEffectListTriggers,
    listEffectTriggerPresets,
    listTriggerTags,
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
