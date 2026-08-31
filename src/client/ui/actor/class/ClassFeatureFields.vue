<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type {
    EditableClassFeature,
    EditableClassFeatureChoice,
    EditableClassFeatureScaling,
    EditableGrantedSpellLevel,
  } from './classEditorTypes';

  import { computed } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import { generateId } from '@vtt/shared';

  import {
    CLASS_FEATURE_LABELS,
    CLASS_FORM_LABELS,
    CLASS_LEVEL_MAX,
    FORM_FIELD_LABELS,
  } from '../constants';
  import CounterRowsEditor from '../CounterRowsEditor.vue';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import FormSection from '../FormSection.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';
  import { countFilledMechanicsBlocks } from './classEditorTypes';
  import ClassFeatureChoiceConfigFields from './ClassFeatureChoiceConfigFields.vue';
  import ClassFeatureChoiceRows from './ClassFeatureChoiceRows.vue';
  import ClassFeatureScalingRows from './ClassFeatureScalingRows.vue';
  import ClassFeatureSection from './ClassFeatureSection.vue';
  import ClassGrantsFields from './ClassGrantsFields.vue';

  const props = defineProps<{
    /** Заклинания компендиума по пакам — для подсказок связывания. */
    availableSpells?: SpellOption[];
    /**
     * Сокет для окна выбора заклинания из компендиума. Без него добавить
     * заклинание нечем: другого способа завести запись у редактора нет.
     */
    socket?: TypedWebSocketClient | null;
  }>();

  /** Редактируемое умение класса/подкласса. */
  const feature = defineModel<EditableClassFeature>({ required: true });

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  /** Сколько блоков механики заполнено — бейдж свёрнутого блока. */
  const filledMechanicsCount = computed(() =>
    countFilledMechanicsBlocks(feature.value),
  );

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }

  /**
   * Добавляет ступень роста. Следующая начинается уровнем позже последней —
   * ряд «8, 12, 16» набирается без возврата к уровню самого умения.
   */
  function addScalingStep(): void {
    const last = feature.value.scaling.at(-1);

    const step: EditableClassFeatureScaling = {
      uid: generateId('cfs'),
      level: Math.min(
        CLASS_LEVEL_MAX,
        (last?.level ?? feature.value.level) + 1,
      ),
      name: '',
      description: '',
    };

    feature.value.scaling.push(step);
  }

  /** Добавляет вариант-выбор (боевой стиль / манёвр). */
  function addChoice(): void {
    const choice: EditableClassFeatureChoice = {
      uid: generateId('cfc'),
      key: generateId('cfc'),
      name: '',
      nameEn: '',
      description: '',
      additional: '',
      prerequisite: '',
      hideInSubclasses: false,
      repeatable: false,
    };

    feature.value.choices.push(choice);
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
          :max="CLASS_LEVEL_MAX"
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

    <!-- Три свёрнутых блока, как на сайте: у большинства умений они пусты, а
      развёрнутые все разом заслоняли бы список умений -->
    <ClassFeatureSection
      :title="CLASS_FEATURE_LABELS.scalingTitle"
      :hint="CLASS_FEATURE_LABELS.scalingHint"
      :count="feature.scaling.length"
      :add-label="CLASS_FEATURE_LABELS.scalingAdd"
      @add="addScalingStep"
    >
      <ClassFeatureScalingRows v-model="feature.scaling" />
    </ClassFeatureSection>

    <ClassFeatureSection
      :title="CLASS_FEATURE_LABELS.choicesTitle"
      :hint="CLASS_FEATURE_LABELS.choicesHint"
      :count="feature.choices.length"
      :add-label="CLASS_FEATURE_LABELS.choiceAdd"
      @add="addChoice"
    >
      <div class="flex flex-col gap-2">
        <!-- Настройка выбора идёт перед списком: сначала автор решает,
          выбирают из списка или он справочный, и лишь потом набирает варианты -->
        <ClassFeatureChoiceConfigFields v-model="feature.choiceConfig" />

        <ClassFeatureChoiceRows v-model="feature.choices" />
      </div>
    </ClassFeatureSection>

    <ClassFeatureSection
      :title="CLASS_FEATURE_LABELS.mechanicsTitle"
      :hint="CLASS_FEATURE_LABELS.mechanicsHint"
      :count="filledMechanicsCount"
    >
      <div class="flex flex-col gap-4">
        <!-- Дары умения тем же блоком, что у класса и у черты: ресурс умения
          заводится прямо здесь, а не привязкой к нему из счётчиков класса -->
        <ClassGrantsFields
          v-model="feature.grants"
          :socket="props.socket"
          :grants-title="CLASS_FORM_LABELS.featureGrantsTitle"
          :grants-hint="CLASS_FORM_LABELS.featureGrantsHint"
          :modifiers-title="CLASS_FORM_LABELS.featureModifiersTitle"
        />

        <!-- Ресурс умения — ресурсом дара: он появляется вместе с самим
          умением, и ни ступеней, ни своей колонки в таблице класса у него нет -->
        <FormSection
          :title="CLASS_FORM_LABELS.featureCountersTitle"
          icon="tabler:battery-2"
        >
          <CounterRowsEditor
            v-model="feature.grants.counters"
            with-table-column
          />
        </FormSection>

        <FormSection
          :title="CLASS_FEATURE_LABELS.grantedSpells"
          icon="tabler:sparkles"
          :hint="CLASS_FEATURE_LABELS.grantedSpellsHint"
        >
          <GrantedSpellsEditor
            v-model="feature.grantedSpells"
            :available-spells="availableSpells"
            :socket="props.socket"
            @open-spell="forwardOpenSpell"
          />
        </FormSection>

        <!-- Поуровневая выдача заклинаний (домены/клятвы/покровители) -->
        <FormSection
          :title="CLASS_FEATURE_LABELS.grantedSpellsByLevel"
          icon="tabler:chart-arrows-vertical"
          :hint="CLASS_FEATURE_LABELS.grantedSpellsByLevelHint"
        >
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
                  :max="CLASS_LEVEL_MAX"
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
                :socket="props.socket"
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
        </FormSection>

        <FormSection
          :title="CLASS_FORM_LABELS.featureEffectsTitle"
          icon="tabler:bolt"
        >
          <EntityEffectsEditor
            v-model="feature.activeEffects"
            :modal-id="`class-feature-effect-form-modal-${feature.key}`"
            :hint="CLASS_FORM_LABELS.featureEffectsHint"
            :empty-text="CLASS_FORM_LABELS.featureEffectsEmpty"
            hide-aura
          />
        </FormSection>
      </div>
    </ClassFeatureSection>
  </div>
</template>
