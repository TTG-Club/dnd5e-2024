<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { CreatureAction } from '@vtt/shared/system/dnd.js';

  import type { SheetRowStat } from '../actor/sheetRowTypes';

  import { computed } from 'vue';

  import { SHEET_ROW_ARIA_LABELS } from '../actor/constants';
  import SheetRowStats from '../actor/SheetRowStats.vue';
  import {
    CREATURE_ACTION_MENU_LABELS,
    CREATURE_ROW_ARIA_LABELS,
  } from './constants';

  interface Props {
    /** Действие или особенность существа */
    action: CreatureAction;
    /** Значок записи: он же кнопка броска у боевых записей */
    icon: string;
    /** Подпись под названием: вид дальности и досягаемость */
    subtitle?: string;
    /** Плитки параметров: атака или спасбросок и урон */
    stats?: SheetRowStat[];
    /** Пункты меню строки — общие для правой кнопки мыши и «⋮» */
    menuItems?: DropdownMenuItem[][];
    /** Запись бросается: значок слева становится кнопкой */
    canUse?: boolean;
    /** Строку можно перетащить на хотбар */
    canDrag?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    subtitle: '',
    stats: () => [],
    menuItems: () => [],
    canUse: false,
    canDrag: false,
  });

  const emit = defineEmits<{
    /** Открыть запись: просмотр или правка — решает список */
    open: [];
    /** Бросок записи (значок слева и плитки параметров) */
    use: [];
    /** Начало перетаскивания строки на хотбар */
    dragstart: [event: DragEvent];
  }>();

  /** Сколько активных эффектов накладывает запись; 0 — бейджа нет */
  const effectsCount = computed(() => props.action.activeEffects?.length ?? 0);

  /**
   * Значок слева повторяет кнопку надевания в снаряжении: горит у записи,
   * которую бросают, и остаётся приглушённой меткой у пассивной особенности.
   */
  const iconClass = computed(() =>
    props.canUse
      ? 'cursor-pointer border-primary/60 bg-primary/15 text-primary hover:border-primary'
      : 'border-default/50 bg-default/40 text-muted',
  );

  function handleOpen(): void {
    emit('open');
  }

  function handleUse(): void {
    if (!props.canUse) {
      return;
    }

    emit('use');
  }

  function handleDragStart(event: DragEvent): void {
    emit('dragstart', event);
  }
</script>

<template>
  <UContextMenu :items="menuItems">
    <!-- Строка действия — тот же кирпич, что и строка снаряжения на листе
      персонажа: своя рамка, свой @container и та же раскладка на узком листе -->
    <div
      class="@container flex flex-col rounded-lg border border-default/50 bg-elevated/20 transition-colors hover:border-primary/60"
      :draggable="canDrag"
      @dragstart="handleDragStart"
    >
      <div class="relative flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <div
          class="flex w-full min-w-0 items-center gap-3 @xl:w-auto @xl:flex-1"
        >
          <UTooltip
            :text="canUse ? CREATURE_ACTION_MENU_LABELS.use : undefined"
          >
            <!-- Пассивной особенности значок не кнопка, а метка: бросать у неё
              нечего -->
            <component
              :is="canUse ? 'button' : 'span'"
              :type="canUse ? 'button' : undefined"
              class="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="iconClass"
              :aria-label="
                canUse
                  ? `${CREATURE_ROW_ARIA_LABELS.use}: ${action.name}`
                  : undefined
              "
              @click.left.exact.prevent.stop="handleUse"
            >
              <UIcon
                :name="icon"
                class="size-5"
              />
            </component>
          </UTooltip>

          <!-- Подложка `after:inset-0` делает нажимаемой всю строку, а не одно
            название: попасть в неё мышью проще -->
          <button
            type="button"
            class="flex min-w-0 grow cursor-pointer flex-col text-left after:absolute after:inset-0 after:cursor-pointer"
            :aria-label="`${CREATURE_ROW_ARIA_LABELS.openAction}: ${action.name}`"
            @click.left.exact.prevent="handleOpen"
          >
            <span
              class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @xl:flex-nowrap"
            >
              <span
                class="text-sm font-medium wrap-break-word text-highlighted @xl:truncate"
              >
                {{ action.name }}
              </span>

              <UTooltip
                v-if="effectsCount > 0"
                :text="CREATURE_ACTION_MENU_LABELS.effects"
              >
                <UBadge
                  color="warning"
                  variant="subtle"
                  size="sm"
                  class="relative z-10 shrink-0"
                >
                  <UIcon
                    name="tabler:sparkles"
                    class="mr-0.5 size-3"
                  />
                  {{ effectsCount }}
                </UBadge>
              </UTooltip>
            </span>

            <span
              v-if="subtitle"
              class="text-xs wrap-break-word text-dimmed @xl:truncate"
            >
              {{ subtitle }}
            </span>
          </button>
        </div>

        <!-- Плитки параметров — общий кирпич со строкой снаряжения: атака и
          урон катятся по нажатию -->
        <SheetRowStats
          :stats="stats"
          :roll-aria-label="`${SHEET_ROW_ARIA_LABELS.roll}: ${action.name}`"
          @roll="handleUse"
        />

        <!-- Меню прижимается вправо и стоит над подложкой названия -->
        <div class="relative z-10 ml-auto flex shrink-0 items-center gap-1">
          <UDropdownMenu
            :items="menuItems"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="tabler:dots-vertical"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              :aria-label="`${CREATURE_ROW_ARIA_LABELS.actionMenu}: ${action.name}`"
            />
          </UDropdownMenu>
        </div>
      </div>
    </div>
  </UContextMenu>
</template>
