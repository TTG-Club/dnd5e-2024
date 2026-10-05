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
    createDefaultEscape,
    layoutAcceptsSourceSaveDc,
  } from '@vtt/shared/system/dnd.js';

  import {
    EFFECT_ESCAPE_SECTION_LABELS,
    EFFECT_SOURCE_DC_LABELS,
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

  const hasEscape = computed({
    get: () => effect.value.escape !== undefined,
    set: (enabled: boolean) => {
      effect.value = {
        ...effect.value,
        escape: enabled ? createDefaultEscape(autoDcAllowed.value) : undefined,
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
