<!--
  Раздел «Свет»: пока эффект действует, носитель излучает свет — яркий и
  тусклый «ещё на». Итог носителя (сильнейший свет) считает движок
  (`entityLight.ts`).
-->
<script setup lang="ts">
  import type { WritableComputedRef } from 'vue';

  import type {
    ActiveEffect,
    EffectLight,
    EffectLightAnimation,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    DEFAULT_EFFECT_LIGHT_COLOR,
    MAX_EFFECT_LIGHT_FEET,
  } from '@vtt/shared/system/dnd.js';

  import FieldHint from '../../actor/FieldHint.vue';
  import { DEFAULT_EFFECT_LIGHT, EFFECT_LIGHT_LABELS } from '../constants';
  import { EFFECT_LIGHT_ANIMATION_OPTIONS } from '../effectFormOptions';

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  /**
   * Правит свет эффекта.
   *
   * @param patch - что меняется
   */
  function updateLight(patch: Partial<EffectLight>): void {
    const { light } = effect.value;

    if (light) {
      effect.value = { ...effect.value, light: { ...light, ...patch } };
    }
  }

  const enabled = computed({
    get: () => effect.value.light !== undefined,
    set: (on: boolean) => {
      effect.value = {
        ...effect.value,
        light: on ? { ...DEFAULT_EFFECT_LIGHT } : undefined,
      };
    },
  });

  /**
   * Модель радиуса: пустое поле — ноль.
   *
   * @param field - яркий или тусклый
   * @returns модель поля
   */
  function radiusModel(
    field: 'bright' | 'dim',
  ): WritableComputedRef<number, number | null> {
    return computed({
      get: () => effect.value.light?.[field] ?? 0,
      set: (feet: number | null) => updateLight({ [field]: feet ?? 0 }),
    });
  }

  const bright = radiusModel('bright');
  const dim = radiusModel('dim');

  const color = computed({
    get: () => effect.value.light?.color ?? DEFAULT_EFFECT_LIGHT_COLOR,
    set: (value: string | undefined) =>
      updateLight({
        color:
          value && value !== DEFAULT_EFFECT_LIGHT_COLOR ? value : undefined,
      }),
  });

  const animation = computed({
    get: () => effect.value.light?.animation ?? 'none',
    set: (value: EffectLightAnimation) =>
      updateLight({ animation: value === 'none' ? undefined : value }),
  });

  const swatchStyle = computed(() => ({ backgroundColor: color.value }));
</script>

<template>
  <div class="flex flex-col gap-2">
    <USwitch
      v-model="enabled"
      :label="EFFECT_LIGHT_LABELS.toggle"
      :description="EFFECT_LIGHT_LABELS.toggleHint"
    />

    <div
      v-if="enabled"
      class="flex flex-wrap items-end gap-2"
    >
      <UFormField
        :label="EFFECT_LIGHT_LABELS.bright"
        class="w-28"
      >
        <UInputNumber
          v-model="bright"
          :min="0"
          :max="MAX_EFFECT_LIGHT_FEET"
          :step="5"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UFormField class="w-32">
        <template #label>
          <span class="flex items-center gap-1">
            {{ EFFECT_LIGHT_LABELS.dim }}

            <FieldHint :text="EFFECT_LIGHT_LABELS.dimHint" />
          </span>
        </template>

        <UInputNumber
          v-model="dim"
          :min="0"
          :max="MAX_EFFECT_LIGHT_FEET"
          :step="5"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="EFFECT_LIGHT_LABELS.color">
        <UPopover :portal="false">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            :label="color"
          >
            <template #leading>
              <span
                class="size-4 rounded-sm border border-default"
                :style="swatchStyle"
              />
            </template>
          </UButton>

          <template #content>
            <UColorPicker
              v-model="color"
              size="sm"
              class="p-2"
            />
          </template>
        </UPopover>
      </UFormField>

      <UFormField
        :label="EFFECT_LIGHT_LABELS.animation"
        class="w-40"
      >
        <USelect
          v-model="animation"
          :items="EFFECT_LIGHT_ANIMATION_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>
    </div>

    <p
      v-if="enabled"
      class="text-xs text-muted"
    >
      {{ EFFECT_LIGHT_LABELS.sceneHint }}
    </p>
  </div>
</template>
