<script setup lang="ts">
  import type { ActorMovement, MovementType } from '@vtt/shared';
  import type {
    ActiveEffect,
    DnDCustomBonus,
    DnDCustomBonusContext,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, ref, watch } from 'vue';

  import { generateEntityId } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { DISTANCE_UNIT_OPTIONS } from '@vtt/shared';
  import {
    getCustomBonusesValue,
    isMovementType,
    MOVEMENT_LABELS,
    MOVEMENT_PRIORITY,
    NEW_CUSTOM_BONUS,
    toStoredCustomBonus,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS, MOVEMENT_SETTINGS_LABELS } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  /** Свои бонусы по видам передвижения */
  type MovementBonuses = Partial<Record<MovementType, DnDCustomBonus[]>>;

  interface Props {
    open: boolean;
    movement: ActorMovement;
    /** Свои бонусы к видам передвижения */
    bonuses?: MovementBonuses;
    /** Числа листа, от которых считается вклад своих бонусов */
    context: DnDCustomBonusContext;
    /** Активные эффекты для вычисления бонусов к скоростям */
    activeEffects?: readonly ActiveEffect[];
  }

  const props = withDefaults(defineProps<Props>(), {
    bonuses: () => ({}),
    activeEffects: () => [],
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [payload: { movement: ActorMovement; bonuses: MovementBonuses }];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Виды передвижения в порядке показа — тот же список, что и в листе */
  const movementTypes: Array<{ key: MovementType; label: string }> =
    MOVEMENT_PRIORITY.map((key) => ({ key, label: MOVEMENT_LABELS[key] }));

  const editMovement = reactive<ActorMovement>({
    walk: 0,
    swim: 0,
    fly: 0,
    climb: 0,
    burrow: 0,
    hover: false,
    units: 'ft',
  });

  /** Свои бонусы черновика: правятся до «Применить», лист их пока не видит */
  const draftBonuses = ref<MovementBonuses>({});

  // При открытии — подставляем текущие значения
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      Object.assign(editMovement, props.movement);

      const copied: MovementBonuses = {};

      for (const movementType of movementTypes) {
        const bonuses = props.bonuses[movementType.key];

        if (bonuses && bonuses.length > 0) {
          copied[movementType.key] = bonuses.map((bonus) => ({ ...bonus }));
        }
      }

      draftBonuses.value = copied;
    },
  );

  /**
   * Строки своих бонусов вида передвижения. Пустой список у вида не хранится —
   * иначе запись листа копила бы пустоту по всем пяти видам.
   *
   * @param movementKey - вид передвижения
   * @returns свои бонусы вида
   */
  function getBonuses(movementKey: MovementType): DnDCustomBonus[] {
    return draftBonuses.value[movementKey] ?? [];
  }

  /**
   * Записывает правленый список бонусов вида в черновик.
   *
   * @param movementKey - вид передвижения
   * @param bonuses - строки бонусов вида
   */
  function setBonuses(
    movementKey: MovementType,
    bonuses: DnDCustomBonus[],
  ): void {
    draftBonuses.value = { ...draftBonuses.value, [movementKey]: bonuses };
  }

  /**
   * Заводит виду пустой бонус: заготовка «+1» правится тут же в строке.
   *
   * @param movementKey - вид передвижения
   */
  function addBonus(movementKey: MovementType): void {
    setBonuses(movementKey, [
      ...getBonuses(movementKey),
      { ...NEW_CUSTOM_BONUS, id: generateEntityId('bonus') },
    ]);
  }

  /**
   * Вклад своих бонусов вида — он показывается рядом с полем скорости.
   *
   * @param movementKey - вид передвижения
   * @returns суммарный вклад со знаком
   */
  function getBonusesLabel(movementKey: MovementType): string {
    return formatSignedNumber(
      getCustomBonusesValue(props.context, getBonuses(movementKey)),
    );
  }

  /** Источник бонуса к скорости */
  interface MovementBonusSource {
    /** Название эффекта-источника */
    name: string;
    /** Числовое значение бонуса */
    value: number;
  }

  /**
   * Собирает бонусы к скорости от Active Effects для каждого типа движения
   */
  const movementBonuses = computed<Record<MovementType, MovementBonusSource[]>>(
    () => {
      // Явный литерал, а не сборка по списку ключей: только он доказывает
      // типу, что запись заполнена по всем типам движения
      const result: Record<MovementType, MovementBonusSource[]> = {
        walk: [],
        swim: [],
        fly: [],
        climb: [],
        burrow: [],
      };

      const targetPrefix = 'movement.';

      for (const effect of props.activeEffects) {
        for (const change of effect.changes) {
          if (!change.key.startsWith(targetPrefix) || change.condition) {
            continue;
          }

          const movementKey = change.key.slice(targetPrefix.length);

          // Хвост ключа приходит из записи мира — тип подтверждает гвард
          if (!isMovementType(movementKey)) {
            continue;
          }

          const numericValue = Number(change.value);

          if (!Number.isNaN(numericValue) && numericValue !== 0) {
            result[movementKey].push({
              name: effect.name,
              value: numericValue,
            });
          }
        }
      }

      return result;
    },
  );

  /**
   * Суммарный бонус к скорости для указанного типа движения
   */
  function getMovementBonus(movementKey: MovementType): number {
    const sources = movementBonuses.value[movementKey];

    return sources.reduce((sum, source) => sum + source.value, 0);
  }

  /**
   * Текст тултипа бонусов к скорости
   */
  function getMovementBonusTooltip(movementKey: MovementType): string {
    return movementBonuses.value[movementKey]
      .filter((source) => source.value !== 0)
      .map((source) => {
        const prefix = source.value > 0 ? '+' : '';

        return `${source.name}: ${prefix}${source.value}`;
      })
      .join('\n');
  }

  /**
   * CSS-класс цвета бонуса: зелёный для положительных, красный для отрицательных
   */
  function bonusColorClass(value: number): string {
    return value > 0 ? 'text-success' : 'text-danger';
  }

  /**
   * Применяет изменения передвижения. Виды без бонусов из записи выпадают —
   * лист не копит пустые списки.
   */
  function applyMovement() {
    const bonuses: MovementBonuses = {};

    for (const movementType of movementTypes) {
      const rows = draftBonuses.value[movementType.key] ?? [];

      if (rows.length > 0) {
        bonuses[movementType.key] = rows.map(toStoredCustomBonus);
      }
    }

    emit('apply', { movement: { ...editMovement }, bonuses });
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="400"
    :min-height="300"
    :title="MOVEMENT_SETTINGS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Типы движения: у каждого своя скорость и свои бонусы -->
        <div class="space-y-3">
          <div
            v-for="movementType in movementTypes"
            :key="movementType.key"
            class="flex flex-col gap-2 rounded-lg border p-2 transition-colors"
            :class="
              getBonuses(movementType.key).length > 0
                ? 'border-primary/40'
                : 'border-default/50'
            "
          >
            <div class="flex items-center gap-3">
              <span class="w-24 text-sm text-toned">{{
                movementType.label
              }}</span>

              <UInput
                :model-value="editMovement[movementType.key]"
                type="number"
                :min="0"
                size="sm"
                class="flex-1"
                @update:model-value="
                  editMovement[movementType.key] = Number($event)
                "
              />

              <!-- Вклад своих бонусов вида -->
              <span
                v-if="getBonuses(movementType.key).length > 0"
                class="w-12 rounded-md border border-primary/40 px-2 py-1 text-center text-sm font-bold text-toned tabular-nums"
              >
                {{ getBonusesLabel(movementType.key) }}
              </span>

              <!-- Бонус от эффектов -->
              <UTooltip
                v-if="getMovementBonus(movementType.key) !== 0"
                :text="getMovementBonusTooltip(movementType.key)"
                :ui="{ content: 'whitespace-pre-line' }"
              >
                <span
                  class="w-12 rounded-md bg-elevated px-2 py-1.5 text-center text-sm font-bold tabular-nums"
                  :class="bonusColorClass(getMovementBonus(movementType.key))"
                  >{{
                    formatSignedNumber(getMovementBonus(movementType.key))
                  }}</span
                >
              </UTooltip>

              <UCheckbox
                v-if="movementType.key === 'fly'"
                v-model="editMovement.hover"
                :label="MOVEMENT_SETTINGS_LABELS.hover"
                class="shrink-0"
              />

              <UTooltip :text="MOVEMENT_SETTINGS_LABELS.addBonus">
                <UButton
                  icon="tabler:plus"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                  square
                  :aria-label="`${MOVEMENT_SETTINGS_LABELS.addBonus}: ${movementType.label}`"
                  @click.left.exact.prevent="addBonus(movementType.key)"
                />
              </UTooltip>
            </div>

            <!-- У вида без своих бонусов строк нет вовсе, а первый бонус
              заводит плюс в шапке строки -->
            <CustomBonusRows
              v-if="getBonuses(movementType.key).length > 0"
              :model-value="getBonuses(movementType.key)"
              :context="context"
              :with-add="false"
              class="border-l-2 border-primary/40 pl-2"
              @update:model-value="setBonuses(movementType.key, $event)"
            />
          </div>
        </div>

        <p class="text-xs leading-relaxed text-dimmed">
          {{ MOVEMENT_SETTINGS_LABELS.bonusesHint }}
        </p>

        <!-- Разделитель -->
        <div class="border-t border-muted" />

        <!-- Единицы -->
        <div class="flex items-center gap-3">
          <span class="w-24 text-sm text-toned">
            {{ MOVEMENT_SETTINGS_LABELS.units }}
          </span>

          <USelect
            v-model="editMovement.units"
            :items="DISTANCE_UNIT_OPTIONS"
            value-key="value"
            label-key="label"
            class="flex-1"
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
            @click.left.exact.prevent="applyMovement"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
