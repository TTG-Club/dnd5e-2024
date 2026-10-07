<script setup lang="ts">
  import type { ExtensionRegistration } from '@/core/extensionRegistry';
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    DnDActor,
    DnDCarryingCapacity,
    DnDCurrency,
    DnDGameItem,
  } from '@vtt/shared/system/dnd.js';

  import type { SheetTabEntry, SheetTabTone } from './sheetTabsModel';

  import { computed, toRef } from 'vue';

  import { getExtensions } from '@/core/extensionRegistry';
  import { useActiveTab } from '@/shared_ui/composables/useActiveTab';
  import { componentHasProp } from '@/shared_ui/utils/componentUtils';

  import { useCarryingCapacity } from '../../composables/useCarryingCapacity';
  import { useResolvedStats } from '../../composables/useResolvedStats';
  import {
    ACTOR_SHEET_DEFAULT_TAB_ID,
    ACTOR_TAB_LABELS,
    FORM_TAB_LABELS,
    GRANT_SECTION_LABELS,
    SHEET_MAIN_TAB_ID,
    SHEET_TABS_LABELS,
  } from './constants';
  import SheetTabs from './SheetTabs.vue';
  import ActorEffectsTab from './tabs/ActorEffectsTab.vue';
  import ActorEquipmentTab from './tabs/ActorEquipmentTab.vue';
  import ActorFeaturesTab from './tabs/ActorFeaturesTab.vue';
  import ActorNotesTab from './tabs/ActorNotesTab.vue';
  import ActorSpellsTab from './tabs/ActorSpellsTab.vue';

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
    /**
     * WebSocket-клиент. Нужен вкладке особенностей: окно правки черты выбирает
     * из компендиума требуемые записи и выдаваемые заклинания.
     */
    socket?: TypedWebSocketClient | null;
    isSpellDragOver?: boolean;
    isEquipmentDragOver?: boolean;
    isFeatureDragOver?: boolean;
    /**
     * Узкий лист: сводка (здоровье, навыки, спасброски, владения) не стоит
     * колонками слева, а приходит слотом `main` и встаёт первой вкладкой.
     */
    hasMainTab?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    socket: null,
    isSpellDragOver: false,
    isEquipmentDragOver: false,
    isFeatureDragOver: false,
    hasMainTab: false,
  });

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
    'immediate-save': [];
  }>();

  const { resolvedStats } = useResolvedStats(toRef(() => props.actor));

  // Выбор вкладки хранится по персонажу между переоткрытиями листа. Вкладки по
  // умолчанию у хранилища нет намеренно: пустое значение значит «пользователь
  // ещё не выбирал», и тогда вкладку называет раскладка.
  const { activeTab: storedTab, setActiveTab } = useActiveTab(
    'actor-sheet',
    toRef(() => props.actor.id),
  );

  /**
   * Показанная вкладка. Вкладка «Основное» появляется и пропадает вместе с
   * раскладкой: пока вкладку не выбирали, узкий лист открывается на ней, а
   * широкий — на снаряжении. Выбранное «Основное» на широком листе показать
   * негде, и там встаёт снаряжение — сам выбор при этом не затирается и
   * вернётся, когда окно снова сузят.
   */
  const activeTab = computed<string>({
    get: () => {
      if (!storedTab.value) {
        return props.hasMainTab
          ? SHEET_MAIN_TAB_ID
          : ACTOR_SHEET_DEFAULT_TAB_ID;
      }

      if (storedTab.value === SHEET_MAIN_TAB_ID && !props.hasMainTab) {
        return ACTOR_SHEET_DEFAULT_TAB_ID;
      }

      return storedTab.value;
    },
    set: setActiveTab,
  });

  /**
   * Перегрузка: сам переносимый вес показывает вкладка снаряжения, вкладке
   * остаётся только красная подсветка как сигнал.
   */
  const { isOverweight } = useCarryingCapacity(
    toRef(() => props.actor),
    resolvedStats,
  );

  /** Вкладки от модулей (зарегистрированные через registerExtension) */
  const extensionTabs = computed(() => getExtensions('actor-sheet:tabs'));

  /**
   * Особое выделение вкладок: над какой держат перетаскиваемую запись и
   * перегружен ли персонаж. Сам переносимый вес показывает вкладка снаряжения,
   * ленте остаётся только красная подпись как сигнал.
   */
  const tabTones = computed<Record<string, SheetTabTone | undefined>>(() => {
    const equipmentOverweightTone = isOverweight.value ? 'danger' : undefined;

    return {
      spells: props.isSpellDragOver ? 'drop' : undefined,
      equipment: props.isEquipmentDragOver ? 'drop' : equipmentOverweightTone,
      features: props.isFeatureDragOver ? 'drop' : undefined,
    };
  });

  /** Все вкладки: «Основное» узкого листа, базовые и вкладки модулей */
  const allTabs = computed<SheetTabEntry[]>(() => {
    const mainTabs = props.hasMainTab
      ? [{ id: SHEET_MAIN_TAB_ID, label: SHEET_TABS_LABELS.main }]
      : [];

    const baseTabs = [
      { id: 'equipment', label: GRANT_SECTION_LABELS.equipment },
      { id: 'spells', label: GRANT_SECTION_LABELS.spells },
      { id: 'features', label: GRANT_SECTION_LABELS.features },
      { id: 'effects', label: FORM_TAB_LABELS.effects },
      { id: 'notes', label: ACTOR_TAB_LABELS.notes },
    ].map((tab) => ({ ...tab, tone: tabTones.value[tab.id] }));

    const moduleTabs = extensionTabs.value.map((ext) => ({
      id: `ext:${ext.moduleId}`,
      label: ext.label ?? ext.moduleId,
    }));

    return [...mainTabs, ...baseTabs, ...moduleTabs];
  });

  /** Активное расширение (если выбрана вкладка модуля) */
  const activeExtension = computed(() => {
    if (!activeTab.value.startsWith('ext:')) {
      return null;
    }

    const moduleId = activeTab.value.replace('ext:', '');

    return extensionTabs.value.find((ext) => ext.moduleId === moduleId) ?? null;
  });

  // Проброс обновлений актора
  function handleUpdate(updates: Partial<DnDActor>) {
    emit('update:actor', updates);
  }

  /**
   * Кладёт новый инвентарь в актора. Панель снаряжения отдаёт только сам
   * список: куда его положить, знает лист, а не она.
   *
   * @param equipment - новый инвентарь
   */
  function handleEquipmentUpdate(equipment: DnDGameItem[]): void {
    handleUpdate({ equipment });
  }

  /**
   * Кладёт новый кошелёк в блок `system` актора.
   *
   * @param currency - новый кошелёк
   */
  function handleCurrencyUpdate(currency: DnDCurrency): void {
    handleUpdate({ system: { ...props.actor.system, currency } });
  }

  /**
   * Кладёт настройку предела переносимого веса в блок `system` актора.
   *
   * @param carryingCapacity - новая настройка предела
   */
  function handleCarryingCapacityUpdate(
    carryingCapacity: DnDCarryingCapacity,
  ): void {
    handleUpdate({ system: { ...props.actor.system, carryingCapacity } });
  }

  function getExtensionProps(
    ext: ExtensionRegistration,
  ): Record<string, unknown> {
    const bindProps: Record<string, unknown> = {
      actor: props.actor,
      isEditMode: props.isEditMode,
    };

    if (
      componentHasProp(ext.component, 'moduleId')
      || componentHasProp(ext.component, 'module-id')
    ) {
      bindProps.moduleId = ext.moduleId;
    }

    return bindProps;
  }
