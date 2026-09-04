<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type {
    EditableClassFeature,
    EditableClassFeatureScaling,
  } from './classEditorTypes';

  import { computed } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import { generateId } from '@vtt/shared';

  import {
    CLASS_FEATURE_LABELS,
    CLASS_FEATURE_MECHANICS_TITLES,
    CLASS_LEVEL_MAX,
    FORM_FIELD_LABELS,
  } from '../constants';
  import EditorNestedSection from '../EditorNestedSection.vue';
  import {
    countFilledMechanicsBlocks,
    createEmptyFeatureChoice,
  } from './classEditorTypes';
  import ClassFeatureChoiceConfigFields from './ClassFeatureChoiceConfigFields.vue';
  import ClassFeatureChoiceRows from './ClassFeatureChoiceRows.vue';
  import ClassFeatureScalingRows from './ClassFeatureScalingRows.vue';
  import ClassMechanicsFields from './ClassMechanicsFields.vue';

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
    feature.value.choices.push(createEmptyFeatureChoice());
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

    <!-- Три свёрнутых раздела, как на сайте: у большинства умений они пусты, а
      развёрнутые все разом заслоняли бы список умений -->
    <EditorNestedSection
      :title="CLASS_FEATURE_LABELS.scalingTitle"
      :hint="CLASS_FEATURE_LABELS.scalingHint"
      :count="feature.scaling.length"
      :add-label="CLASS_FEATURE_LABELS.scalingAdd"
      @add="addScalingStep"
    >
      <ClassFeatureScalingRows v-model="feature.scaling" />
    </EditorNestedSection>

    <EditorNestedSection
      :title="CLASS_FEATURE_LABELS.choicesTitle"
      :hint="CLASS_FEATURE_LABELS.choicesHint"
      :count="feature.choices.length"
      :add-label="CLASS_FEATURE_LABELS.choiceAdd"
      @add="addChoice"
    >
      <!-- Настройка выбора идёт перед списком: сначала автор решает,
        выбирают из списка или он справочный, и лишь потом набирает варианты -->
      <ClassFeatureChoiceConfigFields v-model="feature.choiceConfig" />

      <ClassFeatureChoiceRows
        v-model="feature.choices"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        @open-spell="forwardOpenSpell"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="CLASS_FEATURE_LABELS.mechanicsTitle"
      :hint="CLASS_FEATURE_LABELS.mechanicsHint"
      :count="filledMechanicsCount"
    >
      <ClassMechanicsFields
        v-model:grants="feature.grants"
        v-model:active-effects="feature.activeEffects"
        :titles="CLASS_FEATURE_MECHANICS_TITLES"
        :effects-modal-id="`class-feature-effect-form-modal-${feature.key}`"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        with-table-column
        @open-spell="forwardOpenSpell"
      />
    </EditorNestedSection>
  </div>
</template>
