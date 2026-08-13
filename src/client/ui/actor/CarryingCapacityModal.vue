<script setup lang="ts">
  import type {
    CreatureSize,
    DnDCarryingCapacity,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    CARRYING_CAPACITY_BONUS_MAX,
    CARRYING_CAPACITY_BONUS_MIN,
    CARRYING_CAPACITY_MAX,
    CARRYING_CAPACITY_MIN,
    CARRYING_CAPACITY_SIZE_MULTIPLIERS,
    CREATURE_SIZE_LABELS,
    CREATURE_SIZES,
    formatWeight,
    getCarryingCapacityBreakdown,
    normalizeCarryingCapacity,
  } from '@vtt/shared/system/dnd.js';

  import {
    BONUS_INPUT_FORMAT_OPTIONS,
    CARRYING_CAPACITY_LABELS,
    MODAL_BUTTON_LABELS,
    WEIGHT_UNIT_LABEL,
  } from './constants';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Текущая настройка предела */
    capacity: DnDCarryingCapacity;
    /** Итоговая Сила актёра (с учётом эффектов) */
    strength: number;
    /** Размер актёра — от него берётся поправка в режиме «как у персонажа» */
    actorSize: CreatureSize;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [capacity: DnDCarryingCapacity];
  }>();

  /** Значение варианта «как у персонажа» в выборе размера для подсчёта */
  const SIZE_AUTO = 'auto';

  /** Выбор размера для подсчёта: свой размер либо «как у персонажа» */
  type SizeChoice = CreatureSize | typeof SIZE_AUTO;

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftCustom = ref(false);
  const draftSize = ref<SizeChoice>(SIZE_AUTO);
  const draftValue = ref(0);
  const draftBonus = ref(0);

  /**
   * Черновик заводится при открытии: окно живёт в листе постоянно, и без этого
   * оно показывало бы значения того актёра, с которым его открыли впервые.
   *
   * Своё значение подставляется из расчёта по правилам — игроку чаще нужно
   * поправить предел, а не набирать его с нуля. Округляем, потому что хранится
   * оно целым, а у Крошечного расчёт даёт половину фунта.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      draftCustom.value = props.capacity.custom !== null;
      draftSize.value = props.capacity.size ?? SIZE_AUTO;
      draftBonus.value = props.capacity.bonus;

      draftValue.value =
        props.capacity.custom
        ?? Math.round(
          getCarryingCapacityBreakdown({
            strength: props.strength,
            size: props.actorSize,
            capacity: props.capacity,
          }).ruleValue,
        );
    },
    { immediate: true },
  );

  /**
   * Число из поля для предпросмотра: очищенное поле отдаёт не-число, и без
   * подстраховки оно расползлось бы по всему разбору. В актёра значения уходят
   * через `normalizeCarryingCapacity` — он их и клампит.
   */
  function toFieldValue(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  /** Настройка из черновика — и для предпросмотра, и для сохранения */
  const draftCapacity = computed<DnDCarryingCapacity>(() => ({
    size: draftSize.value === SIZE_AUTO ? null : draftSize.value,
    custom: draftCustom.value ? toFieldValue(draftValue.value) : null,
    bonus: toFieldValue(draftBonus.value),
  }));

  /** Разбор предпросмотра — той же утилитой, что и лист */
  const breakdown = computed(() =>
    getCarryingCapacityBreakdown({
      strength: props.strength,
      size: props.actorSize,
      capacity: draftCapacity.value,
    }),
  );

  /** Подпись множителя: «×0,5» читается как в тексте правил */
  function multiplierLabel(multiplier: number): string {
    return `×${multiplier.toLocaleString('ru-RU')}`;
  }

  /**
   * Варианты размера для подсчёта: размер актёра и каждая категория со своей
   * поправкой в подписи — так видно, во сколько раз меняется предел.
   */
  const sizeOptions = computed<Array<{ value: SizeChoice; label: string }>>(
    () => [
      {
        value: SIZE_AUTO,
        label:
          `${CARRYING_CAPACITY_LABELS.sizeAsActorPrefix}`
          + `${CREATURE_SIZE_LABELS[props.actorSize].toLowerCase()}${
            CARRYING_CAPACITY_LABELS.sizeAsActorSuffix
          }`,
      },
      ...CREATURE_SIZES.map((size) => ({
        value: size,
        label: `${CREATURE_SIZE_LABELS[size]} · ${multiplierLabel(
          CARRYING_CAPACITY_SIZE_MULTIPLIERS[size],
        )}`,
      })),
    ],
  );

  /** Бонус со знаком для строки разбора */
  const bonusLabel = computed(() => formatSignedNumber(breakdown.value.bonus));

  /** Отдаёт выправленную настройку наверх и закрывает окно */
  function applyCapacity(): void {
    emit('apply', normalizeCarryingCapacity(draftCapacity.value));

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="420"
    :min-height="360"
    :title="CARRYING_CAPACITY_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <UCheckbox
          v-model="draftCustom"
          :label="CARRYING_CAPACITY_LABELS.useCustom"
          :description="CARRYING_CAPACITY_LABELS.useCustomHint"
        />

        <div class="border-t border-muted" />

        <!-- Своё значение предела -->
        <div
          v-if="draftCustom"
          class="flex items-center justify-between gap-4"
        >
          <span class="text-sm text-toned">{{
            CARRYING_CAPACITY_LABELS.customValue
          }}</span>

          <UInputNumber
            v-model="draftValue"
            :min="CARRYING_CAPACITY_MIN"
            :max="CARRYING_CAPACITY_MAX"
            size="sm"
            class="w-40 shrink-0"
          />
        </div>

        <!-- Расчёт по правилам -->
        <template v-else>
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CARRYING_CAPACITY_LABELS.sizeForCalc }}
            </span>

            <USelect
              v-model="draftSize"
              :items="sizeOptions"
              value-key="value"
              label-key="label"
              size="sm"
              class="w-56 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CARRYING_CAPACITY_LABELS.rulesHint }}
          </p>
        </template>

        <!-- Свой бонус -->
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-toned">{{
            CARRYING_CAPACITY_LABELS.bonus
          }}</span>

          <UInputNumber
            v-model="draftBonus"
            :min="CARRYING_CAPACITY_BONUS_MIN"
            :max="CARRYING_CAPACITY_BONUS_MAX"
            :format-options="BONUS_INPUT_FORMAT_OPTIONS"
            size="sm"
            class="w-40 shrink-0"
          />
        </div>

        <p class="text-xs leading-relaxed text-dimmed">
          {{ CARRYING_CAPACITY_LABELS.bonusHint }}
        </p>

        <div class="border-t border-muted" />

        <!-- Разбор расчёта: со своим значением показывать нечего, там предел и
             есть введённое число -->
        <template v-if="!breakdown.custom">
          <div class="flex items-center justify-between gap-4 text-sm">
            <span class="text-toned">{{
              CARRYING_CAPACITY_LABELS.strength
            }}</span>

            <span class="text-toned tabular-nums">{{
              breakdown.strength
            }}</span>
          </div>

          <div class="flex items-center justify-between gap-4 text-sm">
            <span class="text-toned">{{
              CARRYING_CAPACITY_LABELS.sizeFactor
            }}</span>

            <span class="text-toned tabular-nums">
              {{ multiplierLabel(breakdown.sizeMultiplier) }}
            </span>
          </div>

          <div class="flex items-center justify-between gap-4 text-sm">
            <span class="text-toned">{{
              CARRYING_CAPACITY_LABELS.byRules
            }}</span>

            <span class="text-toned tabular-nums">
              {{ formatWeight(breakdown.ruleValue) }}
            </span>
          </div>
        </template>

        <div
          v-if="breakdown.bonus !== 0"
          class="flex items-center justify-between gap-4 text-sm"
        >
          <span class="text-toned">{{
            CARRYING_CAPACITY_LABELS.bonusShort
          }}</span>

          <span class="text-toned tabular-nums">{{ bonusLabel }}</span>
        </div>

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-muted">{{
            CARRYING_CAPACITY_LABELS.total
          }}</span>

          <span class="text-xl font-bold text-highlighted tabular-nums">
            {{ formatWeight(breakdown.value) }} {{ WEIGHT_UNIT_LABEL }}
          </span>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applyCapacity"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
