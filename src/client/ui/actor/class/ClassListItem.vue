<script setup lang="ts">
  import type { ClassDefinition } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { useContextMenu } from '../../../composables/useContextMenu';
  import { useListRowClass } from '../../../composables/useListRowClass';
  import {
    ABILITY_LABELS,
    CLASS_DEFINITION_MIME,
    CLASS_LIST_ITEM_LABELS,
    HIT_DIE_LETTER,
    LIST_ROW_CARD_BORDERED_CLASS,
  } from '../constants';
  import ContextMenuOverlay from '../ContextMenuOverlay.vue';
  import EntityRowBody from '../EntityRowBody.vue';

  defineOptions({
    inheritAttrs: false,
  });

  const HIT_DIE_COLORS: Record<number, string> = {
    6: 'text-danger',
    8: 'text-danger-muted',
    10: 'text-warning',
    12: 'text-success',
  };

  const props = defineProps<{
    /** Данные класса из SRD или мира */
    classDefinition: ClassDefinition;
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
  const rowClass = useListRowClass(
    () => Boolean(props.flat),
    LIST_ROW_CARD_BORDERED_CLASS,
  );

  const emit = defineEmits<{
    /** Клик по строке (открыть детальник) */
    click: [];
    edit: [];
    delete: [];
    copy: [];
  }>();

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit);

  /** Запись кости хитов класса: «к8» */
  const hitDieLabel = computed(
    () => `${HIT_DIE_LETTER}${props.classDefinition.hitDie}`,
  );

  /**
   * Начинает перетаскивание класса на лист персонажа
   * @param event - событие dragstart
   */
  function handleDragStart(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';

    // Вместе с паком: одноимённый класс есть и в соседнем компендиуме, и лист
    // должен взять ту копию, которую тянут
    event.dataTransfer.setData(
      CLASS_DEFINITION_MIME,
      JSON.stringify({
        definition: props.classDefinition,
        packId: props.packId,
      }),
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
      :name="classDefinition.name"
      :name-en="classDefinition.nameEn"
      :source-key="classDefinition.sourceKey"
      :source="classDefinition.source"
    />

    <!-- Название и описание -->
    <div
      v-else
      class="min-w-0 flex-1"
    >
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-medium text-highlighted">
          {{ classDefinition.name }}
        </span>

        <span class="text-xs text-dimmed">
          {{ classDefinition.nameEn }}
        </span>
      </div>

      <div class="flex items-center gap-3 text-xs text-muted">
        <!-- Кость хитов -->
        <span :class="HIT_DIE_COLORS[classDefinition.hitDie] ?? 'text-muted'">
          {{ hitDieLabel }}
        </span>

        <!-- Спасброски -->
        <span class="truncate">
          {{
            classDefinition.savingThrowProficiencies
              .map((ability) => ABILITY_LABELS[ability] ?? ability)
              .join(', ')
          }}
        </span>

        <!-- Заклинатель -->
        <span
          v-if="classDefinition.spellcasting"
          class="text-magic"
        >
          {{ CLASS_LIST_ITEM_LABELS.spellcaster }}
        </span>
      </div>
    </div>

    <!-- Подсказка перетаскивания -->
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
