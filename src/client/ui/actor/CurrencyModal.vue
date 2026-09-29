<script setup lang="ts">
  import type { CurrencyType, DnDCurrency } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    CURRENCY_OPTIONS,
    resolveCurrencyAmountInput,
  } from '@vtt/shared/system/dnd.js';

  import { CURRENCY_MODAL_LABELS, MODAL_BUTTON_LABELS } from './constants';
  import { selectInputOnFocus } from './utils/selectInputOnFocus';

  interface Props {
    open: boolean;
    currency: DnDCurrency;
  }

  /** Итог по строке кошелька: что запишется, и нужно ли показать его под полем */
  interface CurrencyRowState {
    amount: number | undefined;
    isInvalid: boolean;
    showsResult: boolean;
    inputColor: 'error' | 'primary';
  }

  /**
   * Считает строку кошелька по вводу. Итог под полем виден, только когда в
   * поле выражение: сверка строкой, а не числом — `Number('+15')` равно 15, и
   * при пустом кошельке итог бы пропал.
   */
  function resolveCurrencyRow(
    input: string,
    currentAmount: number,
  ): CurrencyRowState {
    const amount = resolveCurrencyAmountInput(input, currentAmount);
    const isInvalid = amount === undefined;

    return {
      amount,
      isInvalid,
      inputColor: isInvalid ? 'error' : 'primary',
      showsResult: !isInvalid && String(amount) !== input.trim(),
    };
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

  /**
   * Ввод монет строкой, а не числом: поле считает как поле хитов у фишки —
   * «+15» прибавляет к текущему, «-3» отнимает, число задаёт. `UInputNumber`
   * знак впереди считает мусором и такой ввод не пропускает.
   */
  const editInputs = reactive<Record<CurrencyType, string>>({
    cp: '',
    sp: '',
    ep: '',
    gp: '',
    pp: '',
  });

  /**
   * Итоги всех строк сразу — по одному на вид монет, чтобы шаблон и
   * «Применить» читали один и тот же подсчёт.
   */
  const rowStates = computed<Record<CurrencyType, CurrencyRowState>>(() => ({
    cp: resolveCurrencyRow(editInputs.cp, props.currency.cp),
    sp: resolveCurrencyRow(editInputs.sp, props.currency.sp),
    ep: resolveCurrencyRow(editInputs.ep, props.currency.ep),
    gp: resolveCurrencyRow(editInputs.gp, props.currency.gp),
    pp: resolveCurrencyRow(editInputs.pp, props.currency.pp),
  }));

  const hasInvalidInput = computed(() =>
    Object.values(rowStates.value).some((row) => row.isInvalid),
  );

  // При открытии — подставляем текущий кошелёк актёра
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        for (const option of CURRENCY_OPTIONS) {
          editInputs[option.value] = String(props.currency[option.value]);
        }
      }
    },
    { immediate: true },
  );

  /** Отдаёт посчитанный кошелёк наверх и закрывает окно */
  function applyCurrency() {
    const { cp, sp, ep, gp, pp } = rowStates.value;

    // Неразобранный ввод не пишется: иначе опечатка обнулила бы кошелёк
    if (
      cp.amount === undefined
      || sp.amount === undefined
      || ep.amount === undefined
      || gp.amount === undefined
      || pp.amount === undefined
    ) {
      return;
    }

    emit('apply', {
      cp: cp.amount,
      sp: sp.amount,
      ep: ep.amount,
      gp: gp.amount,
      pp: pp.amount,
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
    :title="CURRENCY_MODAL_LABELS.title"
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

            <div class="flex w-32 shrink-0 flex-col items-end gap-1">
              <!-- Enter в поле = «Применить»: правка сводится к вводу числа -->
              <UInput
                v-model="editInputs[option.value]"
                size="sm"
                class="w-full"
                :color="rowStates[option.value].inputColor"
                :highlight="rowStates[option.value].isInvalid"
                :ui="{ base: 'tabular-nums text-right' }"
                @focus="selectInputOnFocus"
                @keydown.enter.prevent="applyCurrency"
              />

              <span
                v-if="rowStates[option.value].isInvalid"
                class="text-[10px] text-error"
              >
                {{ CURRENCY_MODAL_LABELS.invalid }}
              </span>

              <span
                v-else-if="rowStates[option.value].showsResult"
                class="text-xs font-medium text-toned tabular-nums"
              >
                {{ CURRENCY_MODAL_LABELS.resultPrefix }}
                {{ rowStates[option.value].amount }}
              </span>
            </div>
          </div>
        </div>

        <p class="text-xs text-dimmed">
          {{ CURRENCY_MODAL_LABELS.hint }}
        </p>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="cancelEdit"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            :disabled="hasInvalidInput"
            @click.left.exact.prevent="applyCurrency"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
