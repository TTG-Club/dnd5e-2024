<!--
  Блок Истощения листа (PHB 2024).

  Шкала из шести делений: нажатие ставит степень, повторное нажатие по текущей —
  снимает её (степень уходит на единицу ниже). Подсказка деления рассказывает,
  что даёт эта степень, ещё до нажатия; шестое деление красное — на нём
  персонаж умирает.
-->
<script setup lang="ts">
  import { computed } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';
  import {
    EXHAUSTION_LEVEL_MAX,
    EXHAUSTION_LEVEL_MIN,
    EXHAUSTION_LEVELS,
    getExhaustionEffects,
  } from '@vtt/shared/system/dnd.js';

  import {
    EXHAUSTION_BLOCK_LABELS,
    EXHAUSTION_RULES,
    FEET_UNIT_LABEL,
  } from './constants';
  import { getSheetBlockClass } from './utils/sheetBlockClass';

  interface Props {
    /** Текущая степень истощения (0 — состояния нет) */
    level: number;
    /** Лист в режиме правки: рамка блока горит цветом настройки */
    isEditMode: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    /** Выбрана новая степень истощения */
    select: [level: number];
  }>();

  /**
   * Описание степени: нулевая — истощения нет, смертельная — смерть, остальные
   * — штраф к тестам к20 и снижение скорости.
   *
   * @param level - степень истощения
   * @returns строка описания
   */
  function describeLevel(level: number): string {
    const effects = getExhaustionEffects(level);

    if (effects.level === EXHAUSTION_LEVEL_MIN) {
      return EXHAUSTION_BLOCK_LABELS.none;
    }

    if (effects.isLethal) {
      return EXHAUSTION_BLOCK_LABELS.death;
    }

    return [
      `−${effects.d20Penalty} ${EXHAUSTION_BLOCK_LABELS.d20Effect}`,
      `${EXHAUSTION_BLOCK_LABELS.speedEffect} −${effects.speedPenalty} ${FEET_UNIT_LABEL}`,
    ].join(', ');
  }

  const currentLevel = computed(() => getExhaustionEffects(props.level).level);

  /**
   * Оформление деления: набранные закрашены, смертельное — красным, остальные
   * ждут нажатия.
   *
   * @param stepLevel - степень деления
   * @returns классы деления
   */
  function getStepClass(stepLevel: number): string {
    if (stepLevel > currentLevel.value) {
      return 'border-default text-muted hover:border-primary hover:text-primary';
    }

    return stepLevel === EXHAUSTION_LEVEL_MAX
      ? 'border-error bg-error/15 text-error'
      : 'border-primary bg-primary/15 text-primary';
  }

  /** Оформление блока: шкала нажимается сама, весь блок кликабельным не делаем */
  const blockClass = computed(() =>
    getSheetBlockClass({ isEditMode: props.isEditMode }),
  );

  const steps = computed(() =>
    EXHAUSTION_LEVELS.map((stepLevel) => ({
      level: stepLevel,
      isFilled: stepLevel <= currentLevel.value,
      hint: describeLevel(stepLevel),
      label: `${EXHAUSTION_BLOCK_LABELS.level} ${stepLevel}`,
      stepClass: getStepClass(stepLevel),
    })),
  );

  const summary = computed(() => describeLevel(currentLevel.value));

  const summaryClass = computed(() => {
    if (currentLevel.value === EXHAUSTION_LEVEL_MAX) {
      return 'text-error';
    }

    return currentLevel.value === EXHAUSTION_LEVEL_MIN
      ? 'text-dimmed'
      : 'text-warning';
  });

  /**
   * Нажатие на деление: чужое ставит свою степень, текущее — снимает её
   * (степень уходит на единицу ниже).
   *
   * @param stepLevel - степень нажатого деления
   */
  function handleSelect(stepLevel: number): void {
    emit(
      'select',
      stepLevel === currentLevel.value ? stepLevel - 1 : stepLevel,
    );
  }
</script>

<template>
  <FieldsetLabel
    :label="EXHAUSTION_BLOCK_LABELS.title"
    class="w-full max-w-full bg-default/20 transition-colors"
    :class="blockClass"
  >
    <template #actions>
      <UPopover :ui="{ content: 'max-w-80 p-3' }">
        <!-- Справка видна всегда, а не только в правке: искать правила
          наведением незачем. Клик обрабатывает сам поповер -->
        <button
          type="button"
          class="flex cursor-pointer items-center text-dimmed transition-colors hover:text-primary"
          :aria-label="EXHAUSTION_BLOCK_LABELS.rulesTitle"
        >
          <UIcon
            name="tabler:info-circle-filled"
            class="size-3.5"
          />
        </button>

        <template #content>
          <div class="flex flex-col gap-2">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ EXHAUSTION_BLOCK_LABELS.rulesTitle }}
            </span>

            <ul class="flex flex-col gap-1.5">
              <li
                v-for="rule in EXHAUSTION_RULES"
                :key="rule"
                class="flex gap-1.5 text-xs leading-relaxed text-toned"
              >
                <UIcon
                  name="tabler:point-filled"
                  class="mt-1 size-3 shrink-0 text-primary"
                />

                <span>{{ rule }}</span>
              </li>
            </ul>
          </div>
        </template>
      </UPopover>
    </template>

    <div class="flex flex-col gap-2 px-2 pb-2">
      <div class="grid grid-cols-6 gap-1">
        <UTooltip
          v-for="step in steps"
          :key="step.level"
          :delay-duration="300"
          :text="step.hint"
        >
          <button
            type="button"
            class="flex h-7 w-full cursor-pointer items-center justify-center rounded-md border text-xs font-bold transition-colors"
            :class="step.stepClass"
            :aria-label="step.label"
            :aria-pressed="step.isFilled"
            @click.left.exact.prevent="handleSelect(step.level)"
          >
            {{ step.level }}
          </button>
        </UTooltip>
      </div>

      <p
        class="border-t border-default/50 pt-2 text-xs"
        :class="summaryClass"
      >
        {{ summary }}
      </p>
    </div>
  </FieldsetLabel>
</template>
