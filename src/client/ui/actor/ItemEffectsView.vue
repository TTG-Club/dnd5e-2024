<script setup lang="ts">
  import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

  import { useActiveEffectModal } from '../../composables/useActiveEffectModal';
  import {
    ACTIVE_EFFECT_DEFAULTS,
    ACTIVE_EFFECT_ICON_CLASS,
    ACTIVE_EFFECT_OPEN_HINT,
    ITEM_EFFECTS_VIEW_LABELS,
  } from './constants';

  const props = defineProps<{
    /** Эффекты предмета для отображения (только просмотр, без редактирования) */
    effects: ActiveEffect[];
    /** Название записи-носителя — уходит подзаголовком в карточку эффекта */
    ownerName?: string;
  }>();

  const { openActiveEffectDetail } = useActiveEffectModal();

  /**
   * Открывает карточку эффекта: сама строка показывает только название, а что
   * эффект делает — разбирает карточка.
   *
   * @param effect - эффект строки
   */
  function openDetail(effect: ActiveEffect): void {
    openActiveEffectDetail(effect, props.ownerName);
  }

  /**
   * Цвет значка эффекта: у отключённого он гаснет.
   *
   * @param effect - эффект строки
   * @returns класс цвета значка
   */
  function effectIconClass(effect: ActiveEffect): string {
    return effect.disabled
      ? ACTIVE_EFFECT_ICON_CLASS.disabled
      : ACTIVE_EFFECT_ICON_CLASS.active;
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-if="effects.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ ITEM_EFFECTS_VIEW_LABELS.empty }}
    </div>

    <div
      v-else
      class="space-y-1"
    >
      <button
        v-for="effect in effects"
        :key="effect.id"
        type="button"
        :title="ACTIVE_EFFECT_OPEN_HINT"
        class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg bg-elevated/50 p-2 text-left transition-colors hover:bg-accented/50"
        :class="{ 'opacity-50 grayscale': effect.disabled }"
        @click.left.exact.prevent="openDetail(effect)"
      >
        <UIcon
          :name="effect.icon || ACTIVE_EFFECT_DEFAULTS.fallbackIcon"
          class="size-5 shrink-0"
          :class="effectIconClass(effect)"
        />

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-sm leading-none font-medium">
            <span class="truncate">{{ effect.name }}</span>

            <UBadge
              v-if="effect.disabled"
              :label="ITEM_EFFECTS_VIEW_LABELS.disabled"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </div>

          <div
            v-if="effect.description"
            class="mt-0.5 text-[10px] wrap-break-word text-dimmed"
          >
            {{ effect.description }}
          </div>
        </div>

        <UIcon
          name="tabler:chevron-right"
          class="size-4 shrink-0 text-dimmed"
        />
      </button>
    </div>
  </div>
</template>
