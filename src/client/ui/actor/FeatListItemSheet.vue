<script setup lang="ts">
  import type { FeatDisplayItem } from './featListItemTypes';

  import { FEAT_LIST_ITEM_LABELS } from './constants';

  defineProps<{
    item: FeatDisplayItem;
    showEdit?: boolean;
    showDelete?: boolean;
  }>();

  const emit = defineEmits<{
    edit: [];
    delete: [];
  }>();
</script>

<template>
  <div class="flex flex-1 items-center gap-2 overflow-hidden">
    <!-- Происхождение (класс/вид) -> Бейдж перед названием -->
    <UBadge
      v-if="item.grantedBy"
      color="primary"
      variant="subtle"
      size="sm"
      class="shrink-0"
    >
      {{ item.grantedBy }}
    </UBadge>

    <span class="truncate text-sm text-highlighted">
      {{ item.name }}
    </span>

    <UBadge
      v-if="item.repeatable"
      color="warning"
      variant="subtle"
      size="sm"
      class="ml-auto shrink-0"
    >
      {{ FEAT_LIST_ITEM_LABELS.repeatable }}
    </UBadge>
  </div>

  <div
    v-if="showEdit || showDelete"
    class="flex shrink-0 items-center gap-1"
  >
    <UButton
      v-if="showEdit"
      icon="tabler:pencil"
      color="neutral"
      variant="ghost"
      size="xs"
      @click.left.exact.prevent.stop="emit('edit')"
    />

    <UButton
      v-if="showDelete"
      icon="tabler:trash"
      color="error"
      variant="ghost"
      size="xs"
      @click.left.exact.prevent.stop="emit('delete')"
    />
  </div>
</template>
