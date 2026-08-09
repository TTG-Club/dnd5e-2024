<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { Spell } from '@vtt/shared/system/dnd.js';

  import type { SheetRowStat } from './sheetRowTypes';

  import { computed } from 'vue';

  import {
    SHEET_ROW_ARIA_LABELS,
    SPELL_BADGE_HINTS,
    SPELL_BADGE_LABELS,
    SPELL_MENU_LABELS,
    SPELL_PREPARED_LABELS,
  } from './constants';
  import SheetRowStats from './SheetRowStats.vue';

  interface Props {
    /** Заклинание книги персонажа */
    spell: Spell;
    /** Подпись под названием — школа магии */
    subtitle?: string;
    /** Плитки параметров: урон и заряды */
    stats?: SheetRowStat[];
    /** Пункты меню строки — общие для правой кнопки мыши и «⋮» */
    menuItems?: DropdownMenuItem[][];
  }

  /** Круг заговора: готовить его не нужно */
  const CANTRIP_LEVEL = 0;

  const props = withDefaults(defineProps<Props>(), {
    subtitle: '',
    stats: () => [],
    menuItems: () => [],
  });

  const emit = defineEmits<{
    /** Открыть описание заклинания */
    'open': [];
    /** Применить заклинание (плитка урона и пункт меню) */
    'cast': [];
    /** Переключить подготовку */
    'toggle-prepared': [];
    /** Начало перетаскивания строки на хотбар */
    'dragstart': [event: DragEvent];
  }>();

  /**
   * Подготовку переключают только у заклинаний круга выше заговора: заговор
   * доступен всегда, а сигнатурное заклинание подкласса подготовлено само.
   */
  const canPrepare = computed(
    () => props.spell.level > CANTRIP_LEVEL && !props.spell.alwaysPrepared,
  );

  const isPrepared = computed(
    () => Boolean(props.spell.prepared) || Boolean(props.spell.alwaysPrepared),
  );

  const preparedTooltip = computed(() => {
    if (props.spell.alwaysPrepared) {
      return SPELL_PREPARED_LABELS.always;
    }

    if (props.spell.level === CANTRIP_LEVEL) {
      return SPELL_PREPARED_LABELS.cantrip;
    }

    return isPrepared.value
      ? SPELL_PREPARED_LABELS.unprepare
      : SPELL_PREPARED_LABELS.prepare;
  });

  /**
   * Значок подготовки повторяет кнопку надевания в снаряжении: горит, когда
   * заклинание готово к бою. Неподготовленное заклинание горит только под
   * курсором — и лишь если подготовку вообще переключают.
   */
  const preparedIconClass = computed(() => {
    if (isPrepared.value) {
      return 'border-primary/60 bg-primary/15 text-primary';
    }

    return canPrepare.value
      ? 'border-default/50 bg-default/40 text-muted hover:border-primary/60'
      : 'border-default/50 bg-default/40 text-muted';
  });

  function handlePreparedToggle(): void {
    if (!canPrepare.value) {
      return;
    }

    emit('toggle-prepared');
  }

  function handleOpen(): void {
    emit('open');
  }

  function handleCast(): void {
    emit('cast');
  }

  function handleDragStart(event: DragEvent): void {
    emit('dragstart', event);
  }
</script>

<template>
  <UContextMenu :items="menuItems">
    <!-- Строка заклинания — тот же кирпич, что и строка снаряжения: своя
      рамка, свой @container и та же раскладка на узком листе -->
    <div
      class="@container flex flex-col rounded-lg border border-default/50 bg-elevated/20 transition-colors hover:border-primary/60"
      :draggable="true"
      @dragstart="handleDragStart"
    >
      <div class="relative flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <div
          class="flex w-full min-w-0 items-center gap-3 @xl:w-auto @xl:flex-1"
        >
          <UTooltip :text="preparedTooltip">
            <!-- Заговор и всегда подготовленное заклинание не переключаются:
              им значок не кнопка, а метка состояния -->
            <component
              :is="canPrepare ? 'button' : 'span'"
              :type="canPrepare ? 'button' : undefined"
              class="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="[preparedIconClass, canPrepare ? 'cursor-pointer' : '']"
              :aria-pressed="canPrepare ? isPrepared : undefined"
              :aria-label="
                canPrepare ? `${preparedTooltip}: ${spell.name}` : undefined
              "
              @click.left.exact.prevent.stop="handlePreparedToggle"
            >
              <UIcon
                name="tabler:wand"
                class="size-5"
              />
            </component>
          </UTooltip>

          <!-- Подложка `after:inset-0` делает нажимаемой всю строку, а не одно
            название: попасть в неё мышью проще -->
          <button
            type="button"
            class="flex min-w-0 grow cursor-pointer flex-col text-left after:absolute after:inset-0 after:cursor-pointer"
            :aria-label="`${SHEET_ROW_ARIA_LABELS.openSpell}: ${spell.name}`"
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
          названия. Кнопка каста нужна в строке отдельно от плитки урона:
          у заклинания без урона плитки нет, а применяют и его -->
        <div class="relative z-10 ml-auto flex shrink-0 items-center gap-1">
          <UTooltip :text="SPELL_MENU_LABELS.cast">
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
              :aria-label="`${SHEET_ROW_ARIA_LABELS.spellActions}: ${spell.name}`"
            />
          </UDropdownMenu>
        </div>
      </div>
    </div>
  </UContextMenu>
</template>
