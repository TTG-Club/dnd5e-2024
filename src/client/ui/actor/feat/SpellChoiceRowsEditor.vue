<script setup lang="ts">
  import type {
    EditableSpellChoiceBlock,
    EditableSpellPickRow,
  } from './featEditorTypes';

  import { ref } from 'vue';

  import {
    CASTING_TIME_OPTIONS,
    CLASS_KEY_OPTIONS,
    RITUAL_CASTING_TIME,
    SPELL_SCHOOL_OPTIONS,
  } from '@vtt/shared/system/dnd.js';

  import { NO_SELECTION, SPELL_CHOICE_LABELS } from '../constants';
  import FieldHint from '../FieldHint.vue';
  import FormSection from '../FormSection.vue';
  import {
    createSpellPickRow,
    getSpellPickLevelValue,
    parseSpellPickLevelValue,
    SPELL_PICK_LEVEL_OPTIONS,
  } from './featEditorTypes';

  /**
   * Заклинания, которые игрок выбирает сам при взятии черты.
   *
   * Список классов один на все порции: «Посвящённый в магию» спрашивает класс
   * один раз и берёт из него и заговоры, и заклинание первого круга. Служебный
   * выбор класса и ссылку на него форма пишет сама — автору о них знать незачем.
   */
  const block = defineModel<EditableSpellChoiceBlock>({ required: true });

  const props = withDefaults(
    defineProps<{
      /** Ключи выборов, уже занятые чертой (включая вкладку владений) */
      takenKeys?: string[];
    }>(),
    { takenKeys: () => [] },
  );

  interface SelectOption {
    value: string;
    label: string;
  }

  const castingTimeOptions: SelectOption[] = [
    { value: NO_SELECTION, label: SPELL_CHOICE_LABELS.any },
    { value: RITUAL_CASTING_TIME, label: SPELL_CHOICE_LABELS.ritual },
    ...CASTING_TIME_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ];

  const schoolOptions: SelectOption[] = SPELL_SCHOOL_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  const classOptions: SelectOption[] = CLASS_KEY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  /** Порции, у которых автор раскрыл уточнение фильтра. */
  const expandedRows = ref<Set<string>>(new Set());

  /**
   * Показывать ли уточнение фильтра. Нужно оно единицам черт, поэтому по
   * умолчанию скрыто — но у порции, где школа или время уже заданы записью,
   * скрывать их значило бы прятать от автора работающее ограничение.
   *
   * @param row - порция заклинаний
   */
  function isFilterShown(row: EditableSpellPickRow): boolean {
    return (
      expandedRows.value.has(row.uid)
      || row.schools.length > 0
      || !!row.castingTime
    );
  }

  /**
   * Раскрывает уточнение фильтра у порции.
   *
   * @param row - порция заклинаний
   */
  function showFilter(row: EditableSpellPickRow): void {
    expandedRows.value = new Set([...expandedRows.value, row.uid]);
  }

  /**
   * Записывает классы, из чьих списков берут заклинания.
   *
   * @param keys - выбранные классы
   */
  function setClasses(keys: string[]): void {
    block.value = { ...block.value, classKeys: keys };
  }

  /**
   * Записывает круг порции: автору он показан одним списком, а в фильтре задан
   * либо точным кругом, либо потолком.
   *
   * @param row - порция заклинаний
   * @param value - значение селекта
   */
  function setLevel(row: EditableSpellPickRow, value: string): void {
    const parsed = parseSpellPickLevelValue(value);

    row.mode = parsed.mode;
    row.level = parsed.level;
  }

  /**
   * Значение селекта времени накладывания: «любое» хранится пустой строкой, а
   * селекту нужен непустой признак (пустая строка у `reka-ui` — сброс выбора).
   *
   * @param value - значение поля фильтра
   */
  function toSelectValue(value: string): string {
    return value || NO_SELECTION;
  }

  /**
   * Записывает время накладывания: признак «любое» ложится пустой строкой.
   *
   * @param row - порция заклинаний
   * @param value - значение селекта
   */
  function setCastingTime(row: EditableSpellPickRow, value: string): void {
    row.castingTime = value === NO_SELECTION ? '' : value;
  }

  function addRow(): void {
    const taken = new Set([
      ...props.takenKeys,
      ...block.value.picks.map((row) => row.key),
    ]);

    block.value = {
      ...block.value,
      picks: [...block.value.picks, createSpellPickRow(taken)],
    };
  }

  function removeRow(index: number): void {
    block.value = {
      ...block.value,
      picks: block.value.picks.filter((_, rowIndex) => rowIndex !== index),
    };
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="flex items-center gap-1 text-xs text-dimmed">
      {{ SPELL_CHOICE_LABELS.hint }}
      <FieldHint :text="SPELL_CHOICE_LABELS.hintDetails" />
    </p>

    <UFormField>
      <template #label>
        <span class="flex items-center gap-1">
          {{ SPELL_CHOICE_LABELS.classes }}
          <FieldHint :text="SPELL_CHOICE_LABELS.classesHint" />
        </span>
      </template>

      <USelectMenu
        :model-value="block.classKeys"
        :items="classOptions"
        value-key="value"
        label-key="label"
        multiple
        :placeholder="SPELL_CHOICE_LABELS.anyClass"
        class="w-full"
        @update:model-value="setClasses"
      />
    </UFormField>

    <p
      v-if="!block.picks.length"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ SPELL_CHOICE_LABELS.empty }}
    </p>

    <div
      v-for="(row, index) in block.picks"
      :key="row.uid"
      class="flex flex-col gap-2 rounded-lg border border-default bg-elevated/40 p-3"
    >
      <div class="flex flex-wrap items-end gap-2">
        <UFormField
          :label="SPELL_CHOICE_LABELS.level"
          class="w-52"
        >
          <USelect
            :model-value="getSpellPickLevelValue(row)"
            :items="SPELL_PICK_LEVEL_OPTIONS"
            value-key="value"
            label-key="label"
            class="w-full"
            @update:model-value="setLevel(row, $event)"
          />
        </UFormField>

        <UFormField
          :label="SPELL_CHOICE_LABELS.count"
          class="w-24"
        >
          <UInputNumber
            v-model="row.count"
            :min="1"
            :max="10"
            :disabled="row.countEqualsProficiencyBonus"
            class="w-full"
          />
        </UFormField>

        <div class="mb-2 flex items-center gap-1">
          <UCheckbox
            v-model="row.countEqualsProficiencyBonus"
            :label="SPELL_CHOICE_LABELS.countEqualsProficiencyBonus"
          />

          <FieldHint
            :text="SPELL_CHOICE_LABELS.countEqualsProficiencyBonusHint"
          />
        </div>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          class="mb-2 ml-auto"
          :aria-label="SPELL_CHOICE_LABELS.remove"
          @click.left.exact.prevent="removeRow(index)"
        />
      </div>

      <UFormField :label="SPELL_CHOICE_LABELS.label">
        <UInput
          v-model="row.label"
          :placeholder="SPELL_CHOICE_LABELS.labelPlaceholder"
          class="w-full"
        />
      </UFormField>

      <!-- Школа и время накладывания нужны единицам черт, поэтому скрыты -->
      <UButton
        v-if="!isFilterShown(row)"
        icon="tabler:filter"
        color="neutral"
        variant="link"
        size="xs"
        class="self-start"
        :label="SPELL_CHOICE_LABELS.filterTitle"
        @click.left.exact.prevent="showFilter(row)"
      />

      <FormSection
        v-else
        :title="SPELL_CHOICE_LABELS.filterTitle"
        icon="tabler:filter-filled"
        :hint="SPELL_CHOICE_LABELS.filterHint"
      >
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <UFormField :label="SPELL_CHOICE_LABELS.schools">
            <USelectMenu
              v-model="row.schools"
              :items="schoolOptions"
              value-key="value"
              label-key="label"
              multiple
              :placeholder="SPELL_CHOICE_LABELS.anySchool"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="SPELL_CHOICE_LABELS.castingTime">
            <USelect
              :model-value="toSelectValue(row.castingTime)"
              :items="castingTimeOptions"
              value-key="value"
              label-key="label"
              class="w-full"
              @update:model-value="setCastingTime(row, $event)"
            />
          </UFormField>
        </div>
      </FormSection>
    </div>

    <UButton
      icon="tabler:plus"
      :label="SPELL_CHOICE_LABELS.add"
      color="primary"
      variant="soft"
      block
      @click.left.exact.prevent="addRow"
    />
  </div>
</template>
