<script setup lang="ts" generic="T extends EditableFeatureFields">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableFeatureFields } from './speciesEditorTypes';

  import { computed, useTemplateRef } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';

  import {
    FEAT_GRANTS_LABELS,
    FORM_FIELD_LABELS,
    GRANT_FIELD_LABELS,
    MODAL_BUTTON_LABELS,
    SPECIES_FEATURE_LABELS,
    SPECIES_FORM_LABELS,
    SPELL_CHOICE_LABELS,
    SPELL_LIST_LABELS,
  } from '../constants';
  import EditorNestedSection from '../EditorNestedSection.vue';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import { usedChoiceKeys } from '../feat/featEditorTypes';
  import FeatSpellListEditor from '../feat/FeatSpellListEditor.vue';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import ModifierAddMenu from '../feat/ModifierAddMenu.vue';
  import ModifierRowsEditor from '../feat/ModifierRowsEditor.vue';
  import SpellChoiceRowsEditor from '../feat/SpellChoiceRowsEditor.vue';
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

  /**
   * Списки разделов: кнопка добавления живёт в шапке раздела, а знание о том,
   * какой получается новая строка, остаётся у самого редактора.
   */
  const grantRows = useTemplateRef('grantRows');
  const spellChoiceRows = useTemplateRef('spellChoiceRows');
  const spellListGroups = useTemplateRef('spellListGroups');
  const effectRows = useTemplateRef('effectRows');
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

      <!-- Разделами-дорожками, как у умения класса: механика особенности
        устроена так же, а подпись поля рядом с длинным списком терялась -->
      <EditorNestedSection
        :title="SPECIES_FORM_LABELS.featureGrantsTitle"
        :hint="SPECIES_FORM_LABELS.featureGrantsHint"
        :count="feature.grants.grantRows.length"
        :add-label="FEAT_GRANTS_LABELS.addGrant"
        :collapsible="false"
        @add="grantRows?.addRow()"
      >
        <GrantRowsEditor
          ref="grantRows"
          v-model="feature.grants.grantRows"
          hide-ability
          hide-feat
          :taken-keys="takenChoiceKeys"
          :socket="props.socket"
        />
      </EditorNestedSection>

      <EditorNestedSection
        :title="SPECIES_FORM_LABELS.featureModifiersTitle"
        :hint="SPECIES_FORM_LABELS.featureModifiersHint"
        :count="feature.grants.modifiers.length"
        :collapsible="false"
      >
        <!-- Своя кнопка: вид правки выбирают меню, а не одним нажатием -->
        <template #actions>
          <ModifierAddMenu v-model="feature.grants.modifiers" />
        </template>

        <ModifierRowsEditor v-model="feature.grants.modifiers" />
      </EditorNestedSection>

      <EditorNestedSection
        :title="SPECIES_FEATURE_LABELS.grantedSpells"
        :count="feature.grantedSpells.length"
        :collapsible="false"
      >
        <GrantedSpellsEditor
          v-model="feature.grantedSpells"
          :available-spells="availableSpells"
          :socket="props.socket"
          @open-spell="forwardOpenSpell"
        />
      </EditorNestedSection>

      <!-- Выбор заклинаний игроком и расширение списка — те же блоки, что у
        черты и умения класса: заговор высшего эльфа игрок выбирает сам -->
      <EditorNestedSection
        :title="SPECIES_FEATURE_LABELS.spellChoices"
        :hint="SPELL_CHOICE_LABELS.hint"
        :count="feature.grants.spellChoice.picks.length"
        :add-label="SPELL_CHOICE_LABELS.add"
        :collapsible="false"
        @add="spellChoiceRows?.addRow()"
      >
        <SpellChoiceRowsEditor
          ref="spellChoiceRows"
          v-model="feature.grants.spellChoice"
          :taken-keys="takenChoiceKeys"
          :available-spells="availableSpells"
          :socket="props.socket"
          @open-spell="forwardOpenSpell"
        />
      </EditorNestedSection>

      <EditorNestedSection
        :title="SPECIES_FEATURE_LABELS.spellList"
        :hint="SPELL_LIST_LABELS.hint"
        :count="feature.grants.spellList.groups.length"
        :add-label="SPELL_LIST_LABELS.addGroup"
        :collapsible="false"
        @add="spellListGroups?.addGroup()"
      >
        <FeatSpellListEditor
          ref="spellListGroups"
          v-model="feature.grants.spellList"
          :available-spells="availableSpells"
          :socket="props.socket"
          @open-spell="forwardOpenSpell"
        />
      </EditorNestedSection>

      <EditorNestedSection
        :title="SPECIES_FORM_LABELS.tabEffects"
        :hint="SPECIES_FORM_LABELS.featureEffectsHint"
        :count="feature.activeEffects.length"
        :add-label="MODAL_BUTTON_LABELS.addEffect"
        :collapsible="false"
        @add="effectRows?.createEffect()"
      >
        <EntityEffectsEditor
          ref="effectRows"
          v-model="feature.activeEffects"
          :modal-id="`species-feature-effect-form-modal-${feature.key}`"
          hide-aura
        />
      </EditorNestedSection>
    </template>
  </div>
</template>
