<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableSubclass } from './classEditorTypes';

  import { computed, ref } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import { generateId } from '@vtt/shared';

  import {
    CLASS_SUBCLASS_DEFAULT_NAME,
    CLASS_SUBCLASSES_LABELS,
    FORM_FIELD_LABELS,
  } from '../constants';
  import SourceField from '../SourceField.vue';
  import ClassCountersEditor from './ClassCountersEditor.vue';
  import {
    createEmptyLevelTable,
    createEmptySpellcasting,
  } from './classEditorTypes';
  import ClassFeaturesEditor from './ClassFeaturesEditor.vue';
  import ClassLevelTableEditor from './ClassLevelTableEditor.vue';
  import ClassSpellcastingFields from './ClassSpellcastingFields.vue';

  const props = defineProps<{
    /** Заклинания компендиума по пакам — для подсказок связывания. */
    availableSpells?: SpellOption[];
    /**
     * Сокет для окна выбора заклинания из компендиума. Без него добавить
     * заклинание нечем: другого способа завести запись у редактора нет.
     */
    socket?: TypedWebSocketClient | null;
    /** Уровень получения подкласса из базового класса (по умолч. unlockLevel). */
    subclassLevel: number;
  }>();

  /** Список подклассов. */
  const subclasses = defineModel<EditableSubclass[]>({ required: true });

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  /** Индекс выбранного подкласса (-1 — ничего не выбрано). */
  const selectedIndex = ref(-1);

  const selected = computed<EditableSubclass | null>(
    () => subclasses.value[selectedIndex.value] ?? null,
  );

  /** Особенности выбранного подкласса как опции привязки счётчиков. */
  const featureOptions = computed(() =>
    (selected.value?.features ?? [])
      .filter((feature) => feature.name.trim().length > 0)
      .map((feature) => ({ value: feature.key, label: feature.name })),
  );

  /** Добавляет подкласс и выбирает его. */
  function addSubclass(): void {
    subclasses.value.push({
      key: generateId('sub'),
      name: '',
      nameEn: '',
      description: '',
      unlockLevel: props.subclassLevel,
      sourceKey: '',
      features: [],
      counters: [],
      spellcasting: createEmptySpellcasting(),
      hasOwnTable: false,
      tableColumns: [],
      levelTable: createEmptyLevelTable(),
    });

    selectedIndex.value = subclasses.value.length - 1;
  }

  /** Удаляет подкласс по индексу. */
  function removeSubclass(index: number): void {
    subclasses.value.splice(index, 1);

    if (selectedIndex.value >= subclasses.value.length) {
      selectedIndex.value = subclasses.value.length - 1;
    }
  }

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Список подклассов -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-for="(subclass, index) in subclasses"
        :key="subclass.key"
        :label="subclass.name || CLASS_SUBCLASSES_LABELS.fallbackName"
        :color="index === selectedIndex ? 'primary' : 'neutral'"
        :variant="index === selectedIndex ? 'solid' : 'soft'"
        size="xs"
        @click.left.exact.prevent="selectedIndex = index"
      />

      <UButton
        icon="tabler:plus"
        :label="CLASS_SUBCLASSES_LABELS.fallbackName"
        color="primary"
        variant="soft"
        size="xs"
        @click.left.exact.prevent="addSubclass"
      />
    </div>

    <div
      v-if="!selected"
      class="rounded-lg border border-dashed border-default p-4 text-center text-xs text-dimmed italic"
    >
      {{ CLASS_SUBCLASSES_LABELS.empty }}
    </div>

    <!-- Детали выбранного подкласса -->
    <div
      v-else
      class="flex flex-col gap-4 rounded-lg border border-default bg-elevated/20 p-3"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-highlighted">
          {{ selected.name || CLASS_SUBCLASS_DEFAULT_NAME }}
        </span>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          class="ml-auto"
          :label="CLASS_SUBCLASSES_LABELS.remove"
          @click.left.exact.prevent="removeSubclass(selectedIndex)"
        />
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <UFormField :label="FORM_FIELD_LABELS.name">
          <UInput
            v-model="selected.name"
            :placeholder="CLASS_SUBCLASSES_LABELS.namePlaceholder"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="CLASS_SUBCLASSES_LABELS.nameEnShort">
          <UInput
            v-model="selected.nameEn"
            placeholder="Champion"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="CLASS_SUBCLASSES_LABELS.level">
          <UInputNumber
            v-model="selected.unlockLevel"
            :min="1"
            :max="20"
          />
        </UFormField>

        <SourceField
          v-model:source-key="selected.sourceKey"
          v-model:source="selected.source"
          class="col-span-2"
        />
      </div>

      <UFormField :label="FORM_FIELD_LABELS.descriptionMarkdown">
        <RichTextEditor v-model="selected.description" />
      </UFormField>

      <UFormField :label="CLASS_SUBCLASSES_LABELS.spellcasting">
        <ClassSpellcastingFields v-model="selected.spellcasting" />
      </UFormField>

      <UFormField :label="CLASS_SUBCLASSES_LABELS.features">
        <ClassFeaturesEditor
          v-model="selected.features"
          :available-spells="availableSpells"
          :socket="socket"
          @open-spell="forwardOpenSpell"
        />
      </UFormField>

      <UFormField :label="CLASS_SUBCLASSES_LABELS.counters">
        <ClassCountersEditor
          v-model="selected.counters"
          :feature-options="featureOptions"
        />
      </UFormField>

      <UCheckbox
        v-model="selected.hasOwnTable"
        :label="CLASS_SUBCLASSES_LABELS.ownTable"
      />

      <ClassLevelTableEditor
        v-if="selected.hasOwnTable"
        v-model:rows="selected.levelTable"
        v-model:columns="selected.tableColumns"
        :features="selected.features"
        :is-caster="selected.spellcasting.enabled"
      />
    </div>
  </div>
</template>
