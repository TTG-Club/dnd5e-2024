<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type {
    EditableSpellChoiceBlock,
    EditableSpellPickRow,
    SpellPickSource,
  } from './featEditorTypes';

  import { computed, ref } from 'vue';

  import {
    CASTING_TIME_OPTIONS,
    CLASS_KEY_OPTIONS,
    RITUAL_CASTING_TIME,
    SPELL_SCHOOL_OPTIONS,
  } from '@vtt/shared/system/dnd.js';

  import { NO_SELECTION, SPELL_CHOICE_LABELS } from '../constants';
  import FieldHint from '../FieldHint.vue';
  import FormSection from '../FormSection.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';
  import {
    createSpellPickRow,
    getSpellPickLevelValue,
    parseSpellPickLevelValue,
    SPELL_PICK_LEVEL_OPTIONS,
  } from './featEditorTypes';

  /**
   * Заклинания, которые игрок выбирает сам при взятии записи.
   *
   * Пул порции собирается двумя способами. Поиском по компендиуму — по кругу и
   * спискам классов блока: список классов один на все такие порции, «Посвящённый
   * в магию» спрашивает класс один раз и берёт из него и заговоры, и заклинание
   * первого круга. Либо перечислением конкретных заклинаний — тогда круг и класс
   * у каждой записи свои, и порция их не спрашивает. Служебный выбор класса и
   * ссылку на него форма пишет сама — автору о них знать незачем.
   *
   * У порции есть уровень: «Таинственный арканум» спрашивает заклинание 6 круга
   * на 11 уровне, 7 круга — на 13, и без уровня мастер задал бы все вопросы разом.
   */
  const block = defineModel<EditableSpellChoiceBlock>({ required: true });

  const props = withDefaults(
    defineProps<{
      /** Ключи выборов, уже занятые чертой (включая вкладку владений) */
      takenKeys?: string[];
      /** Заклинания компендиума по пакам — для перечисленного пула */
      availableSpells?: SpellOption[];
      /** WebSocket-клиент: выбор заклинания из компендиума окном */
      socket?: TypedWebSocketClient | null;
    }>(),
    { takenKeys: () => [], availableSpells: () => [], socket: null },
  );

  const emit = defineEmits<{
    /** Открыть детальный просмотр заклинания (id + предпочтённый пак) */
    'open-spell': [spellId: string, packId?: string];
  }>();

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

  /** Откуда порция берёт пул — варианты селекта. */
  const sourceOptions: { value: SpellPickSource; label: string }[] = [
    { value: 'filter', label: SPELL_CHOICE_LABELS.sourceFilter },
    { value: 'list', label: SPELL_CHOICE_LABELS.sourceList },
  ];

  /** Порции, у которых автор раскрыл уточнение фильтра. */
  const expandedRows = ref<Set<string>>(new Set());

  /**
   * Списки классов спрашиваются, только пока есть порция с поиском по кругу:
   * они и есть её фильтр, а хранятся внутри самой порции. У записи, где все
   * порции перечисляют заклинания, классам негде лежать — поле сохранило бы
   * выбранное только до перезагрузки формы.
   */
  const isClassesShown = computed(() =>
    block.value.picks.some((row) => row.source === 'filter'),
  );

  /**
   * Порция берёт пул из перечисленных заклинаний, а не поиском.
   *
   * @param row - порция заклинаний
   */
  function isListSource(row: EditableSpellPickRow): boolean {
    return row.source === 'list';
  }

  /**
   * Показывать ли уточнение фильтра. Нужно оно единицам черт, поэтому по
   * умолчанию скрыто — но у порции, где школа или время уже заданы записью,
   * скрывать их значило бы прятать от автора работающее ограничение. У
   * перечисленного пула фильтра нет вовсе.
   *
   * @param row - порция заклинаний
   */
  function isFilterShown(row: EditableSpellPickRow): boolean {
    return (
      !isListSource(row)
      && (expandedRows.value.has(row.uid)
        || row.schools.length > 0
        || !!row.castingTime)
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
   * Уровень открытия для поля: ноль в модели значит «сразу», и полю он показан
   * пустым — подсказкой, а не нулём.
   *
   * @param row - порция заклинаний
   */
  function getRequiredLevel(row: EditableSpellPickRow): number | undefined {
    return row.requiredLevel > 0 ? row.requiredLevel : undefined;
  }

  /**
   * Записывает уровень открытия; пустое поле — «сразу».
   *
   * @param row - порция заклинаний
   * @param value - уровень персонажа
   */
  function setRequiredLevel(
    row: EditableSpellPickRow,
    value: number | undefined,
  ): void {
    row.requiredLevel = value ?? 0;
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

  /**
   * Пробрасывает просмотр заклинания наверх: списком владеет форма, и окно
   * записи открывает она же.
   *
   * @param spellId - id заклинания компендиума
   * @param packId - предпочтённый пак
   */
  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }

  /**
   * Заводит порцию выбора. Наружу — кнопка добавления живёт в шапке раздела, а
   * занятые ключи выборов известны только здесь.
   */
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

  defineExpose({ addRow });
</script>

<template>
  <div class="flex flex-col gap-3">
    <UFormField v-if="isClassesShown">
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

    <div
      v-for="(row, index) in block.picks"
      :key="row.uid"
      class="flex flex-col gap-2 rounded-lg border border-default bg-elevated/40 p-3"
    >
      <div class="flex flex-wrap items-end gap-2">
        <UFormField class="w-60">
          <template #label>
            <span class="flex items-center gap-1">
              {{ SPELL_CHOICE_LABELS.source }}
              <FieldHint :text="SPELL_CHOICE_LABELS.sourceHint" />
            </span>
          </template>

          <USelect
            v-model="row.source"
            :items="sourceOptions"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>

        <!-- У перечисленных заклинаний круг свой у каждой записи: селект круга
          заменяет подпись, чтобы строка не прыгала при смене источника -->
        <UFormField
          :label="SPELL_CHOICE_LABELS.level"
          class="w-52"
        >
          <USelect
            v-if="!isListSource(row)"
            :model-value="getSpellPickLevelValue(row)"
            :items="SPELL_PICK_LEVEL_OPTIONS"
            value-key="value"
            label-key="label"
            class="w-full"
            @update:model-value="setLevel(row, $event)"
          />

          <p
            v-else
            class="py-1.5 text-sm text-dimmed italic"
          >
            {{ SPELL_CHOICE_LABELS.levelFromRecord }}
          </p>
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

        <!-- Уровень — своим полем: «Таинственный арканум» спрашивает 6 круг на
          11 уровне, 7 круг — на 13; без уровня все порции спросили бы разом -->
        <UFormField class="w-28">
          <template #label>
            <span class="flex items-center gap-1">
              {{ SPELL_CHOICE_LABELS.requiredLevel }}
              <FieldHint :text="SPELL_CHOICE_LABELS.requiredLevelHint" />
            </span>
          </template>

          <UInputNumber
            :model-value="getRequiredLevel(row)"
            :min="1"
            :max="20"
            class="w-full"
            :placeholder="SPELL_CHOICE_LABELS.requiredLevelPlaceholder"
            @update:model-value="setRequiredLevel(row, $event)"
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

      <!-- Перечисленный пул: записи только выбираются из компендиума, тем же
        редактором, что и выданные заклинания -->
      <UFormField
        v-if="isListSource(row)"
        :label="SPELL_CHOICE_LABELS.listedSpells"
      >
        <GrantedSpellsEditor
          v-model="row.listedSpells"
          :available-spells="props.availableSpells"
          :socket="props.socket"
          @open-spell="forwardOpenSpell"
        />
      </UFormField>

      <UFormField :label="SPELL_CHOICE_LABELS.label">
        <UInput
          v-model="row.label"
          :placeholder="SPELL_CHOICE_LABELS.labelPlaceholder"
          class="w-full"
        />
      </UFormField>

      <!-- Школа и время накладывания нужны единицам черт, поэтому скрыты -->
      <UButton
        v-if="!isListSource(row) && !isFilterShown(row)"
        icon="tabler:filter"
        color="neutral"
        variant="link"
        size="xs"
        class="self-start"
        :label="SPELL_CHOICE_LABELS.filterTitle"
        @click.left.exact.prevent="showFilter(row)"
      />

      <FormSection
        v-else-if="isFilterShown(row)"
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
  </div>
</template>
