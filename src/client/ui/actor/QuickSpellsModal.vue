<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { DnDActor, Spell } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import { requireSocket } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useWorldStore } from '@/stores/worldStore';
  import { generateId } from '@vtt/shared';
  import { isSpell } from '@vtt/shared/system/dnd.js';

  import { SPELL_MIME } from './constants';
  import ActorSpellsTab from './tabs/ActorSpellsTab.vue';

  interface Props {
    open: boolean;
    actorId: string;
    worldId: string;
    socket: TypedWebSocketClient | null;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
  }>();

  const worldStore = useWorldStore();

  /** Реактивный актёр из worldStore (source of truth) */
  const storeActor = computed<DnDActor | null>(() => {
    const world = worldStore.getWorldById(props.worldId);

    // Мир хоста хранит акторов в нейтральной форме — сужаем к D&D-форме.
    return (
      (world?.actors.find((actor) => actor.id === props.actorId) as
        DnDActor | undefined) ?? null
    );
  });

  /** Локальная копия актёра для компонента (синхронизируется из store) */
  const localActor = ref<DnDActor | null>(null);

  watch(
    storeActor,
    (newActor) => {
      if (newActor) {
        localActor.value = JSON.parse(JSON.stringify(newActor));
      }
    },
    { immediate: true, deep: true },
  );

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Обработчик обновления актёра из дочернего компонента.
   * Применяет обновления к локальной копии.
   *
   * @param updates - частичные обновления актёра
   */
  function handleActorUpdate(updates: Partial<DnDActor>): void {
    if (!localActor.value) {
      return;
    }

    Object.assign(localActor.value, updates);
  }

  /**
   * Немедленное сохранение актёра на сервер.
   * Вызывается из ActorSpellsTab при кастовании/подготовке заклинаний.
   */
  function handleImmediateSave(): void {
    if (!localActor.value || !props.socket) {
      return;
    }

    try {
      requireSocket(props.socket);

      props.socket.emit('actor:updated', localActor.value);
    } catch (error) {
      console.error('[QuickSpellsModal] Immediate save failed:', error);
    }
  }

  // --- Drag & Drop из компендиума ---

  /**
   * Разрешает drop заклинаний из компендиума.
   */
  function handleDragOver(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    const types = Array.from(event.dataTransfer.types);

    if (types.includes(SPELL_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  /**
   * Обрабатывает drop заклинания из компендиума.
   * Добавляет заклинание в список заклинаний актора и сохраняет на сервер.
   */
  function handleDrop(event: DragEvent): void {
    if (!localActor.value || !event.dataTransfer) {
      return;
    }

    const spellData = event.dataTransfer.getData(SPELL_MIME);

    if (!spellData) {
      return;
    }

    event.preventDefault();

    try {
      const droppedSpell: unknown = JSON.parse(spellData);

      if (!isSpell(droppedSpell)) {
        return;
      }

      const alreadyExists = (localActor.value.spells ?? []).some(
        (spell) => spell.name === droppedSpell.name,
      );

      if (alreadyExists) {
        return;
      }

      const newSpell: Spell = {
        ...droppedSpell,
        id: generateId('spell'),
        prepared: false,
      };

      localActor.value.spells = [...(localActor.value.spells ?? []), newSpell];
      handleImmediateSave();
    } catch {
      /* ошибка парсинга — игнорируем */
    }
  }

  /** Ref на внутренний UDraggableModal */
  const draggableModalRef = ref<InstanceType<typeof UDraggableModal> | null>(
    null,
  );

  defineExpose({
    /** Поднимает окно выше всех остальных */
    bringToFront: () => draggableModalRef.value?.bringToFront(),
    /** Текущий z-index окна (Vue auto-unwrap из expose) */
    localZIndex: computed(() => {
      const zIndex = draggableModalRef.value?.localZIndex;

      return typeof zIndex === 'number' ? zIndex : undefined;
    }),
  });
</script>

<template>
  <UDraggableModal
    ref="draggableModalRef"
    v-model:open="isOpen"
    :draggable="true"
    :resizable="true"
    :min-width="400"
    :min-height="300"
    :initial-width="520"
    initial-height="70vh"
    :title="`Заклинания — ${localActor?.name ?? ''}`"
  >
    <template #body>
      <div
        class="flex h-full flex-col"
        @dragover="handleDragOver"
        @drop="handleDrop"
      >
        <ActorSpellsTab
          v-if="localActor"
          :actor="localActor"
          :is-edit-mode="false"
          @update:actor="handleActorUpdate"
          @immediate-save="handleImmediateSave"
        />
      </div>
    </template>
  </UDraggableModal>
</template>
