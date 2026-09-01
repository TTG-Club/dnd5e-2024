<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    DnDCarryingCapacity,
    DnDCurrency,
    DnDGameItem,
    DnDSceneEntity,
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
  import {
    isDnDGameItem,
    isDndSceneEntity,
    normalizeCompendiumItem,
  } from '@vtt/shared/system/dnd.js';

  import {
    GAME_ITEM_MIME,
    QUICK_PANEL_LABELS,
    QUICK_PANEL_MODAL_SIZE,
  } from './constants';
  import ActorEquipmentTab from './tabs/ActorEquipmentTab.vue';

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
   * гвард границы, а не приведение типа: запись чужой системы или недогруженная
   * до панели не доедет.
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

  /**
   * Лист персонажа, если выделен он. Кошелёк и предел переносимого веса живут в
   * его блоке `system`; у существа предела нет, а кошелёк правится своим путём.
   */
  const localActorSheet = computed(() =>
    localActor.value && isActorEntity(localActor.value)
      ? localActor.value
      : null,
  );

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Кладёт новый инвентарь в локальную копию сущности.
   *
   * @param equipment - новый инвентарь
   */
  function handleEquipmentUpdate(equipment: DnDGameItem[]): void {
    if (!localActor.value) {
      return;
    }

    localActor.value.equipment = equipment;
  }

  /**
   * Кладёт новый кошелёк в блок `system` локальной копии. Кошелёк есть у обоих
   * листов, и поле в блоке называется одинаково.
   *
   * @param currency - новый кошелёк
   */
  function handleCurrencyUpdate(currency: DnDCurrency): void {
    if (!localActor.value) {
      return;
    }

    localActor.value.system = { ...localActor.value.system, currency };
  }

  /**
   * Кладёт настройку предела переносимого веса в блок `system` копии. Только у
   * листа персонажа: у существа предел всегда считается по правилам.
   *
   * @param carryingCapacity - новая настройка предела
   */
  function handleCarryingCapacityUpdate(
    carryingCapacity: DnDCarryingCapacity,
  ): void {
    const actor = localActorSheet.value;

    if (!actor) {
      return;
    }

    actor.system = { ...actor.system, carryingCapacity };
  }

  /**
   * Немедленное сохранение актёра на сервер.
   * Вызывается из ActorEquipmentTab при экипировке/удалении предметов.
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
      console.error('[QuickEquipmentModal] Immediate save failed:', error);
    }
  }

  // --- Drag & Drop из компендиума ---

  /**
   * Разрешает drop предметов из компендиума.
   */
  function handleDragOver(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    const types = Array.from(event.dataTransfer.types);

    if (types.includes(GAME_ITEM_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  /**
   * Обрабатывает drop предмета из компендиума.
   * Добавляет предмет в инвентарь актора и сохраняет на сервер.
   */
  function handleDrop(event: DragEvent): void {
    if (!localActor.value || !event.dataTransfer) {
      return;
    }

    const equipData = event.dataTransfer.getData(GAME_ITEM_MIME);

    if (!equipData) {
      return;
    }

    event.preventDefault();

    try {
      const parsedItem: unknown = JSON.parse(equipData);

      if (!isDnDGameItem(parsedItem)) {
        return;
      }

      const alreadyExists = (localActor.value.equipment ?? []).some(
        (item) => item.id === parsedItem.id,
      );

      if (alreadyExists) {
        return;
      }

      const newItem: DnDGameItem = normalizeCompendiumItem({
        ...parsedItem,
        id: generateId('eq'),
        isReadOnly: false,
        equipped: false,
      });

      localActor.value.equipment = [
        ...(localActor.value.equipment ?? []),
        newItem,
      ];

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
    :title="`${QUICK_PANEL_LABELS.equipmentTitlePrefix}${localActor?.name ?? ''}`"
  >
    <template #body>
      <div
        class="flex h-full flex-col"
        @dragover="handleDragOver"
        @drop="handleDrop"
      >
        <ActorEquipmentTab
          v-if="localActor"
          :entity="localActor"
          :is-edit-mode="false"
          show-currency
          :show-carrying-capacity="Boolean(localActorSheet)"
          :allow-hotbar-drag="Boolean(localActorSheet)"
          @update:equipment="handleEquipmentUpdate"
          @update:currency="handleCurrencyUpdate"
          @update:carrying-capacity="handleCarryingCapacityUpdate"
          @immediate-save="handleImmediateSave"
        />
      </div>
    </template>
  </UDraggableModal>
</template>
