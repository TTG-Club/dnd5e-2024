<!--
  Раздел «Правило каста»: что мешает носителю колдовать, пока эффект на нём, —
  лимит круга ячейки («не может использовать ячейки 7-го круга и выше») и
  провал каста шансом («Замедление»: 25 % у заклинаний с соматическим
  компонентом) или спасброском заклинателя («Слово силы: Боль»).

  Запреты без чисел — «нельзя вовсе», «нельзя школу», «нельзя действие Магия» —
  лежат флагами в списке флагов.
-->
<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type {
    ActiveEffect,
    CastRuleSave,
    EffectCastRule,
    EffectFormLayout,
  } from '@vtt/shared/system/dnd.js';

  import type { CastRuleComponentChoice } from '../castRuleLabels';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    DEFAULT_EFFECT_SAVE_DC,
    layoutAcceptsSourceSaveDc,
    MAX_CAST_FAIL_CHANCE,
    MAX_SPELL_SLOT_LEVEL,
    MIN_CAST_FAIL_CHANCE,
    MIN_SPELL_SLOT_LEVEL,
    SOURCE_SAVE_DC,
  } from '@vtt/shared/system/dnd.js';

  import { FORM_FIELD_LABELS } from '../../actor/constants';
  import FieldHint from '../../actor/FieldHint.vue';
  import {
    CAST_RULE_ANY_COMPONENT,
    CAST_RULE_COMPONENT_OPTIONS,
    EFFECT_CAST_RULE_LABELS,
    NEW_CAST_RULE_SAVE_ABILITY,
  } from '../castRuleLabels';
  import { EFFECT_SOURCE_DC_LABELS } from '../constants';
  import SaveDcField from './SaveDcField.vue';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
    /** Сл источника для «Авто», если окно её знает */
    sourceSaveDc?: number;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  /** «Авто» доступно там, где Сл источника вообще бывает */
  const autoDcAllowed = computed(() => layoutAcceptsSourceSaveDc(props.layout));

  const rule = computed<EffectCastRule>(() => effect.value.castRule ?? {});

  /**
   * Записывает правило.
   *
   * @param next - новое правило
   */
  function writeRule(next: EffectCastRule | undefined): void {
    effect.value = { ...effect.value, castRule: next };
  }

  const enabled = computed({
    get: () => effect.value.castRule !== undefined,
    set: (on: boolean) => {
      writeRule(on ? {} : undefined);
    },
  });

  const maxSlotLevel = computed({
    get: () => rule.value.maxSlotLevel ?? null,
    set: (level: number | null) => {
      writeRule({ ...rule.value, maxSlotLevel: level ?? undefined });
    },
  });

  const minSlotLevel = computed({
    get: () => rule.value.minSlotLevel ?? null,
    set: (level: number | null) => {
      writeRule({ ...rule.value, minSlotLevel: level ?? undefined });
    },
  });

  const failChance = computed({
    get: () => rule.value.failChance ?? null,
    set: (chance: number | null) => {
      writeRule({ ...rule.value, failChance: chance ?? undefined });
    },
  });

  const hasFailSave = computed({
    get: () => rule.value.failSave !== undefined,
    set: (on: boolean) => {
      writeRule({
        ...rule.value,
        failSave: on
          ? {
              ability: NEW_CAST_RULE_SAVE_ABILITY,
              dc: autoDcAllowed.value ? SOURCE_SAVE_DC : DEFAULT_EFFECT_SAVE_DC,
            }
          : undefined,
      });
    },
  });

  /**
   * Меняет поля спасброска при попытке каста; без спасброска менять нечего.
   *
   * @param patch - новые поля спасброска
   */
  function updateFailSave(patch: Partial<CastRuleSave>): void {
    if (rule.value.failSave) {
      writeRule({
        ...rule.value,
        failSave: { ...rule.value.failSave, ...patch },
      });
    }
  }

  const failSaveAbility = computed({
    get: () => rule.value.failSave?.ability ?? NEW_CAST_RULE_SAVE_ABILITY,
    set: (ability: AbilityType) => updateFailSave({ ability }),
  });

  const failSaveDc = computed({
    get: () => rule.value.failSave?.dc ?? DEFAULT_EFFECT_SAVE_DC,
    set: (dc: number) => updateFailSave({ dc }),
  });

  const failSaveDcFormula = computed({
    get: () => rule.value.failSave?.dcFormula,
    set: (dcFormula: string | undefined) => updateFailSave({ dcFormula }),
  });

  /** Есть ли у правила провал: без него компонент и ячейка ничего не значат */
  const hasFailure = computed(
    () =>
      rule.value.failChance !== undefined || rule.value.failSave !== undefined,
  );

  const failComponent = computed<CastRuleComponentChoice>({
    get: () => rule.value.failComponent ?? CAST_RULE_ANY_COMPONENT,
    set: (component) => {
      writeRule({
        ...rule.value,
        failComponent:
          component === CAST_RULE_ANY_COMPONENT ? undefined : component,
      });
    },
  });

  const failLosesSlot = computed({
    get: () => rule.value.failLosesSlot === true,
    set: (on: boolean) => {
      writeRule({ ...rule.value, failLosesSlot: on ? true : undefined });
    },
  });
