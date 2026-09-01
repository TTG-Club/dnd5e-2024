<script setup lang="ts">
  import type { FeatDisplayItem } from './featListItemTypes';

  import { computed, reactive } from 'vue';

  import { useContextMenu } from '../../composables/useContextMenu';
  import {
    FEAT_LIST_ITEM_LABELS,
    GAME_FEATURE_MIME,
    LIST_ROW_CARD_CLASS,
    LIST_ROW_FLAT_CLASS,
    LIST_ROW_SHEET_FEAT_CLASS,
  } from './constants';
  import ContextMenuOverlay from './ContextMenuOverlay.vue';
  import EntityRowBody from './EntityRowBody.vue';
  import FeatListItemCompendium from './FeatListItemCompendium.vue';
  import FeatListItemSheet from './FeatListItemSheet.vue';

  // Корней у карточки два (сама строка и всплывающее меню), поэтому классы от
  // родителя вешаются на строку вручную: иначе Vue не знает, к какому из корней
  // их прикрепить, и ругается на «Extraneous non-props attributes»
  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    item: FeatDisplayItem;
    showEdit?: boolean;
    showDelete?: boolean;
    showCopy?: boolean;
    showCost?: boolean;
    showWeight?: boolean;
    variant?: 'sheet' | 'compendium';
    /**
     * Плоская строка списка: без своей плашки и скругления. Так строка встаёт в
     * список с разделителями (компендиум и окна выбора); на листе персонажа
     * строки стоят порознь, и плашка им нужна.
     */
    flat?: boolean;
  }>();

  const isSheet = computed(() => props.variant === 'sheet');

  /**
   * Оформление строки. Видов три: на листе персонажа она выше и темнее (там с
   * ней работают руками), в списке — плоская, в остальных местах — плашкой.
   */
  const rowClass = computed(() => {
    if (isSheet.value) {
      return LIST_ROW_SHEET_FEAT_CLASS;
    }

    return props.flat ? LIST_ROW_FLAT_CLASS : LIST_ROW_CARD_CLASS;
  });

  const emit = defineEmits<{
    click: [];
    edit: [];
    delete: [];
    copy: [];
  }>();

  const contextMenuProps = computed(() => ({
    showCopy: isSheet.value ? false : props.showCopy,
    showEdit: isSheet.value ? false : props.showEdit,
    showDelete: isSheet.value ? false : props.showDelete,
  }));

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(
      reactive({
        get showCopy() {
          return contextMenuProps.value.showCopy;
        },
        get showEdit() {
          return contextMenuProps.value.showEdit;
        },
        get showDelete() {
          return contextMenuProps.value.showDelete;
        },
      }),
      emit,
    );

  /**
   * Обработчик начала перетаскивания черты из компендиума.
   * Сериализует объект Feature в dataTransfer.
   * @param event - событие dragstart
   */
  function handleDragStart(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(GAME_FEATURE_MIME, JSON.stringify(props.item));
  }
</script>

<template>
  <div
    v-bind="$attrs"
    draggable="true"
    class="flex cursor-grab items-center gap-3 py-2 transition-colors active:cursor-grabbing"
    :class="rowClass"
    @dragstart="handleDragStart"
    @click.left.exact.prevent="emit('click')"
    @contextmenu="openContextMenu"
  >
    <!-- Вид для листа персонажа -->
    <FeatListItemSheet
      v-if="isSheet"
      :item="item"
      :show-edit="showEdit"
      :show-delete="showDelete"
      @edit="emit('edit')"
      @delete="emit('delete')"
    />

    <!-- Строка списка: название, английское название и источник справа -->
    <EntityRowBody
      v-else-if="flat"
      :name="item.name"
      :name-en="item.nameEn"
      :source-key="item.sourceKey"
      :source="item.source"
    >
      <template #badges>
        <!-- Повторяемость меняет смысл черты, а не уточняет числа -->
        <UBadge
          v-if="item.repeatable"
          color="warning"
          variant="subtle"
          size="sm"
          class="shrink-0"
        >
          {{ FEAT_LIST_ITEM_LABELS.repeatable }}
        </UBadge>
      </template>
    </EntityRowBody>

    <!-- Классический вид для компендиума -->
    <FeatListItemCompendium
      v-else
      :item="item"
    />
  </div>

  <ContextMenuOverlay
    :is-open="isMenuOpen"
    :pos-x="menuX"
    :pos-y="menuY"
    :show-copy="contextMenuProps.showCopy"
    :show-edit="contextMenuProps.showEdit"
    :show-delete="contextMenuProps.showDelete"
    @action="handleAction"
    @close="closeMenu"
  />
</template>
