<!--
  Строка состояния в «Мастерской»: значок, название и пометка о происхождении
  (канон системы, правка канона или своё состояние стола).
-->
<script setup lang="ts">
  import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    DEFAULT_CONDITION_ICON,
    isCanonConditionKey,
    readConditionSystemData,
  } from '@vtt/shared/system/dnd.js';

  import { useContextMenu } from '../../composables/useContextMenu';
  import ContextMenuOverlay from '../actor/ContextMenuOverlay.vue';
  import ConditionBadge from './ConditionBadge.vue';
  import { CONDITION_LABELS } from './conditionConsts';

  const props = defineProps<{
    /** Запись состояния (мира или пресет системы) */
    item: DnDGameItem;
    /** Показывать «Скопировать в предметы» в контекстном меню */
    showCopy?: boolean;
    /** Показывать «Редактировать» в контекстном меню */
    showEdit?: boolean;
    /** Показывать «Удалить» в контекстном меню */
    showDelete?: boolean;
    /**
     * Стоимость и вес карточка состояния не показывает — их у состояния нет.
     * Пропсы объявлены, потому что мастерская передаёт их КАЖДОЙ карточке, а
     * строка состояния рисует фрагмент (карточка + контекстное меню): унаследовать
     * необъявленный атрибут не на что, и Vue ругается «Extraneous non-props
     * attributes».
     */
    showCost?: boolean;
    /** См. `showCost` */
    showWeight?: boolean;
  }>();

  const emit = defineEmits<{
    /** Клик по строке (открыть карточку состояния) */
    click: [];
    /** Скопировать в предметы */
    copy: [];
    /** Редактировать */
    edit: [];
    /** Удалить */
    delete: [];
  }>();

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit);

  const systemData = computed(() => readConditionSystemData(props.item));

  const icon = computed(() => systemData.value?.icon ?? DEFAULT_CONDITION_ICON);

  /**
   * Пометка происхождения. Канон в мастерской не хранится, поэтому запись с
   * канонным ключом — это его правка; своё состояние стола не подписывается:
   * подпись у каждой второй строки была бы шумом.
   */
  const originLabel = computed(() => {
    const key = systemData.value?.conditionKey;

    return key && isCanonConditionKey(key) ? CONDITION_LABELS.overridden : '';
  });

  const hasEffect = computed(() => (props.item.activeEffects?.length ?? 0) > 0);
</script>

<template>
  <div
    class="flex cursor-pointer items-center gap-3 rounded-lg bg-elevated/30 px-3 py-2 transition-colors hover:bg-accented/40"
    @click.left.exact.prevent="$emit('click')"
    @contextmenu="openContextMenu"
  >
    <ConditionBadge
      :icon="icon"
      :image="item.image"
      class="text-primary"
    />

    <span class="flex-1 truncate text-sm font-medium text-highlighted">
      {{ item.name }}
    </span>

    <span
      v-if="!hasEffect"
      class="shrink-0 text-xs text-dimmed"
    >
      {{ CONDITION_LABELS.markOnly }}
    </span>

    <UBadge
      v-if="originLabel"
      color="neutral"
      variant="subtle"
      size="sm"
      class="shrink-0"
    >
      {{ originLabel }}
    </UBadge>
  </div>

  <ContextMenuOverlay
    :is-open="isMenuOpen"
    :pos-x="menuX"
    :pos-y="menuY"
    :show-copy="showCopy"
    :show-edit="showEdit"
    :show-delete="showDelete"
    @action="handleAction"
    @close="closeMenu"
  />
</template>
