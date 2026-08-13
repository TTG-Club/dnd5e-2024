<script setup lang="ts" generic="T extends EditableFeatureFields">
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableFeatureFields } from './speciesEditorTypes';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';

  import {
    FORM_FIELD_LABELS,
    GRANT_FIELD_LABELS,
    SPECIES_FEATURE_LABELS,
    SPECIES_FORM_LABELS,
  } from '../constants';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';

  defineProps<{
    /** Заклинания компендиума по пакам — пробрасываются в редактор заклинаний. */
    availableSpells?: SpellOption[];
  }>();

  /**
   * Редактируемая особенность (общие поля). Дженерик, чтобы v-model одинаково
   * типизировался и для базовой особенности (с вариантами), и для особенности
   * подвида (без вариантов).
   */
  const feature = defineModel<T>({ required: true });

  const emit = defineEmits<{
    /** Открыть детальный просмотр заклинания (id + предпочтённый пак). */
    'open-spell': [spellId: string, packId?: string];
  }>();

  /** Пробрасывает запрос открытия заклинания из редактора заклинаний наверх. */
  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid grid-cols-[1fr_auto] gap-3">
      <UFormField :label="FORM_FIELD_LABELS.name">
        <UInput
          v-model="feature.name"
          :placeholder="SPECIES_FEATURE_LABELS.namePlaceholder"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="FORM_FIELD_LABELS.level">
        <UInputNumber
          v-model="feature.level"
          :min="1"
          :max="20"
          class="w-27.5"
        />
      </UFormField>
    </div>

    <UFormField :label="FORM_FIELD_LABELS.descriptionMarkdown">
      <RichTextEditor v-model="feature.description" />
    </UFormField>

    <UCheckbox
      v-model="feature.isInformationalOnly"
      :label="SPECIES_FEATURE_LABELS.informationalOnly"
    />

    <!-- Механика особенности скрыта у информационных — она всё равно не
         применяется, чтобы не вводить в заблуждение -->
    <template v-if="!feature.isInformationalOnly">
      <UFormField :label="SPECIES_FEATURE_LABELS.speedTitle">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <UInputNumber
            v-model="feature.movement.walk"
            :min="0"
            :max="200"
            :ui="{ base: 'w-full' }"
            :placeholder="SPECIES_FORM_LABELS.speedWalk"
          />

          <UInputNumber
            v-model="feature.movement.fly"
            :min="0"
            :max="200"
            :ui="{ base: 'w-full' }"
            :placeholder="SPECIES_FORM_LABELS.speedFly"
          />

          <UInputNumber
            v-model="feature.movement.swim"
            :min="0"
            :max="200"
            :ui="{ base: 'w-full' }"
            :placeholder="SPECIES_FORM_LABELS.speedSwim"
          />

          <UInputNumber
            v-model="feature.movement.climb"
            :min="0"
            :max="200"
            :ui="{ base: 'w-full' }"
            :placeholder="SPECIES_FORM_LABELS.speedClimb"
          />

          <UInputNumber
            v-model="feature.movement.burrow"
            :min="0"
            :max="200"
            :ui="{ base: 'w-full' }"
            :placeholder="SPECIES_FORM_LABELS.speedBurrow"
          />
        </div>
      </UFormField>

      <UFormField :label="GRANT_FIELD_LABELS.darkvision">
        <UInputNumber
          v-model="feature.darkvision"
          :min="0"
          :max="300"
          :step="30"
        />
      </UFormField>

      <UFormField :label="SPECIES_FEATURE_LABELS.grantedSpells">
        <GrantedSpellsEditor
          v-model="feature.grantedSpells"
          :available-spells="availableSpells"
          @open-spell="forwardOpenSpell"
        />
      </UFormField>
    </template>
  </div>
</template>
