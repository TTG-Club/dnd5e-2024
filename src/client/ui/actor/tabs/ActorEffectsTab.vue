<script setup lang="ts">
  import type {
    ActiveEffect,
    ActorCounterState,
    DnDActor,
  } from '@vtt/shared/system/dnd.js';

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

  /**
   * Записывает ресурсы после применения или включения эффекта: платят только
   * в просмотре, и лист сохраняет правку сразу.
   *
   * @param counters - ресурсы листа
   */
  function handleCountersUpdate(counters: ActorCounterState[]): void {
    emit('update:actor', {
      system: { ...props.actor.system, classCounters: counters },
    });
  }
</script>

<template>
  <ActiveEffectsPanel
    :effects="actor.activeEffects ?? []"
    :is-edit-mode="isEditMode"
    :owner="actor"
    :counters="actor.system.classCounters ?? []"
    @update:effects="handleEffectsUpdate"
    @update:counters="handleCountersUpdate"
  />
</template>
