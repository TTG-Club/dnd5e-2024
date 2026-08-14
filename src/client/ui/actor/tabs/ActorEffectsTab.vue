<script setup lang="ts">
  import type { ActiveEffect, DnDActor } from '@vtt/shared/system/dnd.js';

  import ActiveEffectsPanel from '../ActiveEffectsPanel.vue';

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
    'immediate-save': [];
  }>();

  /**
   * Записывает новый список эффектов в актёра. Вне режима правки лист сохраняет
   * изменение сразу: тумблеры эффектов и плитки состояний работают и в
   * просмотре, а кнопки «Сохранить» там нет.
   *
   * @param effects - новый список активных эффектов
   */
  function handleEffectsUpdate(effects: ActiveEffect[]): void {
    emit('update:actor', { activeEffects: effects });

    if (!props.isEditMode) {
      setTimeout(() => emit('immediate-save'), 0);
    }
  }
</script>

<template>
  <!-- Шкала Истощения у персонажа стоит в левой колонке под здоровьем -->
  <ActiveEffectsPanel
    :effects="actor.activeEffects ?? []"
    :equipment="actor.equipment ?? []"
    :is-edit-mode="isEditMode"
    :show-exhaustion="false"
    @update:effects="handleEffectsUpdate"
  />
</template>
