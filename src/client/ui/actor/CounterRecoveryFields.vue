<script setup lang="ts">
  import type {
    CounterRecoveryMode,
    CounterRecoveryRule,
  } from '@vtt/shared/system/dnd.js';

  import {
    COUNTER_COUNT_MAX,
    COUNTER_RECOVERY_AMOUNT_MIN,
  } from '@vtt/shared/system/dnd.js';

  import { COUNTER_RESOURCE_LABELS, COUNTER_REST_FIELDS } from './constants';

  /**
   * Что возвращает ресурсу отдых — по правилу на каждый его вид.
   *
   * Двумя правилами, а не одним словом: короткий отдых возвращает ресурсу своё,
   * продолжительный своё, и «одна ярость за короткий, все за продолжительный»
   * одним полем не описывается.
   */
  const shortRest = defineModel<CounterRecoveryRule>('shortRest', {
    required: true,
  });

  const longRest = defineModel<CounterRecoveryRule>('longRest', {
    required: true,
  });

  const modeOptions: { value: CounterRecoveryMode; label: string }[] = [
    { value: 'none', label: COUNTER_RESOURCE_LABELS.modeNone },
    { value: 'all', label: COUNTER_RESOURCE_LABELS.modeAll },
    { value: 'amount', label: COUNTER_RESOURCE_LABELS.modeAmount },
  ];

  /** Плитки отдыха в порядке показа: сначала короткий, затем продолжительный. */
  const restFields = [
    { key: 'shortRest', ...COUNTER_REST_FIELDS.shortRest, model: shortRest },
    { key: 'longRest', ...COUNTER_REST_FIELDS.longRest, model: longRest },
  ];

  /** Плитка отдыха вместе со своей моделью правила. */
  type RestField = (typeof restFields)[number];

  /**
   * Меняет режим восстановления, сохраняя число зарядов: вернувшись к «своему
   * числу», игрок увидит то, что вводил, а не единицу.
   *
   * @param field - плитка отдыха
   * @param mode - выбранный режим
   */
  function setMode(field: RestField, mode: CounterRecoveryMode): void {
    field.model.value = { ...field.model.value, mode };
  }

  /**
   * Меняет число возвращаемых зарядов.
   *
   * @param field - плитка отдыха
   * @param amount - число зарядов
   */
  function setAmount(field: RestField, amount: number | undefined): void {
    field.model.value = {
      ...field.model.value,
      amount: amount ?? COUNTER_RECOVERY_AMOUNT_MIN,
    };
  }
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-[10px] font-bold tracking-wider text-toned/80 uppercase">
      {{ COUNTER_RESOURCE_LABELS.recovery }}
    </span>

    <div class="grid gap-2 sm:grid-cols-2">
      <div
        v-for="field in restFields"
        :key="field.key"
        class="flex flex-col gap-1.5 rounded-md bg-elevated/40 p-2"
      >
        <span
          class="flex items-center gap-1 text-[10px] font-bold text-muted uppercase"
        >
          <UIcon
            :name="field.icon"
            class="size-3.5 shrink-0"
          />

          {{ field.label }}
        </span>

        <USelect
          :model-value="field.model.value.mode"
          :items="modeOptions"
          :aria-label="`${COUNTER_RESOURCE_LABELS.recovery}: ${field.label}`"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
          @update:model-value="setMode(field, $event)"
        />

        <UInputNumber
          v-if="field.model.value.mode === 'amount'"
          :model-value="field.model.value.amount"
          :min="COUNTER_RECOVERY_AMOUNT_MIN"
          :max="COUNTER_COUNT_MAX"
          :aria-label="`${COUNTER_RESOURCE_LABELS.chargesAria}: ${field.label}`"
          size="sm"
          class="w-full"
          @update:model-value="setAmount(field, $event)"
        />
      </div>
    </div>
  </div>
</template>
