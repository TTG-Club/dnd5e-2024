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
    DEFAULT_EFFECT_SAVE_ABILITY,
    isSkillType,
    layoutAcceptsSourceSaveDc,
    readEffectSuccessOutcome,
    writeEffectSaveEnabled,
    writeEffectSuccessOutcome,
  } from '@vtt/shared/system/dnd.js';

  import { FORM_FIELD_LABELS } from '../../actor/constants';
  import FieldHint from '../../actor/FieldHint.vue';
  import {
    EFFECT_ACTION_SAVE_SUCCESS_TITLES,
    EFFECT_SAVE_STEP_LABELS,
    EFFECT_SAVE_UNAVAILABLE_HINTS,
    EFFECT_SOURCE_DC_LABELS,
  } from '../constants';
  import {
    buildSuccessOutcomeOptions,
    EFFECT_ESCAPE_SKILL_OPTIONS,
  } from '../effectFormOptions';
  import SaveDcField from './SaveDcField.vue';

  /** Значение «обычная Сл» в выборе навыка для Сл от проверки */
  const NO_DC_SKILL = 'none';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
    /** Сл источника для «Авто», если окно её знает */
    sourceSaveDc?: number;
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

  const acceptsSourceSaveDc = computed(() =>
    layoutAcceptsSourceSaveDc(props.layout),
  );

  const saveAbility = computed({
    get: () => effect.value.applySave?.ability ?? DEFAULT_EFFECT_SAVE_ABILITY,
    set: (ability: AbilityType) => updateSave({ ability }),
  });

  // Ещё характеристики на выбор цели: «спасбросок Силы или Ловкости»
  const saveAltAbilities = computed({
    get: () => effect.value.applySave?.altAbilities ?? [],
    set: (abilities: AbilityType[]) => {
      const others = abilities.filter(
        (ability) => ability !== saveAbility.value,
      );

      updateSave({ altAbilities: others.length > 0 ? others : undefined });
    },
  });

  // Сл — итог проверки навыка применившего: пусто — обычная Сл
  const saveDcSkill = computed({
    get: () => effect.value.applySave?.dcSkill ?? NO_DC_SKILL,
    set: (skill: string) => {
      updateSave({ dcSkill: isSkillType(skill) ? skill : undefined });
    },
  });

  /** Навыки для Сл от проверки: «обычная Сл» первым пунктом */
  const dcSkillItems = [
    { value: NO_DC_SKILL, label: EFFECT_SAVE_STEP_LABELS.dcSkillNone },
    ...EFFECT_ESCAPE_SKILL_OPTIONS,
  ];

  const saveDc = computed({
    get: () => effect.value.applySave?.dc ?? props.layout.minSaveDc,
    set: (dc: number) => updateSave({ dc }),
  });

  const saveDcFormula = computed({
    get: () => effect.value.applySave?.dcFormula,
    set: (dcFormula: string | undefined) => updateSave({ dcFormula }),
  });

  const allowWilling = computed({
    get: () => effect.value.applySave?.allowWilling === true,
    set: (enabled: boolean) => {
      const applySave = effect.value.applySave;

      if (applySave) {
        effect.value = {
          ...effect.value,
          applySave: { ...applySave, allowWilling: enabled ? true : undefined },
        };
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

      <UFormField class="w-56">
        <template #label>
          <span class="flex items-center gap-1">
            {{ EFFECT_SAVE_STEP_LABELS.altAbilities }}

            <FieldHint :text="EFFECT_SAVE_STEP_LABELS.altAbilitiesHint" />
          </span>
        </template>

        <USelect
          v-model="saveAltAbilities"
          :items="ABILITY_OPTIONS"
          value-key="value"
          multiple
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <SaveDcField
        v-model="saveDc"
        v-model:formula="saveDcFormula"
        formula-allowed
        :label="FORM_FIELD_LABELS.saveDc"
        :auto-allowed="acceptsSourceSaveDc"
        :auto-label="EFFECT_SOURCE_DC_LABELS[layout.context]"
        :auto-value="sourceSaveDc"
      />

      <UFormField
        v-if="layout.useActivated"
        class="w-64"
      >
        <template #label>
          <span class="flex items-center gap-1">
            {{ EFFECT_SAVE_STEP_LABELS.dcSkill }}

            <FieldHint :text="EFFECT_SAVE_STEP_LABELS.dcSkillHint" />
          </span>
        </template>

        <USelect
          v-model="saveDcSkill"
          :items="dcSkillItems"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <USwitch
        v-model="allowWilling"
        class="mb-2"
        :label="EFFECT_SAVE_STEP_LABELS.allowWilling"
        :description="EFFECT_SAVE_STEP_LABELS.allowWillingHint"
      />
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
