<!--
  Цена действия: чем человек платит за срабатывание или за «вырваться». У цены
  «Перемещение» есть число футов. Ходом распоряжается человек — цена здесь
  пометка, а не списание.
-->
<script setup lang="ts">
  import type {
    EffectActionCost,
    EffectEscape,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    actionCostTakesFeet,
    DEFAULT_EFFECT_ACTION_COST,
    DEFAULT_EFFECT_MOVE_COST_FEET,
  } from '@vtt/shared/system/dnd.js';

  import {
    EFFECT_ACTION_COST_FIELD_LABELS,
    EFFECT_MOVE_COST_FEET_STEP,
  } from '../constants';
  import { EFFECT_ACTION_COST_OPTIONS } from '../effectFormOptions';

  withDefaults(
    defineProps<{
      /** Пояснение под выбором цены */
      help?: string;
      /** Ширина поля цены — под соседние поля строки */
      costWidthClass?: string;
    }>(),
    { help: undefined, costWidthClass: 'w-48' },
  );

  /** Цена и футы перемещения — те же поля у срабатывания и у «вырваться» */
  const model = defineModel<Pick<EffectEscape, 'cost' | 'moveCostFeet'>>({
    required: true,
  });

  const cost = computed({
    get: () => model.value.cost ?? DEFAULT_EFFECT_ACTION_COST,
    set: (next: EffectActionCost) => {
      model.value = {
        cost: next === DEFAULT_EFFECT_ACTION_COST ? undefined : next,
        // Футы перемещения нужны только цене «Перемещение»
        moveCostFeet: actionCostTakesFeet(next)
          ? (model.value.moveCostFeet ?? DEFAULT_EFFECT_MOVE_COST_FEET)
          : undefined,
      };
    },
  });

  const moveCostFeet = computed({
    get: () => model.value.moveCostFeet ?? DEFAULT_EFFECT_MOVE_COST_FEET,
    set: (feet: number | null) => {
      model.value = {
        ...model.value,
        moveCostFeet: feet ?? DEFAULT_EFFECT_MOVE_COST_FEET,
      };
    },
  });

  const showsFeet = computed(() => actionCostTakesFeet(model.value.cost));
</script>

<template>
  <UFormField
    :label="EFFECT_ACTION_COST_FIELD_LABELS.cost"
    :help="help"
    :class="costWidthClass"
  >
    <USelect
      v-model="cost"
      :items="EFFECT_ACTION_COST_OPTIONS"
      value-key="value"
      size="sm"
      class="w-full"
      :portal="false"
    />
  </UFormField>

  <UFormField
    v-if="showsFeet"
    :label="EFFECT_ACTION_COST_FIELD_LABELS.moveCost"
    class="w-28"
  >
    <UInputNumber
      v-model="moveCostFeet"
      :min="0"
      :step="EFFECT_MOVE_COST_FEET_STEP"
      size="sm"
      class="w-full"
    />
  </UFormField>
</template>
