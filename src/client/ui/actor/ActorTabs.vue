<script setup lang="ts">
  import type { ExtensionRegistration } from '@/core/extensionRegistry';
  import type { DnDActor } from '@vtt/shared/system/dnd.js';

  import { computed, toRef } from 'vue';

  import { getExtensions } from '@/core/extensionRegistry';
  import { useActiveTab } from '@/shared_ui/composables/useActiveTab';
  import { componentHasProp } from '@/shared_ui/utils/componentUtils';

  import { useCarryingCapacity } from '../../composables/useCarryingCapacity';
  import { useResolvedStats } from '../../composables/useResolvedStats';
  import ActorEffectsTab from './tabs/ActorEffectsTab.vue';
  import ActorEquipmentTab from './tabs/ActorEquipmentTab.vue';
  import ActorFeaturesTab from './tabs/ActorFeaturesTab.vue';
  import ActorNotesTab from './tabs/ActorNotesTab.vue';
  import ActorSpellsTab from './tabs/ActorSpellsTab.vue';

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
    isSpellDragOver?: boolean;
    isEquipmentDragOver?: boolean;
    isFeatureDragOver?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    isSpellDragOver: false,
    isEquipmentDragOver: false,
    isFeatureDragOver: false,
  });

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
    'immediate-save': [];
  }>();

  /**
   * Подсветка вкладки, над которой держат перетаскиваемую сущность.
   *
   * Свечение берёт цвет из `currentColor`, а не из `rgba(var(--color-primary-400), .8)`:
   * токены темы хранят цвет в `oklch()`, и подстановка давала `rgba(oklch(…), .8)` —
   * невалидный CSS, объявление отбрасывалось целиком и подсветки не было вовсе.
   * Здесь же цвет всегда совпадает с текстом вкладки.
   */
  const DRAG_OVER_TAB_CLASS =
    'border-b-2 border-primary text-primary drop-shadow-[0_0_8px_currentColor] transition-all duration-300';

  const { resolvedStats } = useResolvedStats(toRef(() => props.actor));

  // Состояние активной вкладки (сохраняется per-actor между переоткрытиями)
  const { activeTab, setActiveTab } = useActiveTab(
    'actor-sheet',
    toRef(() => props.actor.id),
    'equipment',
  );

  /**
   * Перегрузка: сам переносимый вес показывает вкладка снаряжения, вкладке
   * остаётся только красная подсветка как сигнал.
   */
  const { isOverweight } = useCarryingCapacity(
    toRef(() => props.actor),
    resolvedStats,
  );

  // Базовые вкладки
  const baseTabs = computed(() => {
    return [
      { id: 'equipment', label: 'Снаряжение' },
      { id: 'spells', label: 'Заклинания' },
      { id: 'features', label: 'Особенности' },
      { id: 'effects', label: 'Эффекты' },
      { id: 'notes', label: 'Заметки' },
    ];
  });

  /** Вкладки от модулей (зарегистрированные через registerExtension) */
  const extensionTabs = computed(() => getExtensions('actor-sheet:tabs'));

  /** Все вкладки: базовые + от модулей */
  const allTabs = computed(() => [
    ...baseTabs.value,
    ...extensionTabs.value.map((ext) => ({
      id: `ext:${ext.moduleId}`,
      label: ext.label ?? ext.moduleId,
    })),
  ]);

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

  function getTabClass(tabId: string): string {
    const isActive = activeTab.value === tabId;

    if (tabId === 'spells' && props.isSpellDragOver) {
      return DRAG_OVER_TAB_CLASS;
    }

    if (tabId === 'equipment' && props.isEquipmentDragOver) {
      return DRAG_OVER_TAB_CLASS;
    }

    if (tabId === 'features' && props.isFeatureDragOver) {
      return DRAG_OVER_TAB_CLASS;
    }

    if (tabId === 'equipment' && isOverweight.value) {
      return isActive
        ? 'border-b-2 border-danger text-danger'
        : 'border-b-2 border-transparent text-danger hover:text-danger-muted';
    }

    return isActive
      ? 'border-b-2 border-primary text-primary'
      : 'border-b-2 border-transparent text-muted hover:text-highlighted';
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
  <div class="relative flex flex-1 flex-col space-y-4">
    <!-- Overlay удален, вместо этого подсвечиваем кнопку вкладки Заклинания -->
    <!-- Кнопки вкладок -->
    <!-- Линия под вкладками — тем же токеном, что и остальные линии листа
      (`default`): у `muted` свой, более светлый оттенок, и полоска выбивалась
      из рамок карточек и разделителей под ней -->
    <div class="mb-4 flex gap-4 border-b border-default">
      <button
        v-for="tab in allTabs"
        :key="tab.id"
        :class="[
          'relative pb-2 text-xs font-bold tracking-wider uppercase transition-colors',
          getTabClass(tab.id),
        ]"
        @click.left.exact.prevent="setActiveTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Содержимое вкладок -->
    <div class="flex flex-1 flex-col">
      <ActorEquipmentTab
        v-if="activeTab === 'equipment'"
        :actor="actor"
        :is-edit-mode="isEditMode"
        :is-drag-over="props.isEquipmentDragOver"
        @update:actor="handleUpdate"
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
        :is-drag-over="props.isFeatureDragOver"
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
    </div>
  </div>
</template>
