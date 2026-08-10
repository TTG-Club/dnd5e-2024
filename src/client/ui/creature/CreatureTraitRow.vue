<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { CreatureAction } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    CREATURE_ACTION_MENU_LABELS,
    CREATURE_ROW_ARIA_LABELS,
  } from './constants';

  interface Props {
    /** Особенность существа */
    action: CreatureAction;
    /** Пункты меню строки — по правой кнопке мыши */
    menuItems?: DropdownMenuItem[][];
    /** Лист в режиме правки: в строке появляются карандаш и корзина */
    isEditMode?: boolean;
    /** Режим только просмотр (компендиум): править нечего */
    isReadOnly?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    menuItems: () => [],
    isEditMode: false,
    isReadOnly: false,
  });

  const emit = defineEmits<{
    /** Открыть описание особенности */
    open: [];
    /** Открыть форму правки */
    edit: [];
    /** Удалить особенность */
    delete: [];
  }>();

  /** Сколько активных эффектов накладывает особенность; 0 — бейджа нет */
  const effectsCount = computed(() => props.action.activeEffects?.length ?? 0);

  /** В режиме правки нажатие по строке ведёт в форму, а не в описание */
  const canEdit = computed(() => props.isEditMode && !props.isReadOnly);

  function handleClick(): void {
    if (canEdit.value) {
      emit('edit');

      return;
    }

    emit('open');
  }
</script>

<template>
  <UContextMenu :items="menuItems">
    <!-- Плашка особенности — та же, что и у особенностей листа персонажа:
      невысокая строка с названием, без плиток параметров. Боевых чисел у
      особенности нет, и карточка со строкой снаряжения ей ни к чему -->
    <div
      class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-accented/30 px-3 py-2 transition-colors hover:bg-accented/50"
      role="button"
      tabindex="0"
      :aria-label="`${CREATURE_ROW_ARIA_LABELS.openAction}: ${action.name}`"
      @click.left.exact.prevent="handleClick"
      @keydown.enter.prevent="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <div class="flex flex-1 items-center gap-2 overflow-hidden">
        <UTooltip
          v-if="effectsCount > 0"
          :text="CREATURE_ACTION_MENU_LABELS.effects"
        >
          <UBadge
            color="warning"
            variant="subtle"
            size="sm"
            class="shrink-0"
          >
            <UIcon
              name="tabler:sparkles"
              class="mr-0.5 size-3"
            />
            {{ effectsCount }}
          </UBadge>
        </UTooltip>

        <span class="truncate text-sm text-highlighted">
          {{ action.name }}
        </span>
      </div>

      <div
        v-if="canEdit"
        class="flex shrink-0 items-center gap-1"
      >
        <UButton
          icon="tabler:pencil"
          color="neutral"
          variant="ghost"
          size="xs"
          @click.left.exact.prevent.stop="emit('edit')"
        />

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          @click.left.exact.prevent.stop="emit('delete')"
        />
      </div>
    </div>
  </UContextMenu>
</template>
