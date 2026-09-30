<!--
  Раздел «Провал в успех»: носитель, проваливший спасбросок, может потратить
  единицу и преуспеть («Легендарное сопротивление», черты и предметы игроков).
  Платит своим счётчиком «N раз до отдыха» либо ресурсом листа.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    EffectSaveOverride,
    SaveOverridePeriod,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { MAX_SAVE_OVERRIDE_USES } from '@vtt/shared/system/dnd.js';

  import FieldHint from '../../actor/FieldHint.vue';
  import {
    DEFAULT_SAVE_OVERRIDE,
    EFFECT_SAVE_OVERRIDE_LABELS,
  } from '../constants';
  import { SAVE_OVERRIDE_PERIOD_OPTIONS } from '../effectFormOptions';

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  /**
   * Записывает блок; пустой (ни счётчика, ни ресурса) не пишется вовсе.
   *
   * @param next - новый блок
   */
  function writeOverride(next: EffectSaveOverride | undefined): void {
    effect.value = {
      ...effect.value,
      saveOverride: next && (next.limit || next.counter) ? next : undefined,
    };
  }

  const enabled = computed({
    get: () => effect.value.saveOverride !== undefined,
    set: (on: boolean) => {
      writeOverride(on ? DEFAULT_SAVE_OVERRIDE : undefined);
    },
  });

  const limit = computed(
    () => effect.value.saveOverride?.limit ?? DEFAULT_SAVE_OVERRIDE.limit,
  );

  const times = computed({
    get: () => limit.value?.max ?? 1,
    set: (max: number | null) => {
      if (max !== null && limit.value) {
        writeOverride({
          ...effect.value.saveOverride,
          limit: { ...limit.value, max },
        });
      }
    },
  });

  const period = computed({
    get: () => limit.value?.per ?? 'longRest',
    set: (per: SaveOverridePeriod) => {
      writeOverride({
        ...effect.value.saveOverride,
        limit: { max: times.value, per },
      });
    },
  });

  const counter = computed({
    get: () => effect.value.saveOverride?.counter ?? '',
    set: (value: string | number) => {
      const key = String(value).trim();

      writeOverride({
        ...effect.value.saveOverride,
        counter: key || undefined,
      });
    },
  });
</script>

<template>
  <div class="flex flex-col gap-2">
    <USwitch
      v-model="enabled"
      :label="EFFECT_SAVE_OVERRIDE_LABELS.toggle"
      :description="EFFECT_SAVE_OVERRIDE_LABELS.toggleHint"
    />

    <div
      v-if="enabled"
      class="flex flex-wrap items-end gap-2"
    >
      <UFormField
        :label="EFFECT_SAVE_OVERRIDE_LABELS.times"
        class="w-24"
      >
        <UInputNumber
          v-model="times"
          :min="1"
          :max="MAX_SAVE_OVERRIDE_USES"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="EFFECT_SAVE_OVERRIDE_LABELS.per"
        class="w-56"
      >
        <USelect
          v-model="period"
          :items="SAVE_OVERRIDE_PERIOD_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <UFormField class="w-64">
        <template #label>
          <span class="flex items-center gap-1">
            {{ EFFECT_SAVE_OVERRIDE_LABELS.counter }}

            <FieldHint :text="EFFECT_SAVE_OVERRIDE_LABELS.counterHint" />
          </span>
        </template>

        <UInput
          v-model="counter"
          :placeholder="EFFECT_SAVE_OVERRIDE_LABELS.counterPlaceholder"
          size="sm"
          class="w-full"
        />
      </UFormField>
    </div>
  </div>
</template>
