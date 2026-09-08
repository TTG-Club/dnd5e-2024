<script setup lang="ts">
  /**
   * Плашка заклинания, выданного записью, в карточке её умения: название и
   * круг.
   *
   * Записи-источника на плашке нет: заклинания стоят в карточке того умения,
   * которое их выдало, и повтор его названия у каждой плашки съедал бы
   * половину строки.
   *
   * Плашка нажимается и открывает карточку заклинания: по одному названию
   * игрок не поймёт, что именно ему выдали. Снять выданное нельзя — на это
   * указывает замок.
   */

  import type { Spell } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { CLASS_WIZARD_LABELS } from '../../constants';
  import { spellCircleLabel } from '../../utils/spellCircleLabel';

  const props = defineProps<{
    spell: Spell;
  }>();

  defineEmits<{
    /** Открыть карточку заклинания */
    open: [];
  }>();

  /** Круг заклинания подписью: «заговор» или «3 кр.» */
  const circle = computed(() => spellCircleLabel(props.spell.level));
</script>

<template>
  <button
    type="button"
    class="flex cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-left transition-colors hover:border-primary/70"
    :aria-label="CLASS_WIZARD_LABELS.openGrantedSpell"
    @click.left.exact.prevent="$emit('open')"
  >
    <UIcon
      name="tabler:lock"
      class="size-3.5 shrink-0 opacity-60"
    />

    <span class="text-sm text-highlighted">{{ spell.name }}</span>

    <UBadge
      color="neutral"
      variant="subtle"
      size="sm"
      class="shrink-0"
    >
      {{ circle }}
    </UBadge>
  </button>
</template>
