<script setup lang="ts">
  import type { ActiveEffect, DnDCreature } from '@vtt/shared/system/dnd.js';

  import ActiveEffectsPanel from '../actor/ActiveEffectsPanel.vue';

  interface Props {
    creature: DnDCreature;
    isEditMode: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:creature': [updates: Partial<DnDCreature>];
    'immediate-save': [];
  }>();

  /**
   * Записывает новый список эффектов в существо. Вне режима правки лист
   * сохраняет изменение сразу: тумблеры эффектов и плитки состояний работают и
   * в просмотре, а кнопки «Сохранить» там нет.
   *
   * @param effects - новый список активных эффектов
   */
  function handleEffectsUpdate(effects: ActiveEffect[]): void {
    emit('update:creature', { activeEffects: effects });

    if (!props.isEditMode) {
      setTimeout(() => emit('immediate-save'), 0);
    }
  }
</script>

<template>
  <ActiveEffectsPanel
    :effects="creature.activeEffects ?? []"
    :is-edit-mode="isEditMode"
    @update:effects="handleEffectsUpdate"
  />
</template>