</script>

<template>
  <div class="flex flex-col gap-2">
    <USwitch
      v-model="enabled"
      :label="EFFECT_CAST_RULE_LABELS.toggle"
      :description="EFFECT_CAST_RULE_LABELS.toggleHint"
    />

    <template v-if="enabled">
      <div class="flex flex-wrap items-end gap-3">
        <UFormField class="w-48">
          <template #label>
            <span class="flex items-center gap-1">
              {{ EFFECT_CAST_RULE_LABELS.maxSlotLevel }}

              <FieldHint :text="EFFECT_CAST_RULE_LABELS.maxSlotLevelHint" />
            </span>
          </template>

          <UInputNumber
            v-model="maxSlotLevel"
            :min="MIN_SPELL_SLOT_LEVEL"
            :max="MAX_SPELL_SLOT_LEVEL"
            size="sm"
            class="w-full"
          />
        </UFormField>

        <UFormField class="w-48">
          <template #label>
            <span class="flex items-center gap-1">
              {{ EFFECT_CAST_RULE_LABELS.minSlotLevel }}

              <FieldHint :text="EFFECT_CAST_RULE_LABELS.minSlotLevelHint" />
            </span>
          </template>

          <UInputNumber
            v-model="minSlotLevel"
            :min="MIN_SPELL_SLOT_LEVEL"
            :max="MAX_SPELL_SLOT_LEVEL"
            size="sm"
            class="w-full"
          />
        </UFormField>

        <UFormField class="w-48">
          <template #label>
            <span class="flex items-center gap-1">
              {{ EFFECT_CAST_RULE_LABELS.failChance }}

              <FieldHint :text="EFFECT_CAST_RULE_LABELS.failChanceHint" />
            </span>
          </template>

          <UInputNumber
            v-model="failChance"
            :min="MIN_CAST_FAIL_CHANCE"
            :max="MAX_CAST_FAIL_CHANCE"
            size="sm"
            class="w-full"
          />
        </UFormField>
      </div>

      <USwitch
        v-model="hasFailSave"
        :label="EFFECT_CAST_RULE_LABELS.failSaveToggle"
        :description="EFFECT_CAST_RULE_LABELS.failSaveToggleHint"
      />

      <div
        v-if="hasFailSave"
        class="flex flex-wrap items-end gap-3"
      >
        <UFormField
          :label="FORM_FIELD_LABELS.ability"
          class="w-48"
        >
          <USelect
            v-model="failSaveAbility"
            :items="ABILITY_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>

        <SaveDcField
          v-model="failSaveDc"
          v-model:formula="failSaveDcFormula"
          formula-allowed
          :label="EFFECT_CAST_RULE_LABELS.failSaveDc"
          :auto-allowed="autoDcAllowed"
          :auto-label="EFFECT_SOURCE_DC_LABELS[layout.context]"
          :auto-value="sourceSaveDc"
        />
      </div>

      <div
        v-if="hasFailure"
        class="flex flex-wrap items-end gap-3"
      >
        <UFormField
          :label="EFFECT_CAST_RULE_LABELS.failComponent"
          class="w-64"
        >
          <USelect
            v-model="failComponent"
            :items="CAST_RULE_COMPONENT_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>

        <USwitch
          v-model="failLosesSlot"
          class="mb-2"
          :label="EFFECT_CAST_RULE_LABELS.failLosesSlot"
          :description="EFFECT_CAST_RULE_LABELS.failLosesSlotHint"
        />
      </div>
    </template>
  </div>
</template>
