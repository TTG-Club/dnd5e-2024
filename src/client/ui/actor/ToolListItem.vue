<script setup lang="ts">
  import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { formatItemCost } from '@vtt/shared';

  import { useContextMenu } from '../../composables/useContextMenu';
  import { useListRowClass } from '../../composables/useListRowClass';
  import { GAME_ITEM_MIME, WEIGHT_UNIT_LABEL } from './constants';
  import ContextMenuOverlay from './ContextMenuOverlay.vue';
  import EntityRowBody from './EntityRowBody.vue';

  const props = defineProps<{
    /** Данные предмета */
    item: DnDGameItem;
    /** Показывать «Скопировать в предметы» в контекстном меню */
    showCopy?: boolean;
    /** Показывать «Редактировать» в контекстном меню */
    showEdit?: boolean;
    /** Показывать «Удалить» в контекстном меню */
    showDelete?: boolean;
    /** Показывать стоимость (по умолчанию true) */
    showCost?: boolean;
    /** Показывать вес (по умолчанию true) */
    showWeight?: boolean;
    /**
     * Плоская строка списка: без своей плашки и скругления. Так строка встаёт в
     * список с разделителями (компендиум и окна выбора); на листе персонажа
     * строки стоят порознь, и плашка им нужна.
     */
    flat?: boolean;
  }>();

  /** Оформление строки: плоская в списке, плашкой на листе персонажа */
  const rowClass = useListRowClass(() => Boolean(props.flat));

  const emit = defineEmits<{
    /** Клик по строке (открыть детальник) */
    click: [];
    /** Скопировать в предметы */
    copy: [];
    /** Редактировать */
    edit: [];
    /** Удалить */
    delete: [];
  }>();

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit);

  /**
   * Начинает перетаскивание предмета (D&D на актёра)
   */
  function handleDragStart(event: DragEvent, item: DnDGameItem): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(GAME_ITEM_MIME, JSON.stringify(item));
  }
</script>

<template>
  <div
    draggable="true"
    class="flex cursor-grab items-center gap-3 py-2 transition-colors active:cursor-grabbing"
    :class="rowClass"
    @click.left.exact.prevent="$emit('click')"
    @contextmenu="openContextMenu"
    @dragstart="handleDragStart($event, item)"
  >
    <!-- Строка списка: название с английским и источник справа -->
    <EntityRowBody
      v-if="flat"
      :name="item.name"
      :name-en="item.nameEn"
      :source-key="item.sourceKey"
      :source="item.source"
    />

    <!-- Строка листа персонажа: показатели важнее книги, из которой запись -->
    <template v-else>
      <!-- Название -->
      <span class="flex-1 truncate text-sm font-medium text-highlighted">
        {{ item.name }}
      </span>

      <!-- Бонус badge -->
      <UBadge
        v-if="item.toolBonus"
        color="neutral"
        variant="subtle"
        size="sm"
        class="shrink-0 font-mono"
      >
        +{{ item.toolBonus }}
      </UBadge>

      <!-- Стоимость -->
      <span
        v-if="item.cost && (showCost ?? true)"
        class="shrink-0 text-xs text-primary/80"
      >
        {{ formatItemCost(item.cost) }}
      </span>

      <!-- Вес -->
      <span
        v-if="item.weight && (showWeight ?? true)"
        class="shrink-0 text-xs text-dimmed"
      >
        {{ item.weight }} {{ WEIGHT_UNIT_LABEL }}
      </span>
    </template>
  </div>

  <ContextMenuOverlay
    :is-open="isMenuOpen"
    :pos-x="menuX"
    :pos-y="menuY"
    :show-copy="showCopy"
    :show-edit="showEdit"
    :show-delete="showDelete"
    @action="handleAction"
    @close="closeMenu"
  />
</template>
