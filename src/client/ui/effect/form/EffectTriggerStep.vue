<!--
  Шаг «Когда срабатывает»: постоянно ли действует эффект или его применяют,
  на кого ложится эффект (носитель, цель, аура), момент срабатывания зоны или
  ауры и настройки ауры.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    DndEffectAura,
    EffectActivation,
    EffectFormLayout,
    EffectVariantPick,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    DEFAULT_ACTIVATION_AMOUNT,
    DEFAULT_EFFECT_VARIANT_PICK,
    writeEffectDelivery,
    writeEffectTrigger,
  } from '@vtt/shared/system/dnd.js';

  import FieldHint from '../../actor/FieldHint.vue';
  import {
    EFFECT_ACTIVATION_CHOICE_HINTS,
    EFFECT_ACTIVATION_COUNTER_LABELS,
    EFFECT_AURA_LABELS,
    EFFECT_AURA_RADIUS_STEP,
    EFFECT_LANDING_CONDITION_LABELS,
    EFFECT_NO_KNOWN_TAGS,
    EFFECT_PERMANENT_ACTIVATION,
    EFFECT_TRIGGER_HINTS,
    EFFECT_VARIANT_LABELS,
  } from '../constants';
  import {
    buildActivationOptions,
    buildDeliveryOptions,
    buildTriggerOptions,
    describeDeliveryHint,
    EFFECT_AURA_TARGET_OPTIONS,
    EFFECT_VARIANT_PICK_OPTIONS,
    findTrigger,
  } from '../effectFormOptions';
  import EffectTriggerConditionPicker from './EffectTriggerConditionPicker.vue';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const activationOptions = computed(() =>
    buildActivationOptions(props.layout),
  );

  const activationChoice = computed(
    () => effect.value.activation?.mode ?? EFFECT_PERMANENT_ACTIVATION,
  );

  /**
   * Меняет способ действия эффекта: «Постоянно» убирает применение, способ
   * применения сохраняет уже заданный ресурс.
   *
   * @param value - значение переключателя
   */
  function selectActivation(value: string | number): void {
    if (value === EFFECT_PERMANENT_ACTIVATION) {
      effect.value = { ...effect.value, activation: undefined };

      return;
    }

    const mode = props.layout.activationModes.find(
      (option) => option === value,
    );

    if (mode) {
      effect.value = {
        ...effect.value,
        activation: { ...effect.value.activation, mode },
      };
    }
  }

  /**
   * Меняет ресурс применения.
   *
   * @param patch - изменённые поля
   */
  function updateActivation(patch: Partial<EffectActivation>): void {
    const { activation } = effect.value;

    if (activation) {
      effect.value = {
        ...effect.value,
        activation: { ...activation, ...patch },
      };
    }
  }

  const activationCounter = computed({
    get: () => effect.value.activation?.counter ?? '',
    set: (counter: string) => updateActivation({ counter }),
  });

  const activationAmount = computed({
    get: () => effect.value.activation?.amount ?? DEFAULT_ACTIVATION_AMOUNT,
    set: (amount: number | null) => {
      if (amount !== null) {
        updateActivation({ amount });
      }
    },
  });

  const deliveryOptions = computed(() => buildDeliveryOptions(props.layout));

  const triggerOptions = computed(() =>
    buildTriggerOptions(props.layout.delivery),
  );

  /** Выбор доставки нужен, только если вариантов больше одного */
  const showDeliveryChoice = computed(() => deliveryOptions.value.length > 1);

  /** Пояснение под выбором доставки: у зоны заклинания и применения своё */
  const deliveryHint = computed(() => describeDeliveryHint(props.layout));

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
  function updateAura(patch: Partial<DndEffectAura>): void {
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
    set: (target: DndEffectAura['target']) => updateAura({ target }),
  });

  const auraRadiusFormula = computed({
    get: () => effect.value.aura?.radiusFormula ?? '',
    set: (radiusFormula: string) =>
      updateAura({ radiusFormula: radiusFormula || undefined }),
  });

  const auraWhileCapable = computed({
    get: () => effect.value.aura?.whileCapable === true,
    set: (whileCapable: boolean | 'indeterminate') =>
      updateAura({ whileCapable: whileCapable === true || undefined }),
  });

  const auraApplyToSelf = computed({
    get: () => effect.value.aura?.applyToSelf ?? false,
    set: (applyToSelf: boolean | 'indeterminate') =>
      updateAura({ applyToSelf: applyToSelf === true }),
  });

  const landingCondition = computed({
    get: () => effect.value.landingCondition,
    set: (next: string | undefined) => {
      effect.value = { ...effect.value, landingCondition: next };
    },
  });

  const hasVariant = computed({
    get: () => effect.value.variant !== undefined,
    set: (enabled: boolean) => {
      effect.value = {
        ...effect.value,
        variant: enabled
          ? {
              group: EFFECT_VARIANT_LABELS.defaultGroup,
              label: effect.value.name,
            }
          : undefined,
      };
    },
  });

  /**
   * Меняет поле варианта. Пустое поле не пишется: вариант без группы или
   * подписи разбор записи выбросил бы.
   *
   * @param patch - изменённые поля
   * @param patch.group - ключ группы
   * @param patch.label - подпись варианта
   */
  function updateVariant(patch: {
    group?: string | number;
    label?: string | number;
  }): void {
    const { variant } = effect.value;
    const group = String(patch.group ?? variant?.group ?? '').trim();
    const label = String(patch.label ?? variant?.label ?? '').trim();

    if (variant && group && label) {
      effect.value = { ...effect.value, variant: { ...variant, group, label } };
    }
  }

  // Выбор бросающим — значение по умолчанию: в данных оно не пишется
  const variantPick = computed({
    get: () => effect.value.variant?.pick ?? DEFAULT_EFFECT_VARIANT_PICK,
    set: (pick: EffectVariantPick) => {
      const { variant } = effect.value;

      if (!variant) {
        return;
      }

      const { pick: _pick, ...rest } = variant;

      effect.value = {
        ...effect.value,
        variant:
          pick === DEFAULT_EFFECT_VARIANT_PICK ? rest : { ...rest, pick },
      };
    },
  });

  const auraVisible = computed({
    get: () => effect.value.aura?.visible ?? false,
    set: (visible: boolean | 'indeterminate') =>
      updateAura({ visible: visible === true }),
  });
