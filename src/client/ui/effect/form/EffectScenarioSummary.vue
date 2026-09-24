<!--
  Живая сводка эффекта над шагами: одна-две фразы о том, как эффект сработает
  с текущими настройками. Текст собирает движок (`describeEffectScenario`).
-->
<script setup lang="ts">
  import { ACTIVE_EFFECT_FORM_LABELS } from '../constants';

  defineProps<{
    /** Фраза сводки */
    scenario: string;
  }>();
</script>

<template>
  <div
    class="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
    :title="ACTIVE_EFFECT_FORM_LABELS.summaryHint"
  >
    <UIcon
      name="tabler:player-play"
      class="mt-0.5 size-4 shrink-0 text-primary"
    />

    <p class="text-sm leading-snug text-default">
      {{ scenario }}
    </p>
  </div>
</template>
