<!--
  Раздел «Действие, снимающее эффект»: «существо может действием совершить
  проверку Силы (Атлетика) Сл 14 и освободиться». На листе у такого эффекта
  появляется кнопка.

  Сл «Авто» — Сл источника: её проставляют при наложении. У эффекта без
  источника она остаётся нулевой, и кнопка честно отказывается действовать —
  проверка против нуля прошла бы у кого угодно.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    EffectEscape,
    EffectFormLayout,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    DEFAULT_EFFECT_SAVE_DC,
    layoutAcceptsSourceSaveDc,
    SOURCE_SAVE_DC,
  } from '@vtt/shared/system/dnd.js';

  import {
    EFFECT_ESCAPE_SECTION_LABELS,
    EFFECT_SOURCE_DC_LABELS,
    NEW_ESCAPE_CHECK_SKILL,
    NEW_ESCAPE_COST,
  } from '../constants';
  import EffectEscapeFields from './EffectEscapeFields.vue';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
    /** Сл источника для «Авто», если окно её знает */
    sourceSaveDc?: number;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  /** «Авто» доступно там, где Сл источника вообще бывает */
  const autoDcAllowed = computed(() => layoutAcceptsSourceSaveDc(props.layout));

  /**
   * Новый блок действия: действием и с проверкой Атлетики против Сл источника
   * (где он есть) или своей.
   *
   * @returns блок действия
   */
  function createEscape(): EffectEscape {
    return {
      cost: NEW_ESCAPE_COST,
      check: {
        skill: NEW_ESCAPE_CHECK_SKILL,
        dc: autoDcAllowed.value ? SOURCE_SAVE_DC : DEFAULT_EFFECT_SAVE_DC,
      },
    };
  }

  const hasEscape = computed({
    get: () => effect.value.escape !== undefined,
    set: (enabled: boolean) => {
      effect.value = {
        ...effect.value,
        escape: enabled ? createEscape() : undefined,
      };
    },
  });

  /**
   * Записывает блок действия.
   *
   * @param escape - блок действия
   */
  function updateEscape(escape: EffectEscape): void {
    effect.value = { ...effect.value, escape };
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <USwitch
      v-model="hasEscape"
      :label="EFFECT_ESCAPE_SECTION_LABELS.toggle"
      :description="EFFECT_ESCAPE_SECTION_LABELS.hint"
    />

    <EffectEscapeFields
      v-if="effect.escape"
      :model-value="effect.escape"
      :auto-dc-allowed="autoDcAllowed"
      :auto-label="EFFECT_SOURCE_DC_LABELS[layout.context]"
      :source-save-dc="sourceSaveDc"
      @update:model-value="updateEscape"
    />
  </div>
</template>
