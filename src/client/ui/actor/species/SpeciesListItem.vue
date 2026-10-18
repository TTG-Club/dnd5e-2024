<script setup lang="ts">
  import type { SpeciesDefinition } from '@vtt/shared/system/dnd.js';

  import { useContextMenu } from '../../../composables/useContextMenu';
  import { useListRowClass } from '../../../composables/useListRowClass';
  import {
    CREATURE_TYPE_LABELS,
    FEET_UNIT_LABEL,
    LIST_ROW_CARD_BORDERED_CLASS,
    LIST_ROW_PACK_NAME_CLASS,
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
    /** Пак записи: уходит на лист вместе с определением при переносе */
    packId?: string;
    /**
     * Название компендиума в плоской строке — в режиме «все компендиумы», как
     * в окне выбора: копии одной записи из разных паков иначе не различить.
     */
    packName?: string;
    showEdit?: boolean;
    showDelete?: boolean;
    /** Показывать «В компендиум» в контекстном меню (ставит ядро в «Мастерской») */
    showAddToCompendium?: boolean;
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
    /** Положить запись в компендиум мира */
    addToCompendium: [];
    copy: [];
  }>();

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit, () => emit('addToCompendium'));

  function handleDragStart(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';

    // Вместе с паком: одноимённый вид есть и в соседнем компендиуме, и лист
    // должен взять ту копию, которую тянут
    event.dataTransfer.setData(
      SPECIES_DEFINITION_MIME,
      JSON.stringify({
        definition: props.speciesDefinition,
        packId: props.packId,
      }),
    );
  }
</script>

<template>
  <div
    v-bind="$attrs"
    draggable="true"
    class="group flex cursor-grab items-center gap-3 py-2 transition-colors active:cursor-grabbing"
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
    >
      <template #badges>
        <span
          v-if="packName"
          :class="LIST_ROW_PACK_NAME_CLASS"
        >
          {{ packName }}
        </span>
      </template>
    </EntityRowBody>

    <div
      v-else
      class="min-w-0 flex-1"
    >
      <!-- Английского названия здесь нет: в «Мастерской» и на листе оно
           не нужно, а в списке компендиума его показывает плоская строка -->
      <div class="truncate text-sm font-medium text-highlighted">
        {{ speciesDefinition.name }}
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
  </div>

  <ContextMenuOverlay
    :is-open="isMenuOpen"
    :pos-x="menuX"
    :pos-y="menuY"
    :show-copy="showCopy"
    :show-edit="showEdit"
    :show-delete="showDelete"
    :show-add-to-compendium="showAddToCompendium"
    @action="handleAction"
    @close="closeMenu"
  />
</template>
