<script setup lang="ts">
  import type {
    CreatureHitPoints,
    CreatureSize,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    calculateCreatureAverageHitPoints,
    calculateCreatureHitPointsBonus,
    CREATURE_SIZE_LABELS,
    DEFAULT_CREATURE_HIT_DICE_COUNT,
    formatCreatureHitPointsFormula,
    getCreatureHitDieBySize,
    parseCreatureHitDiceCount,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTOR_LEFT_PANEL_LABELS,
    HIT_POINTS_LABELS,
    MODAL_BUTTON_LABELS,
  } from '../actor/constants';
  import { formatSignedNumber } from '../actor/utils/formatSignedNumber';
  import {
    CREATURE_COMBAT_LABELS,
    CREATURE_HIT_POINTS_LABELS,
  } from './constants';

  interface Props {
    open: boolean;
    hitPoints: CreatureHitPoints;
    /** Размер существа — по правилам 2024 он задаёт кость хитов */
    size: CreatureSize;
    /** Модификатор Телосложения для формулы — бонус за каждую кость хитов */
    constitutionModifier: number;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [data: Partial<CreatureHitPoints>];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Черновик правки хитов существа. Кости и бонуса здесь нет: их считает
   * движок из размера и Телосложения, руками задаётся только число костей.
   */
  interface EditableHitPoints {
    current: number;
    max: number;
    temp: number;
    hitDiceCount: number;
  }

  const editHp = reactive<EditableHitPoints>({
    current: 0,
    max: 1,
    temp: 0,
    hitDiceCount: DEFAULT_CREATURE_HIT_DICE_COUNT,
  });

  // При открытии — подставляем текущие значения
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        editHp.current =
          props.hitPoints.current ?? props.hitPoints.average ?? 0;

        editHp.max = props.hitPoints.max ?? props.hitPoints.average ?? 1;
        editHp.temp = props.hitPoints.temp ?? 0;

        // У существа из компендиума число костей есть только в формуле
        editHp.hitDiceCount =
          props.hitPoints.hitDiceCount
          ?? parseCreatureHitDiceCount(props.hitPoints.formula)
          ?? DEFAULT_CREATURE_HIT_DICE_COUNT;
      }
    },
  );

  /** Кость хитов — по размеру существа */
  const hitDie = computed(() => getCreatureHitDieBySize(props.size));

  /** Бонус к хитам — Телосложение за каждую кость */
  const bonus = computed(() =>
    calculateCreatureHitPointsBonus(
      editHp.hitDiceCount,
      props.constitutionModifier,
    ),
  );

  const formula = computed(() =>
    formatCreatureHitPointsFormula(
      editHp.hitDiceCount,
      hitDie.value,
      bonus.value,
    ),
  );

  const average = computed(() =>
    calculateCreatureAverageHitPoints(
      editHp.hitDiceCount,
      hitDie.value,
      bonus.value,
    ),
  );

  /** Кость в записи листа: «к10» */
  const hitDieLabel = computed(
    () => `${ACTOR_LEFT_PANEL_LABELS.hitDieLetter}${hitDie.value}`,
  );

  const formattedBonus = computed(() => formatSignedNumber(bonus.value));

  /**
   * Откуда взялись кость и бонус: размер с его костью и модификатор
   * Телосложения. Без этой строки поля выглядят просто запертыми.
   */
  const rulesHint = computed(() => {
    const sizePart = `${CREATURE_SIZE_LABELS[props.size]} — ${hitDieLabel.value}`;

    const constitutionPart = formatSignedNumber(props.constitutionModifier);

    return `${CREATURE_HIT_POINTS_LABELS.dieBySize} (${sizePart}), ${CREATURE_HIT_POINTS_LABELS.bonusByConstitution} (${constitutionPart}) ${CREATURE_HIT_POINTS_LABELS.perDie}.`;
  });

  /** Применяет изменения очков здоровья */
  function applyHitPoints() {
    emit('apply', {
      current: editHp.current,
      max: editHp.max,
      temp: editHp.temp,
      hitDie: hitDie.value,
      hitDiceCount: editHp.hitDiceCount,
      bonus: bonus.value,
      formula: formula.value,
      average: average.value,
    });

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
    :min-height="200"
    :title="HIT_POINTS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Текущие / Максимум -->
        <div class="flex items-center gap-4">
          <div class="flex flex-1 flex-col gap-1">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ HIT_POINTS_LABELS.current }}
            </span>

            <UInput
              :model-value="editHp.current"
              type="number"
              :min="0"
              size="lg"
              @update:model-value="editHp.current = Number($event)"
            />
          </div>

          <span class="mt-5 text-2xl font-light text-dimmed">/</span>

          <div class="flex flex-1 flex-col gap-1">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ HIT_POINTS_LABELS.total }}
            </span>

            <UInput
              :model-value="editHp.max"
              type="number"
              :min="1"
              size="lg"
              @update:model-value="editHp.max = Number($event)"
            />
          </div>

          <div class="flex flex-1 flex-col gap-1">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ HIT_POINTS_LABELS.temporary }}
            </span>

            <UInput
              :model-value="editHp.temp"
              type="number"
              :min="0"
              size="lg"
              @update:model-value="editHp.temp = Math.max(0, Number($event))"
            />
          </div>
        </div>

        <div class="border-t border-muted" />

        <!-- Кости хитов -->
        <div class="flex flex-col gap-2">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ HIT_POINTS_LABELS.formula }}
          </span>

          <div class="flex items-center gap-2 rounded bg-elevated/40 p-2">
            <!-- Количество костей -->
            <div class="flex flex-col gap-0.5">
              <span
                class="text-[9px] font-medium tracking-wider text-dimmed uppercase"
              >
                {{ HIT_POINTS_LABELS.amount }}
              </span>

              <UInput
                :model-value="editHp.hitDiceCount"
                type="number"
                :min="1"
                size="sm"
                class="w-16"
                @update:model-value="
                  editHp.hitDiceCount = Math.max(1, Number($event))
                "
              />
            </div>

            <span class="mt-4 font-light text-dimmed">×</span>

            <!-- Кость: по размеру, не правится -->
            <div class="flex flex-1 flex-col gap-0.5">
              <span
                class="text-[9px] font-medium tracking-wider text-dimmed uppercase"
              >
                {{ HIT_POINTS_LABELS.die }}
              </span>

              <span
                class="rounded border border-muted px-2 py-1 text-sm font-medium text-toned tabular-nums"
              >
                {{ hitDieLabel }}
              </span>
            </div>

            <span class="mt-4 font-light text-dimmed">+</span>

            <!-- Бонус: по Телосложению, не правится -->
            <div class="flex flex-col gap-0.5">
              <span
                class="text-[9px] font-medium tracking-wider text-dimmed uppercase"
              >
                {{ HIT_POINTS_LABELS.bonus }}
              </span>

              <span
                class="w-16 rounded border border-muted px-2 py-1 text-center text-sm font-medium text-toned tabular-nums"
              >
                {{ formattedBonus }}
              </span>
            </div>
          </div>

          <div
            class="mt-1 flex items-center justify-between text-xs text-dimmed"
          >
            <span
              >{{ CREATURE_COMBAT_LABELS.formulaPrefix }} {{ formula }}</span
            >

            <span
              >{{ CREATURE_COMBAT_LABELS.averagePrefix }} {{ average }}</span
            >
          </div>

          <p class="text-xs text-dimmed">
            {{ rulesHint }}
          </p>
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
            @click.left.exact.prevent="applyHitPoints"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
