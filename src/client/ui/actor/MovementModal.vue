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
    describeChangeValue,
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
    /**
     * Итоговые скорости листа — то, что видит плитка и чем ядро меряет ход
     * токена. Считает их движок; окно только сверяет их с записанными, чтобы
     * показать расхождение, а не пересчитывает правила заново.
     */
    resolvedMovement?: ActorMovement;
  }

  const props = withDefaults(defineProps<Props>(), {
    bonuses: () => ({}),
    activeEffects: () => [],
    // Итогов может не быть вовсе: лист существа считает их не всегда, и тогда
    // окно просто не показывает разбор
    resolvedMovement: undefined,
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

  /** Что делает с видом передвижения один эффект */
  interface MovementEffectSource {
    /** Название эффекта-источника */
    name: string;
    /** Подпись изменения в его собственном режиме: «+10 фт», «заменить 0 фт» */
    text: string;
  }

  /**
   * Изменения видов передвижения от активных эффектов.
   *
   * Копятся любые, а не только ненулевые прибавки: замена скорости нулём и
   * нечитаемое значение — ровно те случаи, когда лист замирает, и прятать их
   * тут нельзя. Режим тоже не выдаётся за прибавку — «заменить 60» и «+60»
   * дают разный итог, и подпись берётся общая с описанием эффекта.
   *
   * Условные строки попадают в список с пометкой, а не отбрасываются: часть из
   * них (условие по носителю — доспех, тип существа) лист считает, часть
   * откладывает до броска, и решает это движок. Повторять его разбор здесь
   * значило бы завести вторую реализацию правила; список честнее показать
   * целиком, а точное число всё равно приходит итогом.
   */
  const movementEffects = computed<
    Record<MovementType, MovementEffectSource[]>
  >(() => {
    // Явный литерал, а не сборка по списку ключей: только он доказывает
    // типу, что запись заполнена по всем типам движения
    const result: Record<MovementType, MovementEffectSource[]> = {
      walk: [],
      swim: [],
      fly: [],
      climb: [],
      burrow: [],
    };

    const targetPrefix = 'movement.';

    for (const effect of props.activeEffects) {
      for (const change of effect.changes) {
        if (!change.key.startsWith(targetPrefix)) {
          continue;
        }

        const movementKey = change.key.slice(targetPrefix.length);

        // Хвост ключа приходит из записи мира — тип подтверждает гвард
        if (!isMovementType(movementKey)) {
          continue;
        }

        const value = describeChangeValue(change);

        result[movementKey].push({
          name: effect.name,
          text: change.condition
            ? `${value} (${MOVEMENT_SETTINGS_LABELS.conditionalMark})`
            : value,
        });
      }
    }

    return result;
  });

  /**
   * Эффекты, гасящие передвижение целиком флагом `speed.zero` — Схвачен,
   * Опутан, Парализован, Окаменевший, Без сознания. Числами в скоростях они не
   * видны никак, поэтому окно называет их отдельной строкой.
   */
  const zeroSpeedEffects = computed<string[]>(() =>
    props.activeEffects
      .filter((effect) => effect.flags.includes('speed.zero'))
      .map((effect) => effect.name),
  );

  /**
   * Трогают ли вид передвижения эффекты — только тогда рядом с полем встаёт
   * итоговое число. Без итогов от листа показывать нечего: пересчитывать
   * правила второй раз окно не станет.
   *
   * @param movementKey - вид передвижения
   * @returns `true`, если у вида есть что объяснять
   */
  function hasEffectImpact(movementKey: MovementType): boolean {
    if (!props.resolvedMovement) {
      return false;
    }

    if (movementEffects.value[movementKey].length > 0) {
      return true;
    }

    // Погашение скорости отмечается только там, где было что гасить: у вида с
    // нулём и без того ничего не менялось
    return zeroSpeedEffects.value.length > 0 && props.movement[movementKey] > 0;
  }

  /**
   * Итоговая скорость вида — её же видит плитка листа и ядро при ходе токена.
   *
   * @param movementKey - вид передвижения
   * @returns число из итогов листа
   */
  function getEffectTotal(movementKey: MovementType): number {
    return props.resolvedMovement?.[movementKey] ?? 0;
  }

  /**
   * Разбор итога вида: перечень эффектов и, если скорость погашена целиком, —
   * чем именно.
   *
   * @param movementKey - вид передвижения
   * @returns текст подсказки построчно
   */
  function getEffectTooltip(movementKey: MovementType): string {
    const lines: string[] = [MOVEMENT_SETTINGS_LABELS.sheetTotalHint];

    for (const source of movementEffects.value[movementKey]) {
      lines.push(`${source.name}: ${source.text}`);
    }

    for (const name of zeroSpeedEffects.value) {
      lines.push(`${name}: ${MOVEMENT_SETTINGS_LABELS.zeroBySource}`);
    }

    return lines.join('\n');
  }

  /**
   * Цвет итога: красный, когда эффекты скорость срезали, зелёный — когда
   * подняли.
   *
   * @param movementKey - вид передвижения
   * @returns CSS-класс цвета
   */
  function effectTotalColorClass(movementKey: MovementType): string {
    const total = getEffectTotal(movementKey);
    const stored = props.movement[movementKey];

    if (total < stored) {
      return 'text-danger';
    }

    return total > stored ? 'text-success' : 'text-toned';
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
    :min-width="440"
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

              <!-- Итог с учётом эффектов: с ним видно, почему лист не идёт -->
              <UTooltip
                v-if="hasEffectImpact(movementType.key)"
                :text="getEffectTooltip(movementType.key)"
                :ui="{ content: 'whitespace-pre-line' }"
              >
                <span
                  class="w-12 rounded-md bg-elevated px-2 py-1.5 text-center text-sm font-bold tabular-nums"
                  :class="effectTotalColorClass(movementType.key)"
                  >{{ getEffectTotal(movementType.key) }}</span
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
