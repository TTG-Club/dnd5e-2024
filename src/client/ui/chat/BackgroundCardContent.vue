<script setup lang="ts">
  import type { BackgroundDefinition } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import CardErrorFallback from '@/shared_ui/components/CardErrorFallback.vue';
  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';

  import { isNamedCardEntry, parseCardPayload } from './cardPayload';
  import { BACKGROUND_CARD_LABELS } from './consts';

  const props = defineProps<{
    /** Сериализованные данные (JSON-строка) */
    payload: string;
  }>();

  /**
   * Проверяет, что нагрузка — предыстория в объёме, который показывает карточка.
   *
   * @param value - разобранная нагрузка
   * @returns `true`, если запись пригодна для показа
   */
  function isBackgroundCardEntry(
    value: unknown,
  ): value is BackgroundDefinition {
    return isNamedCardEntry(value);
  }

  /** Десериализованная предыстория */
  const item = computed<BackgroundDefinition | null>(() =>
    parseCardPayload(props.payload, isBackgroundCardEntry),
  );
</script>

<template>
  <div
    v-if="item"
    class="overflow-hidden rounded-lg border border-source/30"
  >
    <!-- Заголовок -->
    <div class="flex items-center gap-2 bg-elevated/60 px-3 py-2">
      <span
        class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted"
      >
        {{ item.name }}
      </span>
    </div>

    <!-- Тело карточки -->
    <div
      class="flex flex-col gap-2 border-t border-source/30 bg-default/40 px-3 py-2"
    >
      <!-- Мета-строка -->
      <div class="flex items-center gap-2 text-xs">
        <span class="font-medium text-source">{{
          BACKGROUND_CARD_LABELS.kind
        }}</span>
      </div>

      <!-- Описание -->
      <div
        v-if="item.description"
        class="max-h-40 overflow-y-auto"
      >
        <ItemDescriptionRenderer :content="item.description" />
      </div>
    </div>
  </div>

  <!-- Fallback при ошибке десериализации -->
  <CardErrorFallback
    v-else
    :message="BACKGROUND_CARD_LABELS.error"
  />
</template>
