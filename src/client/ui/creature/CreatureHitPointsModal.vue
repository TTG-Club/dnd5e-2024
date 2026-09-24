<script setup lang="ts">
  import type {
    CreatureHitPoints,
    CreatureSize,
    DnDCustomBonus,
    DnDCustomBonusContext,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    calculateCreatureAverageHitPoints,
    calculateCreatureHitPointsBaseBonus,
    calculateCreatureHitPointsBonus,
    CREATURE_HIT_POINTS_BASE_BONUS_MAX,
    CREATURE_HIT_POINTS_BASE_BONUS_MIN,
    CREATURE_SIZE_LABELS,
    DEFAULT_CREATURE_HIT_DICE_COUNT,
    formatCreatureHitPointsFormula,
    getCreatureHitDieBySize,
    getCustomBonusesValue,
    parseCreatureHitDiceCount,
    parseCreatureHitPointsBaseBonus,
    parseCustomBonuses,
    toStoredCustomBonus,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTOR_LEFT_PANEL_LABELS,
    BONUS_INPUT_FORMAT_OPTIONS,
    HIT_POINTS_LABELS,
    MODAL_BUTTON_LABELS,
  } from '../actor/constants';
  import CustomBonusRows from '../actor/CustomBonusRows.vue';
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
    /**
     * Числа листа для формулы: модификатор Телосложения даёт бонус за каждую
     * кость, а все модификаторы и бонус мастерства — вклад своих бонусов
     */
    context: DnDCustomBonusContext;
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
   * Черновик правки хитов существа. Кости и итогового бонуса здесь нет: их
   * считает движок из размера, Телосложения и своих бонусов, руками задаются
   * число костей, основа бонуса и свои бонусы.
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

  /** Свои бонусы формулы: копии, чтобы до «Применить» лист не менялся */
  const draftBonuses = ref<DnDCustomBonus[]>([]);

  /**
   * Своё число основы бонуса вместо «Телосложение за каждую кость»; `null` —
   * основа считается по правилам и идёт за числом костей.
   */
  const draftBaseBonus = ref<number | null>(null);

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

        // Список приходит из записи мира — разбирается поштучно
        draftBonuses.value = parseCustomBonuses(props.hitPoints.bonuses).map(
          (row) => ({ ...row }),
        );

        draftBaseBonus.value = parseCreatureHitPointsBaseBonus(
          props.hitPoints.baseBonus,
        );
      }
    },
  );

  /** Модификатор Телосложения — бонус за каждую кость */
  const constitutionModifier = computed(
    () => props.context.abilityMods.constitution,
  );

  /**
   * Свои бонусы в том виде, в каком уйдут в лист: число целое и в пределах
   * поля. По ним же считается предпросмотр — иначе он разошёлся бы с записью.
   */
  const storedBonuses = computed(() =>
    draftBonuses.value.map((row) => toStoredCustomBonus(row)),
  );

  /** Вклад своих бонусов — один раз на формулу */
  const customBonus = computed(() =>
    getCustomBonusesValue(props.context, storedBonuses.value),
  );

  /** Кость хитов — по размеру существа */
  const hitDie = computed(() => getCreatureHitDieBySize(props.size));

  /** Основа бонуса: своё число либо Телосложение за каждую кость */
  const baseBonus = computed(() =>
    calculateCreatureHitPointsBaseBonus(
      editHp.hitDiceCount,
      constitutionModifier.value,
      draftBaseBonus.value,
    ),
  );

  /** Основа задана своим числом — показываем кнопку возврата к правилам */
  const isBaseBonusCustom = computed(() => draftBaseBonus.value !== null);

  /** Бонус к хитам — основа и свои бонусы */
  const bonus = computed(() =>
    calculateCreatureHitPointsBonus(baseBonus.value, customBonus.value),
  );

  /**
   * Правка основы бонуса: любое число становится своим, очищенное поле
   * возвращает расчёт по Телосложению.
   *
   * @param value - число из поля (пустое поле — `null`/NaN)
   */
  function setBaseBonus(value: number | null | undefined): void {
    draftBaseBonus.value = parseCreatureHitPointsBaseBonus(value);
  }

  /** Возвращает основу бонуса к расчёту по Телосложению */
  function resetBaseBonus(): void {
    draftBaseBonus.value = null;
  }

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

  /**
   * Откуда взялись кость и бонус: размер с его костью, основа бонуса (своё
   * число или модификатор Телосложения) и свои бонусы сверху.
   */
  const rulesHint = computed(() => {
    const sizePart = `${CREATURE_SIZE_LABELS[props.size]} — ${hitDieLabel.value}`;

    const constitutionPart = formatSignedNumber(constitutionModifier.value);

    const basePart = isBaseBonusCustom.value
      ? CREATURE_HIT_POINTS_LABELS.bonusCustom
      : `${CREATURE_HIT_POINTS_LABELS.bonusByConstitution} (${constitutionPart}) ${CREATURE_HIT_POINTS_LABELS.perDie}`;

    return `${CREATURE_HIT_POINTS_LABELS.dieBySize} (${sizePart}), ${basePart}, ${CREATURE_HIT_POINTS_LABELS.plusCustomBonuses}.`;
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
      baseBonus: draftBaseBonus.value,
      bonuses: storedBonuses.value,
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
    :min-width="440"
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

            <!-- Основа бонуса: по Телосложению, пока не вписано своё число;
              свои бонусы ниже прибавляются к ней -->
            <div class="flex flex-col gap-0.5">
              <span
                class="text-[9px] font-medium tracking-wider text-dimmed uppercase"
              >
                {{ HIT_POINTS_LABELS.bonus }}
              </span>

              <div class="flex items-center gap-1">
                <UInputNumber
                  :model-value="baseBonus"
                  :min="CREATURE_HIT_POINTS_BASE_BONUS_MIN"
                  :max="CREATURE_HIT_POINTS_BASE_BONUS_MAX"
                  :format-options="BONUS_INPUT_FORMAT_OPTIONS"
                  :increment="false"
                  :decrement="false"
                  size="sm"
                  class="w-20"
                  @update:model-value="setBaseBonus"
                />

                <UTooltip
                  v-if="isBaseBonusCustom"
                  :text="CREATURE_HIT_POINTS_LABELS.resetBaseBonus"
                >
                  <UButton
                    icon="tabler:restore"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    square
                    :aria-label="CREATURE_HIT_POINTS_LABELS.resetBaseBonus"
                    @click.left.exact.prevent="resetBaseBonus"
                  />
                </UTooltip>
              </div>
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

        <!-- Свои бонусы формулы: те же строки, что у КД и инициативы, —
          числом, модификатором характеристики или бонусом мастерства -->
        <div class="flex flex-col gap-2">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ CREATURE_HIT_POINTS_LABELS.customBonusesTitle }}
          </span>

          <CustomBonusRows
            v-model="draftBonuses"
            :context="context"
          />
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
