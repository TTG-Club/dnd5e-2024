<script setup lang="ts">
  import type { ContextMenuAction } from '../../composables/useContextMenu';

  import { computed } from 'vue';

  import { ContextMenuDangerItem } from '@/shared_ui/components';

  import {
    CONTEXT_MENU_LABELS,
    SHEET_ROW_MENU_LABELS,
    SPELL_MENU_LABELS,
  } from './constants';

  const props = defineProps<{
    /** Показано ли меню */
    isOpen: boolean;
    /** X координата */
    posX: number;
    /** Y координата */
    posY: number;
    /** Показать кнопку «Скопировать» */
    showCopy?: boolean;
    /** Текст кнопки «Скопировать» */
    copyLabel?: string;
    /** Показать кнопку «Редактировать» */
    showEdit?: boolean;
    /** Показать кнопку «Удалить» */
    showDelete?: boolean;
    /** Показать кнопку «В компендиум» (ставит ядро в «Мастерской») */
    showAddToCompendium?: boolean;
    /** Показать кнопку «Поделиться в чат» */
    showShare?: boolean;
    /** Показать кнопку «Применить» (заклинание) */
    showCast?: boolean;
  }>();

  const emit = defineEmits<{
    action: [action: ContextMenuAction];
    close: [];
  }>();

  /** Черта перед «Удалить» нужна, только если над ней есть другие пункты */
  const showDeleteDivider = computed(
    () =>
      props.showDelete
      && (props.showCast
        || props.showCopy
        || props.showEdit
        || props.showAddToCompendium
        || props.showShare),
  );
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-10000"
      @click.left.exact.prevent="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        class="absolute min-w-45 rounded-lg border border-default bg-default py-1 shadow-xl"
        :style="{ left: `${posX}px`, top: `${posY}px` }"
        @click.stop
      >
        <!-- Применить -->
        <button
          v-if="showCast"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="emit('action', 'cast')"
        >
          <UIcon
            name="tabler:wand"
            class="h-4 w-4 text-muted"
          />
          {{ SPELL_MENU_LABELS.cast }}
        </button>

        <!-- Скопировать -->
        <button
          v-if="showCopy"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="emit('action', 'copy')"
        >
          <UIcon
            name="tabler:copy"
            class="h-4 w-4 text-muted"
          />
          {{ CONTEXT_MENU_LABELS.copyToPrefix
          }}{{ copyLabel || CONTEXT_MENU_LABELS.copyToDefaultTarget }}
        </button>

        <!-- Редактировать -->
        <button
          v-if="showEdit"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="emit('action', 'edit')"
        >
          <UIcon
            name="tabler:edit"
            class="h-4 w-4 text-muted"
          />
          {{ SHEET_ROW_MENU_LABELS.edit }}
        </button>

        <!-- В компендиум -->
        <button
          v-if="showAddToCompendium"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="emit('action', 'add-to-compendium')"
        >
          <UIcon
            name="tabler:books"
            class="h-4 w-4 text-muted"
          />
          {{ CONTEXT_MENU_LABELS.addToCompendium }}
        </button>

        <!-- Поделиться в чат -->
        <button
          v-if="showShare"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="emit('action', 'share')"
        >
          <UIcon
            name="tabler:message-share"
            class="h-4 w-4 text-muted"
          />
          {{ SHEET_ROW_MENU_LABELS.share }}
        </button>

        <!-- Разделитель -->
        <div
          v-if="showDeleteDivider"
          class="mx-2 my-1 border-t border-default/50"
        />

        <!-- Удалить -->
        <ContextMenuDangerItem
          v-if="showDelete"
          icon="tabler:trash"
          @click="emit('action', 'delete')"
        >
          {{ SHEET_ROW_MENU_LABELS.remove }}
        </ContextMenuDangerItem>
      </div>
    </div>
  </Teleport>
</template>
