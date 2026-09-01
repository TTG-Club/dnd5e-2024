<script setup lang="ts">
  import type { EditableChoiceScaling } from './feat/featEditorTypes';

  import { generateId } from '@vtt/shared';

  import {
    CHOICE_COUNT_MAX,
    CHOICE_COUNT_MIN,
    CHOICE_SCALING_LABELS,
    CLASS_LEVEL_MAX,
  } from './constants';
  import FieldHint from './FieldHint.vue';

  /**
   * Ступени роста количества выбора: с какого уровня сколько вариантов выбрано
   * ВСЕГО, а не сколько добавилось.
   *
   * Один блок на два места, где такой ряд задают: выбор в дарах черты или
   * класса и выбор из вариантов умения. Считают они одно и то же — оружейные
   * приёмы воина и воззвания колдуна набираются одинаково.
   */
  const props = defineProps<{
    /**
     * Количество на уровне самой записи: от него отсчитывается первая ступень,
     * дальше каждая следующая идёт от предыдущей.
     */
    baseCount: number;
    /** Что показать, когда ступеней нет: у каждого места свой запасной ряд. */
    emptyText: string;
    /** Пояснение к блоку по наведению на ⓘ; пусто — значка нет. */
    hint?: string;
  }>();

  const scaling = defineModel<EditableChoiceScaling[]>({ required: true });

  /**
   * Заводит ступень роста: следующая начинается уровнем позже последней и даёт
   * на один вариант больше.
   */
  function addStep(): void {
    const last = scaling.value.at(-1);

    const step: EditableChoiceScaling = {
      uid: generateId('choice-step'),
      level: Math.min(CLASS_LEVEL_MAX, (last?.level ?? 0) + 1),
      count: Math.min(CHOICE_COUNT_MAX, (last?.count ?? props.baseCount) + 1),
    };

    scaling.value = [...scaling.value, step];
  }

  /**
   * Убирает ступень роста.
   *
   * @param index - позиция ступени в списке
   */
  function removeStep(index: number): void {
    scaling.value = scaling.value.filter(
      (_unused, stepIndex) => stepIndex !== index,
    );
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-1">
      <span class="text-xs font-medium text-muted">
        {{ CHOICE_SCALING_LABELS.title }}
      </span>

      <FieldHint
        v-if="props.hint"
        :text="props.hint"
      />
    </div>

    <p
      v-if="scaling.length === 0"
      class="text-xs text-dimmed italic"
    >
      {{ props.emptyText }}
    </p>

    <div
      v-for="(step, stepIndex) in scaling"
      :key="step.uid"
      class="flex items-end gap-2"
    >
      <UFormField
        :label="CHOICE_SCALING_LABELS.level"
        class="w-27.5"
      >
        <UInputNumber
          v-model="step.level"
          :min="1"
          :max="CLASS_LEVEL_MAX"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="CHOICE_SCALING_LABELS.count"
        class="w-27.5"
      >
        <UInputNumber
          v-model="step.count"
          :min="CHOICE_COUNT_MIN"
          :max="CHOICE_COUNT_MAX"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UButton
        icon="tabler:trash"
        color="error"
        variant="ghost"
        size="xs"
        class="mb-1"
        :aria-label="CHOICE_SCALING_LABELS.remove"
        @click.left.exact.prevent="removeStep(stepIndex)"
      />
    </div>

    <UButton
      icon="tabler:plus"
      :label="CHOICE_SCALING_LABELS.add"
      color="neutral"
      variant="soft"
      size="xs"
      class="self-start"
      @click.left.exact.prevent="addStep"
    />
  </div>
</template>
