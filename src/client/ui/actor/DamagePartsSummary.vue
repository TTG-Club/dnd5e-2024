<script setup lang="ts">
  import type { DamagePart } from '@vtt/shared';

  import { computed } from 'vue';

  import { describeDamagePart } from '@vtt/shared/system/dnd.js';

  import { formatDamageTypeChoiceLabel } from '../../composables/damageTypeChoice';
  import { useSystemDataStore } from '../../stores/systemDataStore';
  import { DAMAGE_PART_LABELS } from './constants';

  const props = defineProps<{
    /** Части урона/лечения для отображения */
    parts: DamagePart[];
  }>();

  const systemDataStore = useSystemDataStore();

  /** Карта key → локализованное название типа урона */
  const damageTypeMap = computed(() => {
    const map = new Map<string, string>();

    for (const damageType of systemDataStore.damageTypes) {
      map.set(damageType.key, damageType.name);
    }

    return map;
  });

  /** Название типа урона по ключу; незнакомый ключ — как есть */
  function getTypeLabel(type: string): string {
    return damageTypeMap.value.get(type) ?? type;
  }

  /**
   * Части с готовыми подписями: «Урон»/«Лечение», формула без токенов и
   * локализованные типы (несколько — через « + »; временные ХП помечаются).
   */
  const items = computed(() =>
    props.parts.map((part) => {
      const info = describeDamagePart(part);

      const labels = [
        ...info.types.map(getTypeLabel),
        ...info.typeChoices.map((choice) =>
          formatDamageTypeChoiceLabel(choice, getTypeLabel),
        ),
      ];

      if (info.isTemp) {
        labels.push(DAMAGE_PART_LABELS.temporaryHitPoints);
      }

      return {
        formula: info.formula,
        isHealing: info.isHealing,
        kind: info.isHealing
          ? DAMAGE_PART_LABELS.healing
          : DAMAGE_PART_LABELS.damage,
        typeLabel: labels.join(' + '),
      };
    }),
  );
</script>

<template>
  <div
    v-for="(item, index) in items"
    :key="index"
  >
    <span class="block text-xs text-dimmed">{{ item.kind }}</span>

    <p class="flex items-center gap-1.5 text-highlighted">
      <span
        class="font-mono font-semibold"
        :class="item.isHealing ? 'text-healing' : 'text-danger-muted'"
        >{{ item.formula }}</span
      >

      <span
        v-if="item.typeLabel"
        class="text-xs text-muted"
        >{{ item.typeLabel }}</span
      >
    </p>
  </div>
</template>
