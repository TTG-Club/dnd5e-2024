<script setup lang="ts">
  import type { HpDisplayMode } from '@vtt/shared/system/dnd.js';

  import { TOKEN_HP_DISPLAY_OPTIONS, TOKEN_SETTINGS_LABELS } from './constants';

  interface Props {
    /** Менять вид может только ведущий или владелец */
    disabled: boolean;
  }

  defineProps<Props>();

  /** Свой вид ХП токена; `undefined` — как задано для мира */
  const mode = defineModel<HpDisplayMode | undefined>({ required: true });

  /** Классы выбранного варианта */
  const MODE_ACTIVE_CLASS = 'border-primary/50 bg-primary/10 text-highlighted';

  /** Классы невыбранного варианта */
  const MODE_INACTIVE_CLASS =
    'border-default/50 bg-elevated/20 text-toned hover:bg-elevated/40';

  /**
   * Классы кнопки варианта: выбранный подсвечен.
   *
   * @param optionMode - вид ХП варианта
   * @returns классы кнопки
   */
  function getModeClass(optionMode: HpDisplayMode | undefined): string {
    return mode.value === optionMode ? MODE_ACTIVE_CLASS : MODE_INACTIVE_CLASS;
  }

  /**
   * Выбирает вид ХП токена.
   *
   * @param optionMode - вид ХП варианта
   */
  function selectMode(optionMode: HpDisplayMode | undefined): void {
    mode.value = optionMode;
  }
</script>

<template>
  <div class="rounded border border-default/50 bg-elevated/30 p-3">
    <div class="mb-2 flex items-center gap-2">
      <UIcon
        name="tabler:heart"
        class="size-4 text-muted"
      />

      <label class="flex-1 text-sm font-medium text-toned">
        {{ TOKEN_SETTINGS_LABELS.hpDisplay }}
      </label>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="option in TOKEN_HP_DISPLAY_OPTIONS"
        :key="option.label"
        class="flex items-center gap-2 rounded border p-2 text-left text-sm transition-colors"
        :class="getModeClass(option.mode)"
        :disabled="disabled"
        @click.left.exact.prevent="selectMode(option.mode)"
      >
        <UIcon
          :name="option.icon"
          class="size-4 shrink-0"
        />

        <span class="font-medium">
          {{ option.label }}
        </span>
      </button>
    </div>
  </div>
</template>
