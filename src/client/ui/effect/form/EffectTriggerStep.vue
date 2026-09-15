<!--
  Шаг «Когда срабатывает»: на кого ложится эффект (носитель, цель, аура),
  момент срабатывания зоны или ауры и настройки ауры.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    EffectAura,
    EffectFormLayout,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    writeEffectDelivery,
    writeEffectTrigger,
  } from '@vtt/shared/system/dnd.js';

  import {
    EFFECT_AURA_LABELS,
    EFFECT_AURA_RADIUS_STEP,
    EFFECT_DELIVERY_HINTS,
    EFFECT_SPELL_ZONE_DELIVERY_HINT,
    EFFECT_TRIGGER_HINTS,
  } from '../constants';
  import {
    buildDeliveryOptions,
    buildTriggerOptions,
    EFFECT_AURA_TARGET_OPTIONS,
    findTrigger,
  } from '../effectFormOptions';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const deliveryOptions = computed(() => buildDeliveryOptions(props.layout));

  const triggerOptions = computed(() =>
    buildTriggerOptions(props.layout.delivery),
  );

  /** Выбор доставки нужен, только если вариантов больше одного */
  const showDeliveryChoice = computed(() => deliveryOptions.value.length > 1);

  /** Пояснение под выбором доставки: у зоны заклинания своё */
  const deliveryHint = computed(() =>
    props.layout.delivery === 'zone' && props.layout.context === 'spell'
      ? EFFECT_SPELL_ZONE_DELIVERY_HINT
      : EFFECT_DELIVERY_HINTS[props.layout.delivery],
  );

  /**
   * Меняет доставку эффекта.
   *
   * @param value - значение переключателя
   */
  function selectDelivery(value: string | number): void {
    const delivery = props.layout.deliveryOptions.find(
      (option) => option === value,
    );

    if (delivery) {
      effect.value = writeEffectDelivery(effect.value, delivery);
    }
  }

  /**
   * Меняет момент срабатывания зоны или ауры.
   *
   * @param value - значение переключателя
   */
  function selectTrigger(value: string | number): void {
    const trigger = findTrigger(value);

    if (trigger) {
      effect.value = writeEffectTrigger(effect.value, trigger);
    }
  }

  /**
   * Меняет поле ауры.
   *
   * @param patch - изменённые поля
   */
  function updateAura(patch: Partial<EffectAura>): void {
    const { aura } = effect.value;

    if (aura) {
      effect.value = { ...effect.value, aura: { ...aura, ...patch } };
    }
  }

  const auraRadius = computed({
    get: () => effect.value.aura?.radius ?? 0,
    set: (radius: number | null) => {
      if (radius !== null) {
        updateAura({ radius });
      }
    },
  });

  const auraTarget = computed({
    get: () => effect.value.aura?.target ?? 'allies',
    set: (target: EffectAura['target']) => updateAura({ target }),
  });

  const auraApplyToSelf = computed({
    get: () => effect.value.aura?.applyToSelf ?? false,
    set: (applyToSelf: boolean | 'indeterminate') =>
      updateAura({ applyToSelf: applyToSelf === true }),
  });

  const auraVisible = computed({
    get: () => effect.value.aura?.visible ?? false,
    set: (visible: boolean | 'indeterminate') =>
      updateAura({ visible: visible === true }),
  });
</script>

<template>
  <div
    v-if="showDeliveryChoice"
    class="flex flex-col gap-1.5"
  >
    <UTabs
      :model-value="layout.delivery"
      :items="deliveryOptions"
      :content="false"
      size="xs"
      color="primary"
      class="w-fit"
      @update:model-value="selectDelivery"
    />

    <p class="text-xs text-muted">
      {{ deliveryHint }}
    </p>
  </div>

  <div
    v-if="layout.showTrigger"
    class="flex flex-col gap-1.5"
  >
    <UTabs
      :model-value="layout.trigger"
      :items="triggerOptions"
      :content="false"
      size="xs"
      color="primary"
      class="w-fit"
      @update:model-value="selectTrigger"
    />

    <p class="text-xs text-muted">
      {{ EFFECT_TRIGGER_HINTS[layout.trigger] }}
    </p>
  </div>

  <div
    v-if="layout.showAuraSettings && effect.aura"
    class="flex flex-wrap items-end gap-3 rounded-md border border-magic-border/50 bg-magic-subtle/20 px-3 py-2"
  >
    <UFormField
      :label="EFFECT_AURA_LABELS.radius"
      class="w-32"
    >
      <UInputNumber
        v-model="auraRadius"
        :min="0"
        :step="EFFECT_AURA_RADIUS_STEP"
        size="sm"
        class="w-full"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_AURA_LABELS.target"
      class="w-48"
    >
      <USelect
        v-model="auraTarget"
        :items="EFFECT_AURA_TARGET_OPTIONS"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>

    <div class="flex h-8 items-center gap-4">
      <UCheckbox
        v-model="auraApplyToSelf"
        :label="EFFECT_AURA_LABELS.applyToSelf"
      />

      <UCheckbox
        v-model="auraVisible"
        :label="EFFECT_AURA_LABELS.visible"
      />
    </div>
  </div>
</template>
