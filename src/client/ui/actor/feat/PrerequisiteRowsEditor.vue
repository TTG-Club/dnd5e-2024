<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { TypedWebSocketClient } from '@vtt/shared';

  import type {
    EditablePrerequisiteRow,
    PrerequisiteRowKind,
  } from './featEditorTypes';

  import { computed } from 'vue';

  import { ABILITY_OPTIONS } from '@vtt/shared/system/dnd.js';

  import {
    ARMOR_PROF_LABELS,
    FEAT_GRANTS_LABELS,
    SCROLLABLE_DROPDOWN_UI,
  } from '../constants';
  import FieldHint from '../FieldHint.vue';
  import EntityRefRows from './EntityRefRows.vue';
  import {
    CLASS_FEATURE_REQUIREMENT_OPTIONS,
    createPrerequisiteRow,
    isRefPrerequisite,
    PREREQUISITE_ROW_KIND_OPTIONS,
  } from './featEditorTypes';

  /**
   * Редактор требований черты: одна строка — одно требование. Внутри строки
   * значения соединяются по «ИЛИ» (одна характеристика читается как «Сила 13+»,
   * несколько — как «Сила или Ловкость 13+»), сами строки — по «И».
   *
   * Требования вида «нужен уровень» или «нужно заклинательство» значений не
   * имеют: сама строка и есть требование, полей у неё нет.
   */
  const rows = defineModel<EditablePrerequisiteRow[]>({ required: true });

  withDefaults(
    defineProps<{
      /** WebSocket-клиент: выбор требуемых записей из компендиума */
      socket?: TypedWebSocketClient | null;
    }>(),
    { socket: null },
  );

  /** Тип записей компендиума для строки-ссылки. */
  const REF_KINDS: Record<string, string> = {
    feat: 'feat',
    class: 'class',
    species: 'species',
    background: 'background',
  };

  const abilityOptions = ABILITY_OPTIONS.map((ability) => ({
    value: ability.value,
    label: ability.label,
  }));

  const armorOptions = Object.entries(ARMOR_PROF_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  /** Меню «Добавить требование». */
  const addMenuItems: DropdownMenuItem[][] = [
    PREREQUISITE_ROW_KIND_OPTIONS.map((option) => ({
      label: option.label,
      onSelect: () => addRow(option.value),
    })),
  ];

  function addRow(kind: PrerequisiteRowKind): void {
    rows.value = [...rows.value, createPrerequisiteRow(kind)];
  }

  function removeRow(index: number): void {
    rows.value = rows.value.filter((_, rowIndex) => rowIndex !== index);
  }

  /** Подпись строки — она же подпись вида требования. */
  function rowLabel(row: EditablePrerequisiteRow): string {
    return (
      PREREQUISITE_ROW_KIND_OPTIONS.find((option) => option.value === row.kind)
        ?.label ?? row.kind
    );
  }

  /** Требование без полей: сама строка и есть условие. */
  function isFlagRow(row: EditablePrerequisiteRow): boolean {
    return row.kind === 'spellcasting' || row.kind === 'anyDragonmark';
  }

  /** Требования без значений — они рисуются компактной строкой. */
  const flagRows = computed(() => rows.value.filter(isFlagRow));

  /** Остальные требования — со своими полями под подписью. */
  const valueRows = computed(() => rows.value.filter((row) => !isFlagRow(row)));

  /**
   * Номер строки в общем списке: список разделён на две группы, а удаление
   * работает по исходному номеру.
   *
   * @param row - строка требования
   */
  function indexOf(row: EditablePrerequisiteRow): number {
    return rows.value.indexOf(row);
  }

  /** Требование свободным текстом (сеттинг либо произвольная строка). */
  function isTextRow(row: EditablePrerequisiteRow): boolean {
    return row.kind === 'campaign' || row.kind === 'text';
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="flex items-center gap-1 text-xs text-dimmed">
      {{ FEAT_GRANTS_LABELS.prerequisitesHint }}
      <FieldHint :text="FEAT_GRANTS_LABELS.prerequisitesHintDetails" />
    </p>

    <div
      v-if="rows.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ FEAT_GRANTS_LABELS.prerequisitesEmpty }}
    </div>

    <!-- Требование без значений: одна компактная строка, а не пустая колонка -->
    <div
      v-for="row in flagRows"
      :key="row.uid"
      class="flex items-center gap-2 rounded-lg bg-elevated/40 px-3 py-2"
    >
      <UIcon
        name="tabler:check"
        class="size-4 shrink-0 text-primary"
      />

      <span class="min-w-0 flex-1 text-sm">{{ rowLabel(row) }}</span>

      <UButton
        icon="tabler:trash"
        color="error"
        variant="ghost"
        size="xs"
        :aria-label="rowLabel(row)"
        @click.left.exact.prevent="removeRow(indexOf(row))"
      />
    </div>

    <template
      v-for="(row, valueIndex) in valueRows"
      :key="row.uid"
    >
      <!-- Требования складываются: подходить надо всем сразу -->
      <div
        v-if="valueIndex > 0 || flagRows.length > 0"
        class="flex items-center gap-2 px-1"
      >
        <span class="h-px flex-1 bg-accented/40" />

        <span class="text-xs font-semibold tracking-wider text-dimmed">
          {{ FEAT_GRANTS_LABELS.rowsAnd }}
        </span>

        <span class="h-px flex-1 bg-accented/40" />
      </div>

      <div class="flex flex-col gap-1.5 rounded-lg bg-elevated/40 p-2">
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 text-sm font-medium">
            {{ rowLabel(row) }}
          </span>

          <UButton
            icon="tabler:trash"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="rowLabel(row)"
            @click.left.exact.prevent="removeRow(indexOf(row))"
          />
        </div>

        <div class="flex min-w-0 flex-1 items-end gap-2">
          <template v-if="row.kind === 'ability'">
            <UFormField
              :label="FEAT_GRANTS_LABELS.prerequisiteAnyOfAbilities"
              class="min-w-0 flex-1"
            >
              <USelectMenu
                v-model="row.abilities"
                :items="abilityOptions"
                value-key="value"
                label-key="label"
                multiple
                size="sm"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="FEAT_GRANTS_LABELS.prerequisiteAnyOfMinValue"
              class="w-24"
            >
              <UInputNumber
                v-model="row.minValue"
                :min="1"
                :max="20"
                size="sm"
                class="w-full"
              />
            </UFormField>
          </template>

          <UFormField
            v-else-if="row.kind === 'level'"
            class="w-28"
          >
            <UInputNumber
              v-model="row.minValue"
              :min="1"
              :max="20"
              size="sm"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-else-if="row.kind === 'classFeature'"
            class="min-w-0 flex-1"
          >
            <USelectMenu
              v-model="row.classFeatures"
              :items="CLASS_FEATURE_REQUIREMENT_OPTIONS"
              value-key="value"
              label-key="label"
              multiple
              size="sm"
              class="w-full"
              :placeholder="
                FEAT_GRANTS_LABELS.prerequisiteClassFeaturesPlaceholder
              "
            />
          </UFormField>

          <UFormField
            v-else-if="row.kind === 'armorProficiency'"
            class="min-w-0 flex-1"
          >
            <USelectMenu
              v-model="row.armor"
              :items="armorOptions"
              value-key="value"
              label-key="label"
              multiple
              size="sm"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-else-if="isTextRow(row)"
            class="min-w-0 flex-1"
          >
            <UInput
              v-model="row.text"
              :placeholder="
                row.kind === 'campaign'
                  ? FEAT_GRANTS_LABELS.prerequisiteCampaignPlaceholder
                  : FEAT_GRANTS_LABELS.prerequisiteTextPlaceholder
              "
              size="sm"
              class="w-full"
            />
          </UFormField>

          <EntityRefRows
            v-else-if="isRefPrerequisite(row.kind)"
            v-model="row.refs"
            :kind="REF_KINDS[row.kind]"
            :socket="socket"
            class="min-w-0 flex-1"
          />
        </div>
      </div>
    </template>

    <UDropdownMenu
      :items="addMenuItems"
      :content="{ align: 'start' }"
      :ui="SCROLLABLE_DROPDOWN_UI"
    >
      <UButton
        icon="tabler:plus"
        :label="FEAT_GRANTS_LABELS.addPrerequisite"
        color="primary"
        variant="soft"
        block
      />
    </UDropdownMenu>
  </div>
</template>
