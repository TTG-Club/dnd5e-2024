<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { Spell } from '@vtt/shared/system/dnd.js';

  import type { SheetRowStat } from '../actor/sheetRowTypes';

  import { computed } from 'vue';

  import { SPELL_USES_RECOVERY_LABELS } from '@vtt/shared/system/dnd.js';

  import {
    SPELL_BADGE_HINTS,
    SPELL_BADGE_LABELS,
    SPELL_MENU_LABELS,
    SPELL_STAT_HINTS,
  } from '../actor/constants';
  import SheetRowStats from '../actor/SheetRowStats.vue';
  import { CREATURE_ROW_ARIA_LABELS, CREATURE_ROW_ICONS } from './constants';

  interface Props {
    /** Заклинание существа */
    spell: Spell;
    /** Подпись под названием — школа магии */
    subtitle?: string;
    /** Плитки параметров: урон и заряды */
    stats?: SheetRowStat[];
    /** Пункты меню строки — общие для правой кнопки мыши и «⋮» */
    menuItems?: DropdownMenuItem[][];
    /** Заклинание применяется: значок слева и кнопка справа нажимаются */
    canCast?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    subtitle: '',
    stats: () => [],
    menuItems: () => [],
    canCast: false,
  });

  const emit = defineEmits<{
    /** Открыть карточку заклинания */
    open: [];
    /** Применить заклинание */
    cast: [];
    /** Начало перетаскивания строки на хотбар */
    dragstart: [event: DragEvent];
  }>();

  /** Заряды кончились — заклинание ждёт отдыха */
  const isExhausted = computed(() => {
    const uses = props.spell.uses;

    return !!uses && uses.recovery !== 'atWill' && uses.current <= 0;
  });

  /** Подсказка значка: способ отката либо пустые заряды */
  const iconTooltip = computed(() => {
    const uses = props.spell.uses;

    if (isExhausted.value) {
      return SPELL_STAT_HINTS.usesEmpty;
    }

    if (!uses || uses.recovery === 'atWill') {
      return SPELL_USES_RECOVERY_LABELS.atWill;
    }

    return SPELL_USES_RECOVERY_LABELS[uses.recovery];
  });

  /**
   * Значок слева повторяет кнопку надевания в снаряжении: горит, пока
   * заклинание готово к бою, и гаснет, когда заряды кончились.
   */
  const iconClass = computed(() => {
    if (isExhausted.value || !props.canCast) {
      return 'border-default/50 bg-default/40 text-muted';
    }

    return 'cursor-pointer border-primary/60 bg-primary/15 text-primary hover:border-primary';
  });

  /** Значок применяется как кнопка только у готового к бою заклинания */
  const isIconButton = computed(() => props.canCast && !isExhausted.value);

  function handleOpen(): void {
    emit('open');
  }

  function handleCast(): void {
    if (!props.canCast) {
      return;
    }

    emit('cast');
  }

  function handleDragStart(event: DragEvent): void {
    emit('dragstart', event);
  }
</script>

<template>
  <UContextMenu :items="menuItems">
    <!-- Строка заклинания существа — тот же кирпич, что и строка заклинания на
      листе персонажа: своя рамка, свой @container и та же раскладка -->
    <div
      class="@container flex flex-col rounded-lg border border-default/50 bg-elevated/20 transition-colors hover:border-primary/60"
      :draggable="true"
      @dragstart="handleDragStart"
    >
      <div class="relative flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <div
          class="flex w-full min-w-0 items-center gap-3 @xl:w-auto @xl:flex-1"
        >
          <UTooltip :text="iconTooltip">
            <component
              :is="isIconButton ? 'button' : 'span'"
              :type="isIconButton ? 'button' : undefined"
              class="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="iconClass"
              :aria-label="
                isIconButton
                  ? `${SPELL_MENU_LABELS.cast}: ${spell.name}`
                  : undefined
              "
              @click.left.exact.prevent.stop="handleCast"
            >
              <UIcon
                :name="CREATURE_ROW_ICONS.spell"
                class="size-5"
              />
            </component>
          </UTooltip>

          <!-- Подложка `after:inset-0` делает нажимаемой всю строку, а не одно
            название: попасть в неё мышью проще -->
          <button
            type="button"
            class="flex min-w-0 grow cursor-pointer flex-col text-left after:absolute after:inset-0 after:cursor-pointer"
            :aria-label="`${CREATURE_ROW_ARIA_LABELS.openSpell}: ${spell.name}`"
            @click.left.exact.prevent="handleOpen"
          >
            <span
              class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @xl:flex-nowrap"
            >
              <span
                class="text-sm font-medium wrap-break-word text-highlighted @xl:truncate"
              >
                {{ spell.name }}
              </span>

              <UTooltip
                v-if="spell.concentration"
                :text="SPELL_BADGE_HINTS.concentration"
              >
                <UBadge
                  color="warning"
                  variant="subtle"
                  size="sm"
                  class="relative z-10 shrink-0"
                >
                  {{ SPELL_BADGE_LABELS.concentration }}
                </UBadge>
              </UTooltip>

              <UTooltip
                v-if="spell.ritual"
                :text="SPELL_BADGE_HINTS.ritual"
              >
                <UBadge
                  color="info"
                  variant="subtle"
                  size="sm"
                  class="relative z-10 shrink-0"
                >
                  {{ SPELL_BADGE_LABELS.ritual }}
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

        <!-- Плитки параметров — общий кирпич со строкой снаряжения: урон
          катится по нажатию, заряды просто показаны -->
        <SheetRowStats
          :stats="stats"
          :roll-aria-label="`${SPELL_MENU_LABELS.cast}: ${spell.name}`"
          @roll="handleCast"
        />

        <!-- Применение и меню прижимаются вправо и стоят над подложкой
          названия. Кнопка каста нужна отдельно от плитки урона: у заклинания
          без урона плитки нет, а применяют и его -->
        <div class="relative z-10 ml-auto flex shrink-0 items-center gap-1">
          <UTooltip
            v-if="canCast"
            :text="SPELL_MENU_LABELS.cast"
          >
            <UButton
              icon="tabler:sparkles"
              color="primary"
              variant="ghost"
              size="xs"
              square
              :aria-label="`${SPELL_MENU_LABELS.cast}: ${spell.name}`"
              @click.left.exact.prevent.stop="handleCast"
            />
          </UTooltip>

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
              :aria-label="`${CREATURE_ROW_ARIA_LABELS.spellMenu}: ${spell.name}`"
            />
          </UDropdownMenu>
        </div>
      </div>
    </div>
  </UContextMenu>
</template>
