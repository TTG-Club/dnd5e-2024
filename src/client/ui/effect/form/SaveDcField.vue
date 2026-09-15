<!--
  Поле Сл спасброска. Где у Сл есть источник (заклинатель, действие, оружие),
  выбирается «Авто» — Сл источника, в данных это 0 — или «Вручную» со своим
  числом. Где источника нет, остаётся только число.
-->
<script setup lang="ts">
  import type { SaveDcFieldMode } from '../constants';

  import { computed } from 'vue';

  import {
    DEFAULT_EFFECT_SAVE_DC,
    SOURCE_SAVE_DC,
  } from '@vtt/shared/system/dnd.js';

  import {
    SAVE_DC_AUTO_SEPARATOR,
    SAVE_DC_FIELD_MODE_OPTIONS,
  } from '../effectFormOptions';

  const props = defineProps<{
    /** Подпись поля */
    label: string;
    /** Пояснение под подписью */
    description?: string;
    /** Можно ли «Авто»: у Сл есть источник */
    autoAllowed: boolean;
    /** Чья Сл подставляется в «Авто» («Сл заклинателя») */
    autoLabel?: string;
    /** Посчитанная Сл источника, если окно её знает */
    autoValue?: number;
  }>();

  /** Сл: `SOURCE_SAVE_DC` — «Авто» */
  const dc = defineModel<number>({ required: true });

  const mode = computed<SaveDcFieldMode>({
    get: () =>
      props.autoAllowed && dc.value === SOURCE_SAVE_DC ? 'auto' : 'manual',
    set: (nextMode) => {
      if (nextMode === 'auto') {
        dc.value = SOURCE_SAVE_DC;

        return;
      }

      // Своё число начинается с того, что сейчас дал бы источник
      if (dc.value === SOURCE_SAVE_DC) {
        dc.value = props.autoValue ?? DEFAULT_EFFECT_SAVE_DC;
      }
    },
  });

  const manualDc = computed({
    get: () => dc.value,
    set: (value: number | null) => {
      if (value !== null) {
        dc.value = value;
      }
    },
  });

  /** Что подставится в «Авто»: чья Сл и её число, если известно */
  const autoText = computed(() => {
    const label = props.autoLabel ?? '';

    return props.autoValue === undefined
      ? label
      : `${label}${SAVE_DC_AUTO_SEPARATOR}${props.autoValue}`;
  });
</script>

<template>
  <UFormField
    :label="label"
    :description="description"
    class="min-w-56"
  >
    <div class="flex items-center gap-2">
      <USelect
        v-if="autoAllowed"
        v-model="mode"
        :items="SAVE_DC_FIELD_MODE_OPTIONS"
        value-key="value"
        size="sm"
        class="w-28"
        :portal="false"
      />

      <span
        v-if="mode === 'auto'"
        class="text-sm text-muted"
      >
        {{ autoText }}
      </span>

      <UInputNumber
        v-else
        v-model="manualDc"
        :min="1"
        size="sm"
        class="w-28"
      />
    </div>
  </UFormField>
</template>
