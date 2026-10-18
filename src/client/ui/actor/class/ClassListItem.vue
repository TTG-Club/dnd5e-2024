<script setup lang="ts">
  import type { ClassDefinition } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { isSubclassRecord } from '@vtt/shared/system/dnd.js';

  import { useContextMenu } from '../../../composables/useContextMenu';
  import { useListRowClass } from '../../../composables/useListRowClass';
  import {
    ABILITY_LABELS,
    CLASS_DEFINITION_MIME,
    CLASS_LIST_ITEM_LABELS,
    HIT_DIE_LETTER,
    LIST_ROW_CARD_BORDERED_CLASS,
    LIST_ROW_PACK_NAME_CLASS,
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
    /** Клик по строке (открыть детальник) */
    click: [];
    edit: [];
    delete: [];
    /** Положить запись в компендиум мира */
    addToCompendium: [];
    copy: [];
  }>();

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit, () => emit('addToCompendium'));

  /** Запись кости хитов класса: «к8» */
  const hitDieLabel = computed(
    () => `${HIT_DIE_LETTER}${props.classDefinition.hitDie}`,
  );

  /** Запись — подкласс другого класса, а не самостоятельный класс */
  const isSubclass = computed(() => isSubclassRecord(props.classDefinition));

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
    class="group flex cursor-grab items-center gap-3 py-2 transition-colors active:cursor-grabbing"
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

    <!-- Название и описание -->
    <div
      v-else
      class="min-w-0 flex-1"
    >
      <!-- Английского названия здесь нет: в «Мастерской» и на листе оно
           не нужно, а в списке компендиума его показывает плоская строка -->
      <div class="truncate text-sm font-medium text-highlighted">
        {{ classDefinition.name }}
      </div>

      <!-- Подкласс: своей механики у записи нет, она берётся у родителя -->
      <div
        v-if="isSubclass"
        class="text-xs text-muted"
      >
        {{ CLASS_LIST_ITEM_LABELS.subclass }}
      </div>

      <div
        v-else
        class="flex items-center gap-3 text-xs text-muted"
      >
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
