<script setup lang="ts">
  /**
   * Шаг мастера: Очки здоровья.
   *
   * На 1-м уровне первого класса — автоматически максимум кости (read-only).
   * На последующих уровнях — среднее / максимум / бросок / ручной ввод.
   */
  import type {
    ClassDefinition,
    HitPointMethod,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { useChatStore } from '@/stores/chatStore';
  import { useDiceRollerStore } from '@/stores/diceRollerStore';

  import {
    CLASS_WIZARD_LABELS,
    DICE_ROLL_DEFAULT_BUTTON,
    HIT_DIE_LETTER,
    LEVEL_BADGE_SUFFIX,
  } from '../../constants';

  const props = defineProps<{
    classDefinition: ClassDefinition;
    nextLevel: number;
    isMaxHitDieLevel: boolean;
    hitPointValue: number;
    hitPointMethod: HitPointMethod;
    averageHitPoints: number;
  }>();

  const emit = defineEmits<{
    'update:hitPoints': [payload: { value: number; method: HitPointMethod }];
  }>();

  const chatStore = useChatStore();
  const diceRollerStore = useDiceRollerStore();

  /** Запись кости хитов класса: «к8» */
  const hitDieLabel = computed(
    () => `${HIT_DIE_LETTER}${props.classDefinition.hitDie}`,
  );

  /** Заголовок шага — кость хитов идёт в скобках */
  const stepTitle = computed(
    () =>
      CLASS_WIZARD_LABELS.hitPointsTitlePrefix
      + hitDieLabel.value
      + CLASS_WIZARD_LABELS.parenSuffix,
  );

  /** Кнопка среднего значения — в скобках само число */
  const averageButtonLabel = computed(
    () =>
      CLASS_WIZARD_LABELS.hitPointsAveragePrefix
      + props.averageHitPoints
      + CLASS_WIZARD_LABELS.parenSuffix,
  );

  /** Кнопка максимума — в скобках размер кости */
  const maxButtonLabel = computed(
    () =>
      CLASS_WIZARD_LABELS.hitPointsMaxPrefix
      + props.classDefinition.hitDie
      + CLASS_WIZARD_LABELS.parenSuffix,
  );

  /** Кнопка броска — дальше идёт кость хитов */
  const rollButtonLabel = computed(
    () => `${DICE_ROLL_DEFAULT_BUTTON} ${hitDieLabel.value}`,
  );

  /** Устанавливает среднее значение ХП */
  function setAverageHp() {
    emit('update:hitPoints', {
      value: props.averageHitPoints,
      method: 'average',
    });
  }

  /** Устанавливает максимальное значение ХП (максимум кости) */
  function setMaxHp() {
    emit('update:hitPoints', {
      value: props.classDefinition.hitDie,
      method: 'max',
    });
  }

  /** Бросает кость хитов, показывает результат в чате и подставляет в поле */
  function rollHitDie() {
    const formula = `1d${props.classDefinition.hitDie}`;
    const rollData = diceRollerStore.parseAndRoll(formula);

    const rollTitle = `${
      CLASS_WIZARD_LABELS.hitPointsRollPrefix
    }${props.classDefinition.name}, ${props.nextLevel}${LEVEL_BADGE_SUFFIX}${
      CLASS_WIZARD_LABELS.parenSuffix
    }`;

    chatStore.sendMessage(
      `${rollTitle}: ${formula} = ${rollData.total}`,
      'roll',
      rollData,
    );

    emit('update:hitPoints', {
      value: rollData.total,
      method: 'roll',
    });
  }

  /** Обработка ручного ввода значения ХП */
  function handleHitPointInput(inputValue: string | number) {
    const parsed = Number(inputValue);

    if (!Number.isNaN(parsed) && parsed >= 1) {
      emit('update:hitPoints', {
        value: parsed,
        method: 'custom',
      });
    }
  }
</script>

<template>
  <div class="space-y-3">
    <span class="mb-2 block text-sm font-medium text-toned">
      {{ stepTitle }}
    </span>

    <!-- Первый уровень первого класса — всегда максимум -->
    <div
      v-if="isMaxHitDieLevel"
      class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5"
    >
      <span class="text-sm text-muted">
        {{ CLASS_WIZARD_LABELS.hitPointsMaxAtFirstLevel }}
        <span class="font-bold text-warning">{{ classDefinition.hitDie }}</span>
      </span>
    </div>

    <!-- Последующие уровни — среднее / макс / бросок / ручной ввод -->
    <div
      v-else
      class="flex items-center gap-2"
    >
      <UButton
        size="md"
        :color="hitPointMethod === 'average' ? 'primary' : 'neutral'"
        :variant="hitPointMethod === 'average' ? 'solid' : 'outline'"
        @click.left.exact.prevent="setAverageHp"
      >
        {{ averageButtonLabel }}
      </UButton>

      <UButton
        size="md"
        :color="hitPointMethod === 'max' ? 'primary' : 'neutral'"
        :variant="hitPointMethod === 'max' ? 'solid' : 'outline'"
        @click.left.exact.prevent="setMaxHp"
      >
        {{ maxButtonLabel }}
      </UButton>

      <UInput
        :model-value="String(hitPointValue)"
        size="md"
        class="w-16 text-center"
        @update:model-value="handleHitPointInput"
      />

      <UButton
        size="md"
        color="neutral"
        variant="outline"
        icon="tabler:dice"
        @click.left.exact.prevent="rollHitDie"
      >
        {{ rollButtonLabel }}
      </UButton>
    </div>
  </div>
</template>
