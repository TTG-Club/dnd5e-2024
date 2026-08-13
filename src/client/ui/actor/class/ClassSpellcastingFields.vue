<script setup lang="ts">
  import type { EditableSpellcasting } from './classEditorTypes';

  import { ABILITY_OPTIONS } from '@vtt/shared/system/dnd.js';

  import {
    CLASS_SPELLCASTING_FIELDS_LABELS,
    FORM_FIELD_LABELS,
  } from '../constants';
  import { CASTER_TYPE_OPTIONS } from './classEditorTypes';

  /** Заклинательная конфигурация класса или подкласса. */
  const spellcasting = defineModel<EditableSpellcasting>({ required: true });

  const abilityOptions = ABILITY_OPTIONS.map((ability) => ({
    value: ability.value,
    label: ability.label,
  }));
</script>

<template>
  <div class="flex flex-col gap-3">
    <UCheckbox
      v-model="spellcasting.enabled"
      :label="CLASS_SPELLCASTING_FIELDS_LABELS.enabled"
    />

    <div
      v-if="spellcasting.enabled"
      class="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      <UFormField :label="CLASS_SPELLCASTING_FIELDS_LABELS.casterType">
        <USelect
          v-model="spellcasting.type"
          :items="CASTER_TYPE_OPTIONS"
          value-key="value"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="FORM_FIELD_LABELS.ability">
        <USelect
          v-model="spellcasting.ability"
          :items="abilityOptions"
          value-key="value"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="FORM_FIELD_LABELS.startLevel">
        <UInputNumber
          v-model="spellcasting.startLevel"
          :min="1"
          :max="20"
        />
      </UFormField>
    </div>

    <p
      v-if="spellcasting.enabled"
      class="text-[11px] text-dimmed"
    >
      {{ CLASS_SPELLCASTING_FIELDS_LABELS.hint }}
    </p>
  </div>
</template>
