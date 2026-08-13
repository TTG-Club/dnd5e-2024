<script setup lang="ts">
  import type {
    EditableCounter,
    EditableProgressionEntry,
  } from './classEditorTypes';

  import { computed } from 'vue';

  import { generateId } from '@vtt/shared';

  import {
    CLASS_COUNTER_DEFAULT_NAME,
    CLASS_COUNTERS_LABELS,
    FORM_FIELD_LABELS,
  } from '../constants';
  import { RECOVERY_OPTIONS } from './classEditorTypes';

  const props = defineProps<{
    /** Особенности (для привязки счётчика к особенности по ключу). */
    featureOptions?: { value: string; label: string }[];
  }>();

  /** Список счётчиков классовых ресурсов. */
  const counters = defineModel<EditableCounter[]>({ required: true });

  const modeOptions = [
    { value: 'progression', label: CLASS_COUNTERS_LABELS.sourceTable },
    { value: 'formula', label: CLASS_COUNTERS_LABELS.sourceFormula },
  ];

  const featureSelectOptions = computed(() => [
    { value: '', label: CLASS_COUNTERS_LABELS.featureNone },
    ...(props.featureOptions ?? []),
  ]);

  /** Добавляет новый счётчик. */
  function addCounter(): void {
    counters.value.push({
      key: generateId('cnt'),
      name: '',
      shortName: '',
      nameEn: '',
      description: '',
      startLevel: 1,
      recovery: 'long',
      mode: 'progression',
      progression: [],
      formula: 'level',
      featureKey: '',
    });
  }

  /** Удаляет счётчик по индексу. */
  function removeCounter(index: number): void {
    counters.value.splice(index, 1);
  }

  /** Добавляет ступень прогрессии к счётчику. */
  function addProgression(counter: EditableCounter): void {
    const entry: EditableProgressionEntry = {
      uid: generateId('cpe'),
      level: counter.startLevel,
      value: 1,
    };

    counter.progression.push(entry);
  }

  /** Удаляет ступень прогрессии по индексу. */
  function removeProgression(counter: EditableCounter, index: number): void {
    counter.progression.splice(index, 1);
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="(counter, counterIndex) in counters"
      :key="counter.key"
      class="flex flex-col gap-3 rounded-lg border border-default bg-elevated/20 p-3"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-highlighted">
          {{ counter.name || CLASS_COUNTER_DEFAULT_NAME }}
        </span>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          class="ml-auto"
          :aria-label="CLASS_COUNTERS_LABELS.removeCounter"
          @click.left.exact.prevent="removeCounter(counterIndex)"
        />
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <UFormField :label="FORM_FIELD_LABELS.name">
          <UInput
            v-model="counter.name"
            :placeholder="CLASS_COUNTERS_LABELS.namePlaceholder"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="CLASS_COUNTERS_LABELS.shortName">
          <UInput
            v-model="counter.shortName"
            :placeholder="CLASS_COUNTERS_LABELS.shortNamePlaceholder"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="CLASS_COUNTERS_LABELS.nameEnShort">
          <UInput
            v-model="counter.nameEn"
            placeholder="Rage"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="CLASS_COUNTERS_LABELS.startLevel">
          <UInputNumber
            v-model="counter.startLevel"
            :min="1"
            :max="20"
          />
        </UFormField>

        <UFormField :label="FORM_FIELD_LABELS.recovery">
          <USelect
            v-model="counter.recovery"
            :items="RECOVERY_OPTIONS"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="CLASS_COUNTERS_LABELS.feature">
          <USelect
            v-model="counter.featureKey"
            :items="featureSelectOptions"
            value-key="value"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField :label="FORM_FIELD_LABELS.description">
        <UTextarea
          v-model="counter.description"
          :rows="2"
          autoresize
          :placeholder="CLASS_COUNTERS_LABELS.descriptionPlaceholder"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="CLASS_COUNTERS_LABELS.maxSource">
        <USelect
          v-model="counter.mode"
          :items="modeOptions"
          value-key="value"
          class="w-full sm:w-1/2"
        />
      </UFormField>

      <!-- Таблица прогрессии -->
      <div
        v-if="counter.mode === 'progression'"
        class="flex flex-col gap-2"
      >
        <div
          v-for="(entry, entryIndex) in counter.progression"
          :key="entry.uid"
          class="flex items-center gap-2"
        >
          <span class="text-xs text-muted">
            {{ FORM_FIELD_LABELS.level }}
          </span>

          <UInputNumber
            v-model="entry.level"
            :min="1"
            :max="20"
            class="w-22.5"
          />

          <span class="text-xs text-muted">{{
            CLASS_COUNTERS_LABELS.maxArrow
          }}</span>

          <UInputNumber
            v-model="entry.value"
            :min="0"
            :max="999"
            class="w-25"
          />

          <UButton
            icon="tabler:trash"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="CLASS_COUNTERS_LABELS.removeStep"
            @click.left.exact.prevent="removeProgression(counter, entryIndex)"
          />
        </div>

        <UButton
          icon="tabler:plus"
          :label="CLASS_COUNTERS_LABELS.addStep"
          color="neutral"
          variant="soft"
          size="xs"
          class="self-start"
          @click.left.exact.prevent="addProgression(counter)"
        />

        <p class="text-[11px] text-dimmed">
          {{ CLASS_COUNTERS_LABELS.stepsHint }}
        </p>
      </div>

      <!-- Формула -->
      <UFormField
        v-else
        :label="CLASS_COUNTERS_LABELS.formulaPlaceholder"
      >
        <UInput
          v-model="counter.formula"
          placeholder="level"
          class="w-full sm:w-1/2"
        />
      </UFormField>
    </div>

    <UButton
      icon="tabler:plus"
      :label="CLASS_COUNTERS_LABELS.addCounter"
      color="primary"
      variant="soft"
      size="xs"
      class="self-start"
      @click.left.exact.prevent="addCounter"
    />
  </div>
</template>
