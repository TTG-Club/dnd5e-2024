<!--
  Карточка состояния: значок, названия, описание и вкладка «Эффекты» с разбором
  того, что состояние накладывает, пока висит на сущности.

  Вкладки те же, что у карточек предметов (`ItemDetailTabs`): состояние читают
  там же, где оружие и заклинания, и разнобой в карточках был бы заметен.
-->
<script setup lang="ts">
  import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import {
    DEFAULT_CONDITION_ICON,
    readConditionSystemData,
  } from '@vtt/shared/system/dnd.js';

  import ItemDetailTabs from '../actor/ItemDetailTabs.vue';
  import ItemEffectsView from '../actor/ItemEffectsView.vue';
  import ConditionBadge from './ConditionBadge.vue';
  import { CONDITION_DETAIL_LABELS, CONDITION_LABELS } from './conditionConsts';

  const props = defineProps<{
    /** Открыто ли окно */
    open: boolean;
    /** Состояние для показа */
    item: DnDGameItem | null;
    /** Скрытые пропсы менеджера окон — чтобы не было предупреждений */
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
    /** Z-index окна (управляется менеджером окон) */
    zIndex?: number;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'bring-to-front': [];
  }>();

  const icon = computed(
    () => readConditionSystemData(props.item)?.icon ?? DEFAULT_CONDITION_ICON,
  );

  const effects = computed(() => props.item?.activeEffects ?? []);
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="item?.name ?? CONDITION_LABELS.kind"
    :subtitle="item?.nameEn || undefined"
    :initial-width="480"
    :min-width="320"
    :min-height="240"
    :resizable="false"
    :z-index="zIndex"
    @update:open="emit('update:open', $event)"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <ItemDetailTabs v-if="item">
        <!-- Вкладка «Основное»: значок и описание -->
        <template #general>
          <div class="flex flex-col gap-4">
            <div class="flex items-center gap-3">
              <div
                class="flex size-12 shrink-0 items-center justify-center rounded-lg border border-default/50 bg-elevated/30 text-primary"
              >
                <ConditionBadge
                  :icon="icon"
                  :image="item.image"
                  :size="28"
                />
              </div>

              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ item.name }}
                </p>

                <p
                  v-if="item.nameEn"
                  class="truncate text-xs text-dimmed"
                >
                  {{ item.nameEn }}
                </p>
              </div>
            </div>

            <div v-if="item.description">
              <span
                class="mb-1.5 block text-xs font-semibold tracking-wider text-dimmed uppercase"
              >
                {{ CONDITION_DETAIL_LABELS.description }}
              </span>

              <ItemDescriptionRenderer :content="item.description" />
            </div>
          </div>
        </template>

        <!-- Вкладка «Эффекты»: разбор эффекта состояния -->
        <template #effects>
          <ItemEffectsView
            v-if="effects.length > 0"
            :effects="effects"
            :owner-name="item.name"
          />

          <p
            v-else
            class="text-sm text-dimmed"
          >
            {{ CONDITION_DETAIL_LABELS.noEffect }}
          </p>
        </template>
      </ItemDetailTabs>
    </template>
  </UDraggableModal>
</template>
