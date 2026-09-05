<script setup lang="ts">
  import type { BackgroundDefinition } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { useContextMenu } from '../../../composables/useContextMenu';
  import { useListRowClass } from '../../../composables/useListRowClass';
  import {
    BACKGROUND_DEFINITION_MIME,
    BACKGROUND_LIST_ITEM_LABELS,
  } from '../constants';
  import ContextMenuOverlay from '../ContextMenuOverlay.vue';
  import EntityRowBody from '../EntityRowBody.vue';
  import SourceBadge from '../SourceBadge.vue';

  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    backgroundDefinition?: BackgroundDefinition;
    item?: BackgroundDefinition;
    /** Пак записи: уходит на лист вместе с определением при переносе */
    packId?: string;
    showEdit?: boolean;
    showDelete?: boolean;
    showCopy?: boolean;
    showCost?: boolean;
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

  const data = computed(() => props.item ?? props.backgroundDefinition!);

  const emit = defineEmits<{
    click: [];
    edit: [];
    delete: [];
    copy: [];
  }>();

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit);

  function onDragStart(event: DragEvent) {
    if (event.dataTransfer) {
      // Вместе с паком: одноимённая предыстория есть и в соседнем компендиуме,
      // и лист должен взять ту копию, которую тянут
      event.dataTransfer.setData(
        BACKGROUND_DEFINITION_MIME,
        JSON.stringify({ definition: data.value, packId: props.packId }),
      );

      event.dataTransfer.effectAllowed = 'copy';
    }
  }
</script>

<template>
  <div
    v-bind="$attrs"
    draggable="true"
    class="flex cursor-grab items-center gap-3 py-2 transition-colors active:cursor-grabbing"
    :class="rowClass"
    @dragstart="onDragStart"
    @click.left.exact.prevent="emit('click')"
    @contextmenu="openContextMenu"
  >
    <!-- Строка списка: название, английское название и источник справа -->
    <EntityRowBody
      v-if="flat"
      :name="data.name"
      :name-en="data.nameEn"
      :source-key="data.sourceKey"
      :source="data.source"
    />

    <div
      v-else
      class="min-w-0 flex-1"
    >
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-medium text-highlighted">
          {{ data.name }}
        </span>
      </div>

      <div class="mt-0.5 flex items-center gap-3 text-xs text-muted">
        <SourceBadge
          :source-key="data.sourceKey"
          :source="data.source"
          variant="text"
        />

        <span v-if="data.skillGrant?.skills?.length">
          {{ BACKGROUND_LIST_ITEM_LABELS.skills }}
        </span>

        <span
          v-if="
            data.skillGrant?.skills?.length
            && (data.featGrant?.featName || data.featGrant?.featChoices?.length)
          "
          class="text-dimmed"
        >
          &bull;
        </span>

        <span
          v-if="data.featGrant?.featName"
          class="truncate"
        >
          {{ data.featGrant.featName }}
        </span>

        <span
          v-else-if="data.featGrant?.featChoices?.length"
          class="truncate"
        >
          {{ BACKGROUND_LIST_ITEM_LABELS.featChoice }}
        </span>
      </div>
    </div>
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
