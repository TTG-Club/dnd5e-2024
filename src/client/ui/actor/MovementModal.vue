<script setup lang="ts">
  import type { ActorMovement, MovementType } from '@vtt/shared';
  import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { DISTANCE_UNIT_OPTIONS } from '@vtt/shared';
  import { isMovementType } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS } from './constants';

  interface Props {
    open: boolean;
    movement: ActorMovement;
    /** Активные эффекты для вычисления бонусов к скоростям */
    activeEffects?: readonly ActiveEffect[];
  }

  const props = withDefaults(defineProps<Props>(), {
    activeEffects: () => [],
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [movement: ActorMovement];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Порядок типов движения = приоритет отображения */
  const movementTypes: Array<{ key: MovementType; label: string }> = [
    { key: 'burrow', label: 'Копание' },
    { key: 'climb', label: 'Лазание' },
    { key: 'fly', label: 'Полёт' },
    { key: 'swim', label: 'Плавание' },
    { key: 'walk', label: 'Ходьба' },
  ];

  const editMovement = reactive<ActorMovement>({
    walk: 0,
    swim: 0,
    fly: 0,
    climb: 0,
    burrow: 0,
    hover: false,
    units: 'ft',
  });

  // При открытии — подставляем текущие значения
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        Object.assign(editMovement, props.movement);
      }
    },
  );

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
   * Форматированный бонус: +10, -5
   */
  function formatBonus(value: number): string {
    return value > 0 ? `+${value}` : `${value}`;
  }

  /**
   * CSS-класс цвета бонуса: зелёный для положительных, красный для отрицательных
   */
  function bonusColorClass(value: number): string {
    return value > 0 ? 'text-success' : 'text-danger';
  }

  /**
   * Применяет изменения передвижения
   */
  function applyMovement() {
    emit('apply', { ...editMovement });
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
    title="Передвижение"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Типы движения -->
        <div class="space-y-3">
          <div
            v-for="movementType in movementTypes"
            :key="movementType.key"
            class="flex items-center gap-3"
          >
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

            <!-- Бонус от эффектов -->
            <UTooltip
              v-if="getMovementBonus(movementType.key) !== 0"
              :text="getMovementBonusTooltip(movementType.key)"
              :ui="{ content: 'whitespace-pre-line' }"
            >
              <span
                class="w-12 rounded-md bg-elevated px-2 py-1.5 text-center text-sm font-bold tabular-nums"
                :class="bonusColorClass(getMovementBonus(movementType.key))"
                >{{ formatBonus(getMovementBonus(movementType.key)) }}</span
              >
            </UTooltip>

            <template v-if="movementType.key === 'fly'">
              <label
                class="flex cursor-pointer items-center gap-1.5 text-sm text-muted"
              >
                <input
                  v-model="editMovement.hover"
                  type="checkbox"
                  class="rounded border-accented bg-elevated text-primary focus:ring-primary/30"
                />
                Парение
              </label>
            </template>
          </div>
        </div>

        <!-- Разделитель -->
        <div class="border-t border-muted" />

        <!-- Единицы -->
        <div class="flex items-center gap-3">
          <span class="w-24 text-sm text-toned">Единицы</span>

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
