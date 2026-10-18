<script setup lang="ts">
  /**
   * Окно покупки снаряжения: сколько спишется из кошелька, сколько останется и
   * что именно покупают.
   *
   * Окно ничего не пишет на лист само — оно считает покупку и отдаёт наверх
   * предметы и кошелёк после оплаты. Если денег не хватает, лишнее убирают
   * прямо здесь: возвращаться ради этого к списку компендиума незачем.
   */

  import type { DnDCurrency, DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { formatItemCost } from '@vtt/shared';
  import {
    formatCoins,
    formatCopperAmount,
    summarizePurchase,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTOR_EQUIPMENT_TAB_LABELS,
    EQUIPMENT_PURCHASE_ICON,
    EQUIPMENT_PURCHASE_LABELS,
    EQUIPMENT_PURCHASE_MODAL_SIZE,
    MODAL_BUTTON_LABELS,
  } from './constants';

  /** Строка списка покупок */
  interface PurchaseRow {
    /**
     * Ключ строки — место предмета в списке на момент открытия. Своего ключа у
     * покупки нет: одна и та же запись может прийти из двух компендиумов.
     */
    rowId: string;
    item: DnDGameItem;
  }

  const props = defineProps<{
    open: boolean;
    /** Кошелёк покупателя */
    currency: DnDCurrency;
    /** Предметы, отмеченные к покупке */
    items: DnDGameItem[];
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Покупка подтверждена: что куплено и каким стал кошелёк */
    'confirm': [items: DnDGameItem[], currency: DnDCurrency];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Список покупок — своя копия: строки из него убирают, не трогая отметки */
  const rows = ref<PurchaseRow[]>([]);

  // При открытии список собирается заново из отмеченного
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        rows.value = props.items.map((item, index) => ({
          rowId: String(index),
          item,
        }));
      }
    },
    { immediate: true },
  );

  /** Итог покупки по тому, что осталось в списке */
  const summary = computed(() =>
    summarizePurchase(
      props.currency,
      rows.value.map((row) => row.item),
    ),
  );

  const isShort = computed(() => summary.value.shortageInCopper > 0);

  /** Строки списка с ценой, готовой к показу */
  const displayRows = computed(() =>
    rows.value.map((row) => ({
      rowId: row.rowId,
      name: row.item.name,
      cost: formatItemCost(row.item.cost) || EQUIPMENT_PURCHASE_LABELS.free,
    })),
  );

  /**
   * Плитки итога: что есть, что спишется и что останется. При нехватке третья
   * плитка показывает не остаток, а сколько не хватает, — и краснеет.
   */
  const summaryTiles = computed(() => {
    const walletAfter = summary.value.walletAfter;

    return [
      {
        key: 'wallet',
        label: EQUIPMENT_PURCHASE_LABELS.wallet,
        value: formatCoins(props.currency),
        valueClass: 'text-highlighted',
      },
      {
        key: 'cost',
        label: EQUIPMENT_PURCHASE_LABELS.cost,
        value: formatCopperAmount(summary.value.costInCopper),
        valueClass: 'text-highlighted',
      },
      walletAfter
        ? {
            key: 'remaining',
            label: EQUIPMENT_PURCHASE_LABELS.remaining,
            value: formatCoins(walletAfter),
            valueClass: 'text-success',
          }
        : {
            key: 'shortage',
            label: EQUIPMENT_PURCHASE_LABELS.shortage,
            value: formatCopperAmount(summary.value.shortageInCopper),
            valueClass: 'text-error',
          },
    ];
  });

  /** Текст предупреждения о нехватке денег */
  const shortageMessage = computed(
    () =>
      `${EQUIPMENT_PURCHASE_LABELS.shortagePrefix}${formatCopperAmount(summary.value.shortageInCopper)}`,
  );

  const canConfirm = computed(
    () => rows.value.length > 0 && summary.value.walletAfter !== undefined,
  );

  /**
   * Убирает предмет из покупки.
   *
   * @param rowId - ключ строки списка
   */
  function removeRow(rowId: string): void {
    rows.value = rows.value.filter((row) => row.rowId !== rowId);
  }

  /** Отдаёт покупку наверх и закрывает окно */
  function confirmPurchase(): void {
    const walletAfter = summary.value.walletAfter;

    if (rows.value.length === 0 || !walletAfter) {
      return;
    }

    emit(
      'confirm',
      rows.value.map((row) => row.item),
      walletAfter,
    );

    isOpen.value = false;
  }

  /** Закрывает окно без покупки */
  function cancelPurchase(): void {
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="EQUIPMENT_PURCHASE_MODAL_SIZE.minWidth"
    :min-height="EQUIPMENT_PURCHASE_MODAL_SIZE.minHeight"
    :title="EQUIPMENT_PURCHASE_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-3 gap-2">
          <div
            v-for="tile in summaryTiles"
            :key="tile.key"
            class="flex min-w-0 flex-col gap-1 rounded-lg border border-default/50 bg-elevated/20 p-3"
          >
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ tile.label }}
            </span>

            <span
              class="text-sm font-bold tabular-nums"
              :class="tile.valueClass"
            >
              {{ tile.value }}
            </span>
          </div>
        </div>

        <div
          v-if="isShort"
          class="flex items-start gap-2 rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error"
        >
          <UIcon
            name="tabler:alert-triangle"
            class="mt-0.5 size-4 shrink-0"
          />

          <div class="flex flex-col">
            <span class="font-medium">{{ shortageMessage }}</span>

            <span class="text-xs">
              {{ EQUIPMENT_PURCHASE_LABELS.shortageHint }}
            </span>
          </div>
        </div>

        <div class="space-y-1">
          <h4 class="text-xs font-semibold tracking-wider text-muted uppercase">
            {{ EQUIPMENT_PURCHASE_LABELS.itemsTitle }}
          </h4>

          <div
            v-if="displayRows.length > 0"
            class="flex max-h-64 flex-col divide-y divide-accented/25 overflow-y-auto"
          >
            <div
              v-for="row in displayRows"
              :key="row.rowId"
              class="flex items-center gap-3 px-1 py-1.5"
            >
              <span
                class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted"
              >
                {{ row.name }}
              </span>

              <span
                class="shrink-0 text-xs font-medium text-toned tabular-nums"
              >
                {{ row.cost }}
              </span>

              <UButton
                icon="tabler:x"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="EQUIPMENT_PURCHASE_LABELS.removeItem"
                @click.left.exact.prevent="removeRow(row.rowId)"
              />
            </div>
          </div>

          <p
            v-else
            class="py-4 text-center text-sm text-dimmed"
          >
            {{ EQUIPMENT_PURCHASE_LABELS.empty }}
          </p>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="cancelPurchase"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            :icon="EQUIPMENT_PURCHASE_ICON"
            :disabled="!canConfirm"
            @click.left.exact.prevent="confirmPurchase"
          >
            {{ ACTOR_EQUIPMENT_TAB_LABELS.buy }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
