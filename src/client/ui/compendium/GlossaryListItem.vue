<script setup lang="ts">
  /**
   * Строка списка глоссария в браузере компендиума.
   *
   * Термин — справочный текст, а не сущность листа персонажа: строку нельзя
   * перетащить, скопировать в предметы или вызвать на ней контекстное меню.
   * Единственное действие — клик, открывающий описание.
   */

  import type { SourceDefinition } from '@vtt/shared';

  import SourceBadge from '../actor/SourceBadge.vue';

  /** Поля термина, нужные для отрисовки строки */
  interface GlossaryDisplayItem {
    id: string;
    name: string;
    nameEn?: string;
    /** Раздел глоссария («Состояния», «Действия») — подпись справа */
    category?: string;
    /** Ключ источника-книги */
    sourceKey?: string;
    /** Определение источника, вписанное вместе с записью */
    source?: SourceDefinition;
  }

  defineProps<{
    item: GlossaryDisplayItem;
  }>();

  const emit = defineEmits<{
    /** Клик по строке (открыть описание) */
    click: [];
  }>();
</script>

<template>
  <div
    class="flex cursor-pointer items-center gap-3 rounded-lg bg-elevated/30 px-3 py-2 transition-colors hover:bg-accented/40"
    @click.left.exact.prevent="emit('click')"
  >
    <!-- Название и английское название -->
    <div class="flex min-w-0 flex-1 items-baseline gap-2">
      <span class="truncate text-sm font-medium text-highlighted">
        {{ item.name }}
      </span>

      <span
        v-if="item.nameEn"
        class="truncate text-xs text-dimmed"
      >
        {{ item.nameEn }}
      </span>
    </div>

    <!-- Раздел глоссария -->
    <UBadge
      v-if="item.category"
      color="neutral"
      variant="subtle"
      size="sm"
      class="shrink-0"
    >
      {{ item.category }}
    </UBadge>

    <SourceBadge
      :source-key="item.sourceKey"
      :source="item.source"
      variant="text"
    />
  </div>
</template>
