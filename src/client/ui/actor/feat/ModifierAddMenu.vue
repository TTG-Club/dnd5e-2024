<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { EditableModifierRow, ModifierRowKind } from './featEditorTypes';

  import { FEAT_GRANTS_LABELS, SCROLLABLE_DROPDOWN_UI } from '../constants';
  import SectionAddButton from '../SectionAddButton.vue';
  import {
    createModifierRow,
    MODIFIER_ROW_KIND_OPTIONS,
  } from './featEditorTypes';

  /**
   * Кнопка добавления модификатора для шапки раздела.
   *
   * Своим компонентом, потому что у модификатора вид выбирают меню, а не одним
   * нажатием: обычная кнопка раздела здесь не подходит, а повторять список
   * видов в каждой форме (черта, класс, умение, вид) значило бы держать четыре
   * копии одного меню.
   */
  const rows = defineModel<EditableModifierRow[]>({ required: true });

  /** Меню «Добавить модификатор»: все виды одним списком. */
  const addMenuItems: DropdownMenuItem[][] = [
    MODIFIER_ROW_KIND_OPTIONS.map((option) => ({
      label: option.label,
      onSelect: () => addRow(option.value),
    })),
  ];

  /**
   * Заводит строку выбранного вида.
   *
   * @param kind - вид правки листа
   */
  function addRow(kind: ModifierRowKind): void {
    rows.value = [...rows.value, createModifierRow(kind)];
  }
</script>

<template>
  <UDropdownMenu
    :items="addMenuItems"
    :content="{ align: 'end' }"
    :ui="SCROLLABLE_DROPDOWN_UI"
  >
    <SectionAddButton :label="FEAT_GRANTS_LABELS.addModifier" />
  </UDropdownMenu>
</template>
