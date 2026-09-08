<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type {
    EditablePrerequisiteRow,
    PrerequisiteRowKind,
  } from './featEditorTypes';

  import { FEAT_GRANTS_LABELS, SCROLLABLE_DROPDOWN_UI } from '../constants';
  import SectionAddButton from '../SectionAddButton.vue';
  import {
    createPrerequisiteRow,
    PREREQUISITE_ROW_KIND_OPTIONS,
  } from './featEditorTypes';

  /**
   * Кнопка добавления требования для шапки раздела: вид требования выбирают
   * меню, а не одним нажатием, и обычная кнопка раздела здесь не подходит.
   */
  const rows = defineModel<EditablePrerequisiteRow[]>({ required: true });

  /** Меню «Добавить требование». */
  const addMenuItems: DropdownMenuItem[][] = [
    PREREQUISITE_ROW_KIND_OPTIONS.map((option) => ({
      label: option.label,
      onSelect: () => addRow(option.value),
    })),
  ];

  /**
   * Заводит строку выбранного вида.
   *
   * @param kind - вид требования
   */
  function addRow(kind: PrerequisiteRowKind): void {
    rows.value = [...rows.value, createPrerequisiteRow(kind)];
  }
</script>

<template>
  <UDropdownMenu
    :items="addMenuItems"
    :content="{ align: 'end' }"
    :ui="SCROLLABLE_DROPDOWN_UI"
  >
    <SectionAddButton :label="FEAT_GRANTS_LABELS.addPrerequisite" />
  </UDropdownMenu>
</template>
