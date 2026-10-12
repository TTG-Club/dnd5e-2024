<script setup lang="ts">
  import type { MissingSheetSectionKey } from '../constants';
  import type { GrantRemovalOption } from './grantRemovalPlan';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  import { MODAL_BUTTON_LABELS } from '../constants';
  import {
    GRANT_REMOVAL_GROUP_LABELS,
    GRANT_REMOVAL_LABELS,
    GRANT_REMOVAL_TITLES,
  } from './constants';
  import { GRANT_REMOVAL_GROUPS } from './grantRemovalPlan';

  /**
   * Окно удаления класса, вида или предыстории: что из выданного убрать с
   * листа вместе с записью.
   *
   * Особенности, владения и эффекты уходят всегда, а заклинания и стартовые
   * предметы игрок мог успеть сделать своими — про них окно и спрашивает.
   * Изначально отмечено всё: удаление записи по умолчанию забирает её дары.
   */
  interface Props {
    open: boolean;
    /** Что удаляется — от этого зависит заголовок */
    kind: MissingSheetSectionKey;
    /** Заклинания и предметы, которые можно убрать вместе с записью */
    options: GrantRemovalOption[];
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'confirm': [selectedIds: string[]];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Ключи строк, отмеченных к удалению */
  const selectedIds = ref(new Set<string>());

  /** Разделы окна, в которых есть хоть одна строка */
  const groups = computed(() =>
    GRANT_REMOVAL_GROUPS.map((group) => ({
      key: group,
      label: GRANT_REMOVAL_GROUP_LABELS[group],
      options: props.options.filter((option) => option.group === group),
    })).filter((group) => group.options.length > 0),
  );

  /** Отмечено ли всё: от этого зависит надпись общей кнопки */
  const isAllSelected = computed(
    () => selectedIds.value.size === props.options.length,
  );

  /** Надпись общей кнопки отметки */
  const toggleAllLabel = computed(() =>
    isAllSelected.value
      ? GRANT_REMOVAL_LABELS.selectNone
      : GRANT_REMOVAL_LABELS.selectAll,
  );

  // Каждое открытие начинается с полного набора: прошлый выбор относился к
  // другой записи
  watch(
    [() => props.open, () => props.options],
    ([open, options]) => {
      if (open) {
        selectedIds.value = new Set(options.map((option) => option.id));
      }
    },
    { immediate: true },
  );

  /**
   * Переключает отметку строки.
   *
   * @param optionId - ключ строки
   */
  function toggleOption(optionId: string): void {
    const next = new Set(selectedIds.value);

    if (!next.delete(optionId)) {
      next.add(optionId);
    }

    selectedIds.value = next;
  }

  /** Отмечает всё либо снимает все отметки */
  function toggleAll(): void {
    selectedIds.value = isAllSelected.value
      ? new Set()
      : new Set(props.options.map((option) => option.id));
  }

  /** Закрывает окно, ничего не удаляя */
  function cancelRemoval(): void {
    isOpen.value = false;
  }

  /** Отдаёт выбор наверх и закрывает окно */
  function confirmRemoval(): void {
    emit('confirm', [...selectedIds.value]);

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="420"
    :min-height="240"
    :title="GRANT_REMOVAL_TITLES[kind]"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ GRANT_REMOVAL_LABELS.alwaysRemovedHint }}
        </p>

        <div class="flex justify-end">
          <UButton
            variant="link"
            color="neutral"
            size="xs"
            :label="toggleAllLabel"
            @click.left.exact.prevent="toggleAll"
          />
        </div>

        <div
          v-for="group in groups"
          :key="group.key"
          class="space-y-1"
        >
          <span class="block text-sm font-medium text-toned">
            {{ group.label }}
          </span>

          <div
            v-for="option in group.options"
            :key="option.id"
            class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
          >
            <span class="flex-1 truncate text-sm text-toned">
              {{ option.name }}
            </span>

            <UCheckbox
              :model-value="selectedIds.has(option.id)"
              @update:model-value="toggleOption(option.id)"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            :label="MODAL_BUTTON_LABELS.cancel"
            @click.left.exact.prevent="cancelRemoval"
          />

          <UButton
            color="error"
            :label="MODAL_BUTTON_LABELS.remove"
            @click.left.exact.prevent="confirmRemoval"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
