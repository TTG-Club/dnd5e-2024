<script setup lang="ts">
  /**
   * Метка «Эффекты по подписке» в шапке карточки записи.
   *
   * Записи вне SRD скачиваются всем, но без подписки TTG источник присылает их
   * без эффектов и помечает `automation: false`. Остальное (урон, спасброски,
   * счётчики) у такой записи на месте, поэтому без метки пустая вкладка
   * эффектов выглядела бы недоделкой записи, а не условием подписки.
   */

  import { EFFECTS_BY_SUBSCRIPTION_LABELS } from './constants';

  defineProps<{
    /** Поле `automation` записи: `false` — эффекты вырезаны источником */
    automation?: boolean;
  }>();
</script>

<template>
  <UTooltip
    v-if="automation === false"
    :text="EFFECTS_BY_SUBSCRIPTION_LABELS.hint"
  >
    <UBadge
      :label="EFFECTS_BY_SUBSCRIPTION_LABELS.badge"
      color="warning"
      variant="subtle"
      size="sm"
    />
  </UTooltip>
</template>
