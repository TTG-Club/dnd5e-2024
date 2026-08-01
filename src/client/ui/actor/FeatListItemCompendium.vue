<script setup lang="ts">
  import type { SourceDefinition } from '@vtt/shared';

  import SourceBadge from './SourceBadge.vue';

  interface FeatDisplayItem {
    id: string;
    name: string;
    nameEn?: string;
    /** Ключ источника-книги — аббревиатура в нижнем регистре */
    sourceKey?: string;
    /** Определение источника, вписанное вместе с записью */
    source?: SourceDefinition;
    repeatable?: boolean;
  }

  defineProps<{
    item: FeatDisplayItem;
  }>();
</script>

<template>
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-2">
      <span class="truncate text-sm font-medium text-highlighted">
        {{ item.name }}
      </span>
    </div>

    <div class="mt-0.5 flex items-center gap-3 text-xs text-muted">
      <SourceBadge
        :source-key="item.sourceKey"
        :source="item.source"
        variant="text"
      />

      <UBadge
        v-if="item.repeatable"
        color="warning"
        variant="subtle"
        size="sm"
      >
        Повторяемая
      </UBadge>
    </div>
  </div>
</template>
