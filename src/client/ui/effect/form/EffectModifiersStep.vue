<!--
  Шаг «Что меняет»: состояние, модификаторы, особые правила и иммунитеты к
  состояниям.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    ConditionRef,
    EffectChange,
    EffectFlagKey,
    EffectFormLayout,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    describeConditionName,
    describeEffectChangeCondition,
    EFFECT_CONDITION_SUGGESTIONS,
    listSelectableConditions,
  } from '@vtt/shared/system/dnd.js';

  import { EFFECT_MODIFIERS_STEP_LABELS } from '../constants';
  import EffectChangeRows from './EffectChangeRows.vue';
  import EffectFlagRows from './EffectFlagRows.vue';

  defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
    /** Показывать приоритет у всех модификаторов */
    showPriorityField: boolean;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  /** Название состояния, которым считается эффект */
  const conditionName = computed(() =>
    effect.value.conditionKey
      ? describeConditionName(effect.value.conditionKey)
      : '',
  );

  /** Значение выбора «Действует» без условия броска */
  const ROLL_CONDITION_ALWAYS = 'always';

  // Условие из записи, которого нет в словаре подсказок (составное), тоже
  // видно в списке — иначе поле выглядело бы пустым
  const rollConditionOptions = computed(() => {
    const current = effect.value.rollCondition;

    const known =
      current === undefined
      || EFFECT_CONDITION_SUGGESTIONS.some(
        (suggestion) => suggestion.value === current,
      );

    return [
      {
        value: ROLL_CONDITION_ALWAYS,
        label: EFFECT_MODIFIERS_STEP_LABELS.rollConditionAlways,
      },
      ...(known
        ? []
        : [{ value: current, label: describeEffectChangeCondition(current) }]),
      ...EFFECT_CONDITION_SUGGESTIONS,
    ];
  });

  const rollCondition = computed({
    get: () => effect.value.rollCondition ?? ROLL_CONDITION_ALWAYS,
    set: (value: string) => {
      effect.value = {
        ...effect.value,
        rollCondition: value === ROLL_CONDITION_ALWAYS ? undefined : value,
      };
    },
  });

  const changes = computed({
    get: () => effect.value.changes,
    set: (value: EffectChange[]) => {
      effect.value = { ...effect.value, changes: value };
    },
  });

  const flags = computed({
    get: () => effect.value.flags,
    set: (value: EffectFlagKey[]) => {
      effect.value = { ...effect.value, flags: value };
    },
  });

  // Список вычисляемый: кроме канона в него входят состояния, заведённые в
  // мире, — они появляются и исчезают, пока окно открыто
  const conditionImmunityOptions = computed(() =>
    listSelectableConditions().map((condition) => ({
      value: condition.key,
      label: condition.nameRu,
    })),
  );

  const conditionImmunities = computed({
    get: () => effect.value.conditionImmunities ?? [],
    set: (keys: ConditionRef[]) => {
      effect.value = {
        ...effect.value,
        conditionImmunities: keys.length > 0 ? keys : undefined,
      };
    },
  });

  /**
   * Перестаёт считать эффект состоянием: модификаторы и правила остаются, но
   * иммунитет к состоянию на нём больше не сработает.
   */
  function removeCondition(): void {
    effect.value = {
      ...effect.value,
      conditionKey: undefined,
      exhaustionLevel: undefined,
    };
  }
</script>

<template>
  <div
    v-if="conditionName"
    class="flex items-center gap-2"
  >
    <UBadge
      color="primary"
      variant="subtle"
      size="lg"
      icon="tabler:heart-broken"
    >
      {{ EFFECT_MODIFIERS_STEP_LABELS.conditionPrefix }}{{ conditionName }}
    </UBadge>

    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      icon="tabler:x"
      :label="EFFECT_MODIFIERS_STEP_LABELS.conditionRemove"
      :title="EFFECT_MODIFIERS_STEP_LABELS.conditionRemoveHint"
      @click.left.exact.prevent="removeCondition"
    />
  </div>

  <div class="flex flex-col gap-1.5">
    <UFormField :label="EFFECT_MODIFIERS_STEP_LABELS.rollConditionTitle">
      <USelectMenu
        v-model="rollCondition"
        :items="rollConditionOptions"
        value-key="value"
        label-key="label"
        class="w-full"
        :portal="false"
      />
    </UFormField>

    <p class="text-xs text-muted">
      {{ EFFECT_MODIFIERS_STEP_LABELS.rollConditionHint }}
    </p>
  </div>

  <EffectChangeRows
    v-model:changes="changes"
    :show-priority-field="showPriorityField"
  />

  <EffectFlagRows v-model:flags="flags" />

  <div
    v-if="layout.showConditionImmunities"
    class="flex flex-col gap-1.5"
  >
    <div>
      <span class="text-xs font-medium text-default">
        {{ EFFECT_MODIFIERS_STEP_LABELS.immunitiesTitle }}
      </span>

      <p class="text-xs text-muted">
        {{ EFFECT_MODIFIERS_STEP_LABELS.immunitiesHint }}
      </p>
    </div>

    <USelectMenu
      v-model="conditionImmunities"
      :items="conditionImmunityOptions"
      value-key="value"
      label-key="label"
      multiple
      class="w-full"
      :placeholder="EFFECT_MODIFIERS_STEP_LABELS.immunitiesPlaceholder"
      :portal="false"
    />
  </div>
</template>
