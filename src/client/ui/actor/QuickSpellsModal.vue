<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    CreatureSpellcasting,
    DnDActor,
    DnDCreature,
    DnDSceneEntity,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import {
    emitEntityUpdate,
    findEntityInWorld,
    requireSocket,
  } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useWorldStore } from '@/stores/worldStore';
  import { generateId, isActorEntity } from '@vtt/shared';
  import { isDndSceneEntity, isSpell } from '@vtt/shared/system/dnd.js';

  import CreatureSpellsBlock from '../creature/CreatureSpellsBlock.vue';
  import {
    QUICK_PANEL_LABELS,
    QUICK_PANEL_MODAL_SIZE,
    SPELL_MIME,
  } from './constants';
  import ActorSpellsTab from './tabs/ActorSpellsTab.vue';

  interface Props {
    open: boolean;
    /**
     * Идентификатор выделенной сущности. Имя пропа историческое — панель над
     * хотбаром одна на актёра и существо, и сюда приезжает идентификатор любой
     * из них.
     */
    actorId: string;
    worldId: string;
    socket: TypedWebSocketClient | null;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
  }>();

  const worldStore = useWorldStore();

  /**
   * Реактивная сущность из worldStore (источник истины) — актёр или существо.
   *
   * Мир хоста хранит их в нейтральной форме, поэтому D&D-форму подтверждает
   * гвард границы, а не приведение типа.
   */
  const storeEntity = computed<DnDSceneEntity | null>(() => {
    const entity = findEntityInWorld(
      worldStore.getWorldById(props.worldId),
      props.actorId,
    );

    return entity && isDndSceneEntity(entity) ? entity : null;
  });

  /** Локальная копия сущности для компонента (синхронизируется из store) */
  const localActor = ref<DnDSceneEntity | null>(null);

  watch(
    storeEntity,
    (newEntity) => {
      if (newEntity) {
        localActor.value = JSON.parse(JSON.stringify(newEntity));
      }
    },
    { immediate: true, deep: true },
  );

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Лист персонажа, если выделен он: у него заклинания живут ячейками и
   * подготовкой, и вкладка своя.
   */
  const localActorSheet = computed<DnDActor | null>(() =>
    localActor.value && isActorEntity(localActor.value)
      ? localActor.value
      : null,
  );

  /** Статблок существа, если выделено оно */
  const localCreature = computed<DnDCreature | null>(() =>
    localActor.value && !isActorEntity(localActor.value)
      ? localActor.value
      : null,
  );

  /**
   * Обработчик обновления актёра из дочернего компонента.
   * Применяет обновления к локальной копии.
   *
   * @param updates - частичные обновления актёра
   */
  function handleActorUpdate(updates: Partial<DnDActor>): void {
    const actor = localActorSheet.value;

    if (!actor) {
      return;
    }

    Object.assign(actor, updates);
  }

  /**
   * Записывает новый список заклинаний существа и сразу сохраняет: у статблока
   * нет режима правки с кнопкой «Сохранить».
   *
   * @param spells - новый список заклинаний
   */
  function handleCreatureSpellsUpdate(spells: Spell[]): void {
    if (!localCreature.value) {
      return;
    }

    localCreature.value.spells = spells;
    handleImmediateSave();
  }

  /**
   * Записывает параметры заклинательства существа и сразу сохраняет.
   *
   * @param spellcasting - новые параметры заклинательства
   */
  function handleCreatureSpellcastingUpdate(
    spellcasting: CreatureSpellcasting,
  ): void {
    if (!localCreature.value) {
      return;
    }

    localCreature.value.system = {
      ...localCreature.value.system,
      spellcasting,
    };

    handleImmediateSave();
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

      // Событие по типу сущности разводит ядро — своей развилки не держим
      emitEntityUpdate(props.socket, localActor.value);
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
    :min-width="QUICK_PANEL_MODAL_SIZE.minWidth"
    :min-height="QUICK_PANEL_MODAL_SIZE.minHeight"
    :initial-width="QUICK_PANEL_MODAL_SIZE.initialWidth"
    :initial-height="QUICK_PANEL_MODAL_SIZE.initialHeight"
    :title="`${QUICK_PANEL_LABELS.spellsTitlePrefix}${localActor?.name ?? ''}`"
  >
    <template #body>
      <div
        class="flex h-full flex-col"
        @dragover="handleDragOver"
        @drop="handleDrop"
      >
        <ActorSpellsTab
          v-if="localActorSheet"
          :actor="localActorSheet"
          :is-edit-mode="false"
          @update:actor="handleActorUpdate"
          @immediate-save="handleImmediateSave"
        />

        <!-- Статблок существа: свой блок заклинательства (плоские DC и бонус
          атаки, заряды вместо ячеек) -->
        <CreatureSpellsBlock
          v-else-if="localCreature"
          :creature="localCreature"
          :spells="localCreature.spells"
          :spellcasting="localCreature.system.spellcasting"
          :is-edit-mode="false"
          :creature-id="localCreature.id"
          :creature-name="localCreature.name"
          can-edit
          @update:spells="handleCreatureSpellsUpdate"
          @update:spellcasting="handleCreatureSpellcastingUpdate"
        />
      </div>
    </template>
  </UDraggableModal>
</template>
