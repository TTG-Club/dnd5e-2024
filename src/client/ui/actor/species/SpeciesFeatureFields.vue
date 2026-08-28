<script setup lang="ts" generic="T extends EditableFeatureFields">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableFeatureFields } from './speciesEditorTypes';

  import { computed } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';

  import {
    FORM_FIELD_LABELS,
    GRANT_FIELD_LABELS,
    SPECIES_FEATURE_LABELS,
    SPECIES_FORM_LABELS,
  } from '../constants';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import { usedChoiceKeys } from '../feat/featEditorTypes';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import ModifierRowsEditor from '../feat/ModifierRowsEditor.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';

  const props = defineProps<{
    /** Заклинания компендиума по пакам — пробрасываются в редактор заклинаний. */
    availableSpells?: SpellOption[];
    /**
     * Сокет для окна выбора заклинания из компендиума. Без него добавить
     * заклинание нечем: другого способа завести запись у редактора нет.
     */
    socket?: TypedWebSocketClient | null;
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

  /** Занятые ключи выборов даров — чтобы новый выбор не столкнулся со старым. */
  const takenChoiceKeys = computed(() => [
    ...usedChoiceKeys(feature.value.grants),
  ]);
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

      <UFormField
        :label="SPECIES_FORM_LABELS.featureGrantsTitle"
        :help="SPECIES_FORM_LABELS.featureGrantsHint"
      >
        <GrantRowsEditor
          v-model="feature.grants.grantRows"
          hide-ability
          :taken-keys="takenChoiceKeys"
        />
      </UFormField>

      <UFormField
        :label="SPECIES_FORM_LABELS.featureModifiersTitle"
        :help="SPECIES_FORM_LABELS.featureModifiersHint"
      >
        <ModifierRowsEditor v-model="feature.grants.modifiers" />
      </UFormField>

      <UFormField :label="SPECIES_FEATURE_LABELS.grantedSpells">
        <GrantedSpellsEditor
          v-model="feature.grantedSpells"
          :available-spells="availableSpells"
          :socket="props.socket"
          @open-spell="forwardOpenSpell"
        />
      </UFormField>

      <UFormField :label="SPECIES_FORM_LABELS.tabEffects">
        <EntityEffectsEditor
          v-model="feature.activeEffects"
          :modal-id="`species-feature-effect-form-modal-${feature.key}`"
          :hint="SPECIES_FORM_LABELS.featureEffectsHint"
          :empty-text="SPECIES_FORM_LABELS.featureEffectsEmpty"
          hide-aura
        />
      </UFormField>
    </template>
  </div>
</template>
