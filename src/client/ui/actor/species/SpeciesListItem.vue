<script setup lang="ts">
  import type { SpeciesDefinition } from '@vtt/shared/system/dnd.js';

  import { useContextMenu } from '../../../composables/useContextMenu';
  import { useListRowClass } from '../../../composables/useListRowClass';
  import {
    CREATURE_TYPE_LABELS,
    FEET_UNIT_LABEL,
    LIST_ROW_CARD_BORDERED_CLASS,
    SPECIES_DEFINITION_MIME,
    SPECIES_DETAIL_LABELS,
  } from '../constants';
  import ContextMenuOverlay from '../ContextMenuOverlay.vue';
  import EntityRowBody from '../EntityRowBody.vue';

  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    speciesDefinition: SpeciesDefinition;
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
  const rowClass = useListRowClass(
    () => Boolean(props.flat),
    LIST_ROW_CARD_BORDERED_CLASS,
  );

  const emit = defineEmits<{
    click: [];
    edit: [];
    delete: [];
    copy: [];
  }>();

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit);

  function handleDragStart(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';

    event.dataTransfer.setData(
      SPECIES_DEFINITION_MIME,
      JSON.stringify(props.speciesDefinition),
    );
  }
</script>

<template>
  <div
    v-bind="$attrs"
    draggable="true"
    class="group flex cursor-grab items-center gap-3 border border-transparent py-2 transition-colors active:cursor-grabbing"
    :class="rowClass"
    @dragstart="handleDragStart"
    @click.left.exact.prevent="emit('click')"
    @contextmenu="openContextMenu"
  >
    <!-- Строка списка: название, английское название и источник справа -->
    <EntityRowBody
      v-if="flat"
      :name="speciesDefinition.name"
      :name-en="speciesDefinition.nameEn"
      :source-key="speciesDefinition.sourceKey"
      :source="speciesDefinition.source"
    />

    <div
      v-else
      class="min-w-0 flex-1"
    >
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-medium text-highlighted">
          {{ speciesDefinition.name }}
        </span>

        <span class="text-xs text-dimmed">
          {{ speciesDefinition.nameEn }}
        </span>
      </div>

      <div class="flex items-center gap-3 text-xs text-muted">
        <span class="truncate text-primary">
          {{
            CREATURE_TYPE_LABELS[speciesDefinition.creatureType]
            || speciesDefinition.creatureType
          }}
        </span>

        <span>
          {{ SPECIES_DETAIL_LABELS.speed }}: {{ speciesDefinition.speed.walk }}
          {{ FEET_UNIT_LABEL }}
        </span>
      </div>
    </div>

    <UIcon
      name="tabler:grip-vertical"
      class="h-4 w-4 shrink-0 text-dimmed opacity-0 transition-opacity group-hover:opacity-100"
    />
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