</script>

<template>
  <SheetTabs
    v-model="activeTab"
    :tabs="allTabs"
  >
    <!-- Сводка узкого листа: её собирает сам лист и отдаёт слотом -->
    <slot
      v-if="activeTab === SHEET_MAIN_TAB_ID"
      name="main"
    />

    <ActorEquipmentTab
      v-if="activeTab === 'equipment'"
      :entity="actor"
      :is-edit-mode="isEditMode"
      :is-drag-over="props.isEquipmentDragOver"
      show-currency
      show-carrying-capacity
      show-add-button
      allow-hotbar-drag
      @update:equipment="handleEquipmentUpdate"
      @update:currency="handleCurrencyUpdate"
      @update:carrying-capacity="handleCarryingCapacityUpdate"
      @immediate-save="emit('immediate-save')"
    />

    <ActorSpellsTab
      v-if="activeTab === 'spells'"
      :actor="actor"
      :is-edit-mode="isEditMode"
      :is-drag-over="props.isSpellDragOver"
      @update:actor="handleUpdate"
      @immediate-save="emit('immediate-save')"
    />

    <ActorFeaturesTab
      v-if="activeTab === 'features'"
      :actor="actor"
      :is-edit-mode="isEditMode"
      :socket="socket"
      :is-drag-over="props.isFeatureDragOver"
      allow-hotbar-drag
      @update:actor="handleUpdate"
      @immediate-save="emit('immediate-save')"
    />

    <ActorEffectsTab
      v-if="activeTab === 'effects'"
      :actor="actor"
      :is-edit-mode="isEditMode"
      @update:actor="handleUpdate"
      @immediate-save="emit('immediate-save')"
    />

    <ActorNotesTab
      v-if="activeTab === 'notes'"
      :actor="actor"
      :is-edit-mode="isEditMode"
      @update:actor="handleUpdate"
    />

    <!-- Вкладки от модулей -->
    <component
      :is="activeExtension.component"
      v-if="activeExtension"
      v-bind="getExtensionProps(activeExtension)"
      @update:actor="handleUpdate"
    />
  </SheetTabs>
</template>
