<script setup lang="ts">
  import type { ActiveEffect, DnDActor } from '@vtt/shared/system/dnd.js';

  import { buildEntityEffectsPatch } from '@vtt/shared/system/dnd.js';

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
    // Хиты — вместе с эффектами: снятая «Подмога» опускает их до максимума
    emit('update:actor', buildEntityEffectsPatch(props.actor, effects));

    if (!props.isEditMode) {
      setTimeout(() => emit('immediate-save'), 0);
    }
  }
</script>

<template>
  <ActiveEffectsPanel
    :effects="actor.activeEffects ?? []"
    :is-edit-mode="isEditMode"
    :owner="actor"
    :counters="actor.system.classCounters ?? []"
    allow-hotbar-drag
    @update:effects="handleEffectsUpdate"
  />
</template>
