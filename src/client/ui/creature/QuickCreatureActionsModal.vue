<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { CreatureAction, DnDCreature } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import { emitEntityUpdate, findEntityInWorld } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useWorldStore } from '@/stores/worldStore';
  import { isDndCreature } from '@vtt/shared/system/dnd.js';

  import {
    QUICK_PANEL_LABELS,
    QUICK_PANEL_MODAL_SIZE,
  } from '../actor/constants';
  import CreatureActionsTab from './tabs/CreatureActionsTab.vue';

  interface Props {
    open: boolean;
    /**
     * Идентификатор выделенной сущности. Имя пропа задано ядром и общее у трёх
     * быстрых окон панели над хотбаром; кнопку действий ядро показывает только
     * у существа, поэтому чужая сущность сюда не приезжает.
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

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Реактивное существо из worldStore (источник истины).
   *
   * Мир хоста хранит сущности в нейтральной форме, поэтому D&D-форму
   * подтверждает гвард границы: запись чужой системы до окна не доедет.
   */
  const storeCreature = computed<DnDCreature | null>(() => {
    const entity = findEntityInWorld(
      worldStore.getWorldById(props.worldId),
      props.actorId,
    );

    return entity && isDndCreature(entity) ? entity : null;
  });

  /**
   * Локальная копия существа. Своя, а не запись стора: та общая, и править её
   * на месте нельзя — обратно состояние приезжает броадкастом сервера.
   */
  const localCreature = ref<DnDCreature | null>(null);

  watch(
    storeCreature,
    (newCreature) => {
      if (newCreature) {
        localCreature.value = JSON.parse(JSON.stringify(newCreature));
      }
    },
    { immediate: true, deep: true },
  );

  /** Заголовок окна: «Действия — Гоблин» */
  const modalTitle = computed(
    () =>
      `${QUICK_PANEL_LABELS.actionsTitlePrefix}${localCreature.value?.name ?? ''}`,
  );

  /**
   * Отправляет обновлённое существо на сервер.
   *
   * Правки здесь сохраняются сразу: окно быстрое, режима правки с кнопкой
   * «Сохранить» в нём нет — как и в двух соседних окнах панели.
   */
  function saveCreature(): void {
    if (!localCreature.value || !props.socket) {
      return;
    }

    // Событие по типу сущности разводит ядро — своей развилки не держим
    emitEntityUpdate(props.socket, localCreature.value);
  }

  /**
   * Записывает новый список действий в блок `system` и сохраняет.
   *
   * Один обработчик на три простых списка: они лежат в одном блоке и правятся
   * одинаково. Легендарные действия идут своим путём — у них рядом со списком
   * живёт число за раунд, и записывать их надо парой.
   *
   * @param key - какой список действий меняется
   * @param actions - новый список
   */
  function updateActions(
    key: 'actions' | 'bonusActions' | 'reactions',
    actions: CreatureAction[],
  ): void {
    if (!localCreature.value) {
      return;
    }

    localCreature.value.system = {
      ...localCreature.value.system,
      [key]: actions,
    };

    saveCreature();
  }

  /**
   * Записывает список легендарных действий, сохраняя их число за раунд.
   *
   * @param actions - новый список легендарных действий
   */
  function handleLegendaryActionsUpdate(actions: CreatureAction[]): void {
    if (!localCreature.value) {
      return;
    }

    localCreature.value.system = {
      ...localCreature.value.system,
      legendary: { ...localCreature.value.system.legendary, actions },
    };

    saveCreature();
  }

  /**
   * Записывает число легендарных действий за раунд, сохраняя их список.
   *
   * @param count - новое число легендарных действий
   */
  function handleLegendaryCountUpdate(count: number): void {
    if (!localCreature.value) {
      return;
    }

    localCreature.value.system = {
      ...localCreature.value.system,
      legendary: { ...localCreature.value.system.legendary, count },
    };

    saveCreature();
  }

  /**
   * Записывает обычные действия.
   *
   * @param actions - новый список
   */
  function handleActionsUpdate(actions: CreatureAction[]): void {
    updateActions('actions', actions);
  }

  /**
   * Записывает бонусные действия.
   *
   * @param actions - новый список
   */
  function handleBonusActionsUpdate(actions: CreatureAction[]): void {
    updateActions('bonusActions', actions);
  }

  /**
   * Записывает реакции.
   *
   * @param actions - новый список
   */
  function handleReactionsUpdate(actions: CreatureAction[]): void {
    updateActions('reactions', actions);
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
    :title="modalTitle"
  >
    <template #body>
      <div class="flex h-full flex-col">
        <!-- Та же вкладка, что и на листе существа: список действий один, и
          вторая его копия разошлась бы с первой на первой же правке -->
        <CreatureActionsTab
          v-if="localCreature"
          :creature="localCreature"
          :is-edit-mode="false"
          @update:actions="handleActionsUpdate"
          @update:bonus-actions="handleBonusActionsUpdate"
          @update:reactions="handleReactionsUpdate"
          @update:legendary-actions="handleLegendaryActionsUpdate"
          @update:legendary-count="handleLegendaryCountUpdate"
        />
      </div>
    </template>
  </UDraggableModal>
</template>
