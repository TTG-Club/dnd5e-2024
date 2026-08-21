<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';

  import type { SpellCountKind } from './featEditorTypes';

  import { computed } from 'vue';

  import { ABILITY_OPTIONS } from '@vtt/shared/system/dnd.js';

  import { SPELL_LIST_LABELS } from '../constants';
  import {
    abilityModifierFormula,
    getSpellCountAbility,
    getSpellCountKind,
    SPELL_COUNT_KIND_OPTIONS,
    spellCountFormula,
  } from './featEditorTypes';

  /**
   * Сколько заклинаний берут из ступени списка.
   *
   * Хранится одной формулой: число, `@prof`, `@mod.<abbr>` — ту же грамматику
   * понимают ресурсы черты и активные эффекты, и второй диалект того же смысла
   * разошёлся бы с первым. Поле лишь раскладывает формулу на понятный выбор:
   * знать про `@mod.cha` автор черты не обязан.
   */
  const model = defineModel<string>({ required: true });

  /** Чем задано количество — по записанной формуле. */
  const kind = computed<SpellCountKind>(() => getSpellCountKind(model.value));

  /** Число из формулы; у остальных видов его нет. */
  const fixedCount = computed<number | undefined>(() => {
    const parsed = Number.parseInt(model.value.trim(), 10);

    return Number.isNaN(parsed) ? undefined : parsed;
  });

  /** Характеристика, чей модификатор задаёт количество. */
  const ability = computed<AbilityType | undefined>(() =>
    getSpellCountAbility(model.value),
  );

  /**
   * Смена вида переписывает формулу целиком.
   *
   * @param next - новый вид количества
   */
  function setKind(next: SpellCountKind): void {
    model.value = spellCountFormula(next);
  }

  /**
   * Записывает число.
   *
   * @param value - количество заклинаний
   */
  function setFixedCount(value: number | undefined): void {
    model.value = value === undefined ? '' : String(value);
  }

  /**
   * Записывает характеристику, чей модификатор задаёт количество.
   *
   * @param value - выбранная характеристика
   */
  function setAbility(value: AbilityType): void {
    model.value = abilityModifierFormula(value);
  }
</script>

<template>
  <div class="flex flex-wrap items-end gap-2">
    <UFormField
      :label="SPELL_LIST_LABELS.count"
      class="w-56"
    >
      <USelect
        :model-value="kind"
        :items="SPELL_COUNT_KIND_OPTIONS"
        value-key="value"
        label-key="label"
        size="sm"
        class="w-full"
        @update:model-value="setKind"
      />
    </UFormField>

    <UFormField
      v-if="kind === 'fixed'"
      :label="SPELL_LIST_LABELS.countValue"
      class="w-24"
    >
      <UInputNumber
        :model-value="fixedCount"
        :min="1"
        :max="20"
        size="sm"
        class="w-full"
        @update:model-value="setFixedCount"
      />
    </UFormField>

    <UFormField
      v-else-if="kind === 'abilityModifier'"
      :label="SPELL_LIST_LABELS.countAbility"
      class="w-44"
    >
      <USelect
        :model-value="ability"
        :items="ABILITY_OPTIONS"
        value-key="value"
        label-key="label"
        size="sm"
        class="w-full"
        @update:model-value="setAbility"
      />
    </UFormField>

    <UFormField
      v-else-if="kind === 'formula'"
      :label="SPELL_LIST_LABELS.countFormula"
      class="w-40"
    >
      <UInput
        v-model="model"
        size="sm"
        class="w-full"
        :placeholder="SPELL_LIST_LABELS.countFormulaPlaceholder"
      />
    </UFormField>
  </div>
</template>
