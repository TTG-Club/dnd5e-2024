<script setup lang="ts">
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type {
    EditableClassFeature,
    EditableClassFeatureChoice,
    EditableGrantedSpellLevel,
  } from './classEditorTypes';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import { generateId } from '@vtt/shared';
  import { SKILLS_LIST } from '@vtt/shared/system/dnd.js';

  import {
    CLASS_FEATURE_LABELS,
    CLASS_FORM_LABELS,
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
  } from '../constants';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';

  /** Навыки для выпадающего списка выбора владения */
  const skillsOptions = SKILLS_LIST.map((skill) => ({
    value: skill.key,
    label: skill.label,
  }));

  defineProps<{
    /** Заклинания компендиума по пакам — для подсказок связывания. */
    availableSpells?: SpellOption[];
  }>();

  /** Редактируемая особенность класса/подкласса. */
  const feature = defineModel<EditableClassFeature>({ required: true });

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }

  /** Добавляет вариант-выбор (боевой стиль / манёвр). */
  function addChoice(): void {
    const choice: EditableClassFeatureChoice = {
      uid: generateId('cfc'),
      key: generateId('cfc'),
      name: '',
      description: '',
    };

    feature.value.choices.push(choice);
  }

  /** Удаляет вариант по индексу. */
  function removeChoice(index: number): void {
    feature.value.choices.splice(index, 1);
  }

  /** Добавляет уровень поуровневой выдачи заклинаний. */
  function addSpellLevel(): void {
    const entry: EditableGrantedSpellLevel = {
      uid: generateId('gsl'),
      level: 1,
      spells: [],
    };

    feature.value.grantedSpellsByLevel.push(entry);
  }

  /** Удаляет уровень поуровневой выдачи по индексу. */
  function removeSpellLevel(index: number): void {
    feature.value.grantedSpellsByLevel.splice(index, 1);
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid grid-cols-[1fr_auto] gap-3">
      <UFormField :label="FORM_FIELD_LABELS.name">
        <UInput
          v-model="feature.name"
          :placeholder="CLASS_FEATURE_LABELS.namePlaceholder"
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
      :label="CLASS_FEATURE_LABELS.informationalOnly"
    />

    <!-- Владение навыками, которое даёт само умение: мастер класса покажет на
      его уровне отдельный шаг выбора -->
    <UFormField :label="CLASS_FEATURE_LABELS.skillChoiceTitle">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UFormField
          :label="CLASS_FEATURE_LABELS.skillChoiceCount"
          :hint="CLASS_FEATURE_LABELS.skillChoiceCountHint"
        >
          <UInput
            v-model.number="feature.skillChoiceCount"
            type="number"
            :min="0"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="feature.skillChoiceCount > 0"
          :label="CLASS_FEATURE_LABELS.skillChoiceFrom"
          :hint="CLASS_FEATURE_LABELS.skillChoiceFromHint"
        >
          <USelectMenu
            v-model="feature.skillChoiceFrom"
            :items="skillsOptions"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
          />
        </UFormField>
      </div>
    </UFormField>

    <!-- Варианты-выборы (боевой стиль, манёвры) -->
    <UFormField :label="CLASS_FEATURE_LABELS.choicesTitle">
      <div class="flex flex-col gap-2">
        <div
          v-for="(choice, choiceIndex) in feature.choices"
          :key="choice.uid"
          class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated/30 p-2"
        >
          <div class="flex items-center gap-2">
            <UInput
              v-model="choice.name"
              :placeholder="CLASS_FEATURE_LABELS.choiceName"
              class="flex-1"
            />

            <UButton
              icon="tabler:trash"
              color="error"
              variant="ghost"
              size="xs"
              :aria-label="CLASS_FEATURE_LABELS.choiceRemove"
              @click.left.exact.prevent="removeChoice(choiceIndex)"
            />
          </div>

          <UTextarea
            v-model="choice.description"
            :rows="2"
            autoresize
            :placeholder="CLASS_FEATURE_LABELS.choiceDescription"
            class="w-full"
          />
        </div>

        <UButton
          icon="tabler:plus"
          :label="CLASS_FEATURE_LABELS.choiceAdd"
          color="neutral"
          variant="soft"
          size="xs"
          class="self-start"
          @click.left.exact.prevent="addChoice"
        />
      </div>
    </UFormField>

    <!-- Заклинания на 1 уровне особенности -->
    <UFormField :label="CLASS_FEATURE_LABELS.grantedSpells">
      <GrantedSpellsEditor
        v-model="feature.grantedSpells"
        :available-spells="availableSpells"
        @open-spell="forwardOpenSpell"
      />
    </UFormField>

    <!-- Поуровневая выдача заклинаний (домены/клятвы/покровители) -->
    <UFormField :label="CLASS_FEATURE_LABELS.grantedSpellsByLevel">
      <div class="flex flex-col gap-2">
        <div
          v-for="(entry, levelIndex) in feature.grantedSpellsByLevel"
          :key="entry.uid"
          class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated/30 p-2"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">{{
              CLASS_FEATURE_LABELS.classLevelPrefix
            }}</span>

            <UInputNumber
              v-model="entry.level"
              :min="1"
              :max="20"
              class="w-25"
            />

            <UButton
              icon="tabler:trash"
              color="error"
              variant="ghost"
              size="xs"
              class="ml-auto"
              :aria-label="CLASS_FEATURE_LABELS.levelRemove"
              @click.left.exact.prevent="removeSpellLevel(levelIndex)"
            />
          </div>

          <GrantedSpellsEditor
            v-model="entry.spells"
            :available-spells="availableSpells"
            @open-spell="forwardOpenSpell"
          />
        </div>

        <UButton
          icon="tabler:plus"
          :label="CLASS_FEATURE_LABELS.levelAdd"
          color="neutral"
          variant="soft"
          size="xs"
          class="self-start"
          @click.left.exact.prevent="addSpellLevel"
        />
      </div>
    </UFormField>

    <UFormField :label="FORM_TAB_LABELS.effects">
      <EntityEffectsEditor
        v-model="feature.activeEffects"
        :modal-id="`class-feature-effect-form-modal-${feature.key}`"
        :hint="CLASS_FORM_LABELS.featureEffectsHint"
        :empty-text="CLASS_FORM_LABELS.featureEffectsEmpty"
        hide-aura
      />
    </UFormField>
  </div>
</template>
