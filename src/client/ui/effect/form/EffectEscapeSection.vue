<!--
  Раздел «Действие, снимающее эффект»: «существо может действием совершить
  проверку Силы (Атлетика) Сл 14 и освободиться». На листе у такого эффекта
  появляется кнопка.

  Сл «Авто» — Сл источника: её проставляют при наложении. У эффекта без
  источника она остаётся нулевой, и кнопка честно отказывается действовать —
  проверка против нуля прошла бы у кого угодно.
-->
<script setup lang="ts">
  import type { SkillType } from '@vtt/shared';
  import type {
    ActiveEffect,
    EffectEscape,
    EffectEscapeActor,
    EffectEscapeOutcome,
    EffectFormLayout,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    DEFAULT_EFFECT_SAVE_DC,
    DEFAULT_ESCAPE_ACTOR,
    DEFAULT_ESCAPE_OUTCOME,
    layoutAcceptsSourceSaveDc,
    SOURCE_SAVE_DC,
  } from '@vtt/shared/system/dnd.js';

  import {
    EFFECT_ESCAPE_SECTION_LABELS,
    EFFECT_SOURCE_DC_LABELS,
    NEW_ESCAPE_CHECK_SKILL,
    NEW_ESCAPE_COST,
  } from '../constants';
  import {
    EFFECT_ESCAPE_ACTOR_OPTIONS,
    EFFECT_ESCAPE_OUTCOME_OPTIONS,
    EFFECT_ESCAPE_SKILL_OPTIONS,
  } from '../effectFormOptions';
  import EffectActionCostFields from './EffectActionCostFields.vue';
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

  /**
   * Сложность новой проверки: где есть источник — его Сл («Авто»), иначе своё
   * число. Ноль там, где источника нет, был бы мёртвым полем: сохранение всё
   * равно подняло бы его до наименьшей допустимой Сл.
   *
   * @returns сложность новой проверки
   */
  function defaultCheckDc(): number {
    return autoDcAllowed.value ? SOURCE_SAVE_DC : DEFAULT_EFFECT_SAVE_DC;
  }

  /**
   * Новая проверка действия: Атлетика против Сл источника или своей.
   *
   * @returns проверка
   */
  function createEscapeCheck(): NonNullable<EffectEscape['check']> {
    return { skill: NEW_ESCAPE_CHECK_SKILL, dc: defaultCheckDc() };
  }

  /**
   * Новый блок действия: действием и с проверкой.
   *
   * @returns блок действия
   */
  function createEscape(): EffectEscape {
    return { cost: NEW_ESCAPE_COST, check: createEscapeCheck() };
  }

  /**
   * Записывает блок действия.
   *
   * @param patch - новые поля блока
   */
  function updateEscape(patch: Partial<EffectEscape>): void {
    const escape = effect.value.escape;

    if (escape) {
      effect.value = { ...effect.value, escape: { ...escape, ...patch } };
    }
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

  const escapeActor = computed({
    get: () => effect.value.escape?.by ?? DEFAULT_ESCAPE_ACTOR,
    set: (next: EffectEscapeActor) =>
      updateEscape({ by: next === DEFAULT_ESCAPE_ACTOR ? undefined : next }),
  });

  const escapeActionCost = computed({
    get: () => ({
      cost: effect.value.escape?.cost,
      moveCostFeet: effect.value.escape?.moveCostFeet,
    }),
    set: (next: Pick<EffectEscape, 'cost' | 'moveCostFeet'>) =>
      updateEscape(next),
  });

  const escapeOutcome = computed({
    get: () => effect.value.escape?.onSuccess ?? DEFAULT_ESCAPE_OUTCOME,
    set: (next: EffectEscapeOutcome) =>
      updateEscape({
        onSuccess: next === DEFAULT_ESCAPE_OUTCOME ? undefined : next,
      }),
  });

  const hasCheck = computed({
    get: () => effect.value.escape?.check !== undefined,
    set: (enabled: boolean) =>
      updateEscape({
        check: enabled ? createEscapeCheck() : undefined,
      }),
  });

  const escapeSkill = computed({
    get: () => effect.value.escape?.check?.skill ?? NEW_ESCAPE_CHECK_SKILL,
    set: (skill: SkillType) => {
      const check = effect.value.escape?.check;

      if (check) {
        updateEscape({ check: { ...check, skill } });
      }
    },
  });

  const escapeDc = computed({
    get: () => effect.value.escape?.check?.dc ?? SOURCE_SAVE_DC,
    set: (dc: number) => {
      const check = effect.value.escape?.check;

      if (check) {
        updateEscape({ check: { ...check, dc } });
      }
    },
  });
</script>

<template>
  <div class="flex flex-col gap-2">
    <USwitch
      v-model="hasEscape"
      :label="EFFECT_ESCAPE_SECTION_LABELS.toggle"
      :description="EFFECT_ESCAPE_SECTION_LABELS.hint"
    />

    <div
      v-if="effect.escape"
      class="flex flex-wrap items-end gap-2 rounded-md border border-default p-2"
    >
      <UFormField
        :label="EFFECT_ESCAPE_SECTION_LABELS.actor"
        class="w-44"
      >
        <USelect
          v-model="escapeActor"
          :items="EFFECT_ESCAPE_ACTOR_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <EffectActionCostFields
        v-model="escapeActionCost"
        cost-width-class="w-44"
      />

      <UFormField
        :label="EFFECT_ESCAPE_SECTION_LABELS.outcome"
        class="w-44"
      >
        <USelect
          v-model="escapeOutcome"
          :items="EFFECT_ESCAPE_OUTCOME_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <USwitch
        v-model="hasCheck"
        class="mb-2"
        :label="EFFECT_ESCAPE_SECTION_LABELS.checkToggle"
      />

      <template v-if="effect.escape.check">
        <UFormField
          :label="EFFECT_ESCAPE_SECTION_LABELS.skill"
          class="w-48"
        >
          <USelect
            v-model="escapeSkill"
            :items="EFFECT_ESCAPE_SKILL_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>

        <SaveDcField
          v-model="escapeDc"
          :label="EFFECT_ESCAPE_SECTION_LABELS.dc"
          :auto-allowed="autoDcAllowed"
          :auto-label="EFFECT_SOURCE_DC_LABELS[layout.context]"
          :auto-value="sourceSaveDc"
        />
      </template>
    </div>
  </div>
</template>