</script>

<template>
  <div
    v-if="activationOptions.length > 0"
    class="flex flex-col gap-1.5"
  >
    <UTabs
      :model-value="activationChoice"
      :items="activationOptions"
      :content="false"
      size="xs"
      color="primary"
      class="w-fit"
      @update:model-value="selectActivation"
    />

    <p class="text-xs text-muted">
      {{ EFFECT_ACTIVATION_CHOICE_HINTS[activationChoice] }}
    </p>

    <div
      v-if="layout.showActivationCounter"
      class="flex flex-wrap items-end gap-2"
    >
      <!-- Подсказка под значком: строкой под полем она выталкивала поле
        вверх, и оно не стояло в ряд с «Сколько» -->
      <UFormField class="w-72">
        <template #label>
          <span class="flex items-center gap-1">
            {{ EFFECT_ACTIVATION_COUNTER_LABELS.counter }}

            <FieldHint :text="EFFECT_ACTIVATION_COUNTER_LABELS.hint" />
          </span>
        </template>

        <UInput
          v-model="activationCounter"
          :placeholder="EFFECT_ACTIVATION_COUNTER_LABELS.counterPlaceholder"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UFormField
        v-if="activationCounter"
        :label="EFFECT_ACTIVATION_COUNTER_LABELS.amount"
        class="w-24"
      >
        <UInputNumber
          v-model="activationAmount"
          :min="DEFAULT_ACTIVATION_AMOUNT"
          size="sm"
          class="w-full"
        />
      </UFormField>
    </div>
  </div>

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

    <UFormField class="w-72">
      <template #label>
        <span class="flex items-center gap-1">
          {{ EFFECT_AURA_LABELS.radiusFormula }}

          <FieldHint :text="EFFECT_AURA_LABELS.radiusFormulaHint" />
        </span>
      </template>

      <UInput
        v-model="auraRadiusFormula"
        :placeholder="EFFECT_AURA_LABELS.radiusFormulaPlaceholder"
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

      <UCheckbox
        v-model="auraWhileCapable"
        :label="EFFECT_AURA_LABELS.whileCapable"
      />
    </div>
  </div>

  <div
    v-if="layout.showLandingCondition"
    class="flex flex-col gap-1"
  >
    <EffectTriggerConditionPicker
      v-model:condition="landingCondition"
      event="applied"
      :known-tags="EFFECT_NO_KNOWN_TAGS"
      :title="EFFECT_LANDING_CONDITION_LABELS.title"
      :empty-text="EFFECT_LANDING_CONDITION_LABELS.always"
    />

    <p class="text-xs text-muted">
      {{ EFFECT_LANDING_CONDITION_LABELS.hint }}
    </p>
  </div>

  <div
    v-if="layout.showVariant"
    class="flex flex-col gap-2"
  >
    <USwitch
      v-model="hasVariant"
      :label="EFFECT_VARIANT_LABELS.toggle"
      :description="EFFECT_VARIANT_LABELS.toggleHint"
    />

    <div
      v-if="effect.variant"
      class="flex flex-wrap items-end gap-2"
    >
      <UFormField
        :label="EFFECT_VARIANT_LABELS.group"
        class="w-40"
      >
        <UInput
          :model-value="effect.variant.group"
          size="sm"
          class="w-full"
          @update:model-value="updateVariant({ group: $event })"
        />
      </UFormField>

      <UFormField
        :label="EFFECT_VARIANT_LABELS.label"
        class="w-56"
      >
        <UInput
          :model-value="effect.variant.label"
          size="sm"
          class="w-full"
          @update:model-value="updateVariant({ label: $event })"
        />
      </UFormField>

      <UFormField
        :label="EFFECT_VARIANT_LABELS.pick"
        class="w-48"
      >
        <USelect
          v-model="variantPick"
          :items="EFFECT_VARIANT_PICK_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>
    </div>
  </div>
</template>
