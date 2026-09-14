<!--
  Шаг «Спасбросок»: нужен ли спасбросок, какой и что даёт успех. Там, где
  спасброска быть не может, шаг объясняет, как его получить.
-->
<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type {
    ActiveEffect,
    EffectFormLayout,
    EffectSave,
    EffectSuccessOutcome,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    readEffectSuccessOutcome,
    writeEffectSaveEnabled,
    writeEffectSuccessOutcome,
  } from '@vtt/shared/system/dnd.js';

  import { FORM_FIELD_LABELS } from '../../actor/constants';
  import {
    EFFECT_ACTION_SAVE_SUCCESS_TITLES,
    EFFECT_SAVE_STEP_LABELS,
    EFFECT_SAVE_UNAVAILABLE_HINTS,
    EFFECT_SOURCE_DC_HINTS,
  } from '../constants';
  import { buildSuccessOutcomeOptions } from '../effectFormOptions';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  /** Заголовок выбора «при успехе» спасброска заклинания или действия */
  const actionSaveSuccessTitle = computed(
    () => EFFECT_ACTION_SAVE_SUCCESS_TITLES[props.layout.context],
  );

  /**
   * Эффект на цели заклинания или действия: у них свой спасбросок, и
   * спасбросок эффекта — дополнительный.
   */
  const isActionTarget = computed(
    () =>
      props.layout.delivery === 'target'
      && actionSaveSuccessTitle.value !== undefined,
  );

  const toggleLabel = computed(() => {
    if (isActionTarget.value) {
      return EFFECT_SAVE_STEP_LABELS.ownToggle;
    }

    // У зоны и ауры бросает не цель атаки, а вошедший или вышедший
    return props.layout.showTrigger
      ? EFFECT_SAVE_STEP_LABELS.areaToggle
      : EFFECT_SAVE_STEP_LABELS.toggle;
  });

  const toggleHint = computed(() =>
    isActionTarget.value
      ? EFFECT_SAVE_STEP_LABELS.ownToggleHint
      : EFFECT_SAVE_STEP_LABELS.toggleHint,
  );

  /** Подсказка «0 — Сл источника» там, где Сл 0 допустима */
  const dcHint = computed(() =>
    props.layout.minSaveDc === 0
      ? EFFECT_SOURCE_DC_HINTS[props.layout.context]
      : undefined,
  );

  const successTitle = computed(() =>
    props.layout.successOutcomeForActionSave
      ? (actionSaveSuccessTitle.value ?? EFFECT_SAVE_STEP_LABELS.successTitle)
      : EFFECT_SAVE_STEP_LABELS.successTitle,
  );

  const successOptions = computed(() =>
    buildSuccessOutcomeOptions(props.layout),
  );

  /** Выбирать есть из чего: единственный вариант «ничего» не показывается */
  const showSuccessChoice = computed(() => successOptions.value.length > 1);

  const hasSave = computed({
    get: () => effect.value.applySave !== undefined,
    set: (enabled: boolean) => {
      effect.value = writeEffectSaveEnabled(
        effect.value,
        enabled,
        props.layout,
      );
    },
  });

  /**
   * Меняет поле спасброска.
   *
   * @param patch - изменённые поля
   */
  function updateSave(patch: Partial<EffectSave>): void {
    const { applySave } = effect.value;

    if (applySave) {
      effect.value = {
        ...effect.value,
        applySave: { ...applySave, ...patch },
      };
    }
  }

  const saveAbility = computed({
    get: () => effect.value.applySave?.ability ?? 'wisdom',
    set: (ability: AbilityType) => updateSave({ ability }),
  });

  const saveDc = computed({
    get: () => effect.value.applySave?.dc ?? props.layout.minSaveDc,
    set: (dc: number | null) => {
      if (dc !== null) {
        updateSave({ dc });
      }
    },
  });

  const successOutcome = computed({
    get: () => readEffectSuccessOutcome(effect.value),
    set: (outcome: EffectSuccessOutcome) => {
      effect.value = writeEffectSuccessOutcome(effect.value, outcome);
    },
  });
</script>

<template>
  <template v-if="layout.showSave">
    <USwitch
      v-model="hasSave"
      :label="toggleLabel"
      :description="toggleHint"
    />

    <div
      v-if="effect.applySave"
      class="flex flex-wrap items-end gap-3"
    >
      <UFormField
        :label="FORM_FIELD_LABELS.ability"
        class="w-48"
      >
        <USelect
          v-model="saveAbility"
          :items="ABILITY_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <UFormField
        :label="FORM_FIELD_LABELS.saveDc"
        :hint="dcHint"
        class="w-56"
      >
        <UInputNumber
          v-model="saveDc"
          :min="layout.minSaveDc"
          size="sm"
          class="w-32"
        />
      </UFormField>
    </div>
  </template>

  <p
    v-else-if="layout.saveUnavailableReason"
    class="text-xs text-muted"
  >
    {{ EFFECT_SAVE_UNAVAILABLE_HINTS[layout.saveUnavailableReason] }}
  </p>

  <div
    v-if="showSuccessChoice"
    class="flex flex-col gap-1.5"
  >
    <span class="text-xs font-medium text-muted">
      {{ successTitle }}
    </span>

    <URadioGroup
      v-model="successOutcome"
      :items="successOptions"
      value-key="value"
      variant="card"
      size="sm"
      :ui="{ fieldset: 'grid grid-cols-1 gap-2 sm:grid-cols-2' }"
    />
  </div>
</template>
