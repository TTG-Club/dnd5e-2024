<script setup lang="ts">
  import type { DnDCurrency } from '@vtt/shared/system/dnd.js';

  import {
    CURRENCY_AMOUNT_MAX,
    CURRENCY_AMOUNT_MIN,
    CURRENCY_OPTIONS,
  } from '@vtt/shared/system/dnd.js';
  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  interface Props {
    open: boolean;
    currency: DnDCurrency;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [currency: DnDCurrency];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const editCurrency = reactive<DnDCurrency>({
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
  });

  // При открытии — подставляем текущий кошелёк актёра
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        Object.assign(editCurrency, props.currency);
      }
    },
    { immediate: true },
  );

  /**
   * Приводит введённое количество монет к целому числу в допустимых границах.
   * Пустое поле `UInputNumber` отдаёт не-число — оно превращается в ноль.
   */
  function normalizeAmount(amount: number): number {
    if (!Number.isFinite(amount)) {
      return CURRENCY_AMOUNT_MIN;
    }

    return Math.min(
      CURRENCY_AMOUNT_MAX,
      Math.max(CURRENCY_AMOUNT_MIN, Math.trunc(amount)),
    );
  }

  /** Отдаёт выправленный кошелёк наверх и закрывает окно */
  function applyCurrency() {
    emit('apply', {
      cp: normalizeAmount(editCurrency.cp),
      sp: normalizeAmount(editCurrency.sp),
      ep: normalizeAmount(editCurrency.ep),
      gp: normalizeAmount(editCurrency.gp),
      pp: normalizeAmount(editCurrency.pp),
    });

    isOpen.value = false;
  }

  /** Закрывает окно, отбрасывая правки черновика */
  function cancelEdit() {
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="380"
    :min-height="300"
    title="Валюта"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <div class="space-y-2">
          <div
            v-for="option in CURRENCY_OPTIONS"
            :key="option.value"
            class="flex items-center justify-between gap-3 rounded-lg border border-default/50 bg-elevated/20 p-3"
          >
            <div class="flex min-w-0 flex-col">
              <span class="text-sm text-toned">{{ option.labelFull }}</span>

              <span
                class="text-[10px] font-bold tracking-wider text-muted uppercase"
                >{{ option.labelShort }}</span
              >
            </div>

            <UInputNumber
              v-model="editCurrency[option.value]"
              :min="CURRENCY_AMOUNT_MIN"
              :max="CURRENCY_AMOUNT_MAX"
              size="sm"
              class="w-32 shrink-0"
            />
          </div>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="cancelEdit"
          >
            Отмена
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applyCurrency"
          >
            Применить
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
