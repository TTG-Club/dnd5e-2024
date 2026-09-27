<!--
  Урон «или» в окне действия существа: варианты, каждый со своим набором
  частей урона. Вариант целиком заменяет основной урон — поэтому новый вариант
  начинается с копии основного: автору остаётся поправить кости. Условие
  варианта — состояние в его формуле (вкладки «Статусы цели» и «Статусы
  атакующего»): такой вариант берётся сам. Без состояний — способ выбора: при
  броске или случайно. Способ «по формуле» стоит у нового варианта: как только
  в формуле появляется состояние, список способов сменяется надписью.
-->
<script setup lang="ts">
  import type { DamagePart } from '@vtt/shared';
  import type { CreatureDamageAlternative } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    CREATURE_DAMAGE_CONDITION_LABELS,
    CREATURE_DAMAGE_CONDITIONS,
    DEFAULT_CREATURE_DAMAGE_CONDITION,
    describeCreatureDamageCondition,
    FORMULA_CREATURE_DAMAGE_CONDITION,
    listAlternativeStatuses,
    MAX_CREATURE_DAMAGE_ALTERNATIVES,
  } from '@vtt/shared/system/dnd.js';

  import DamagePartsEditor from '../actor/DamagePartsEditor.vue';
  import { CREATURE_DAMAGE_ALTERNATIVE_LABELS } from './constants';

  const props = defineProps<{
    /** Варианты урона (v-model) */
    modelValue: CreatureDamageAlternative[];
    /** Основной урон действия: с его копии начинается новый вариант */
    baseParts: DamagePart[];
    /** Опции типов урона */
    damageTypeOptions: Array<{ label: string; value: string }>;
    /** У действия область: одной цели у атаки нет */
    hasArea: boolean;
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: CreatureDamageAlternative[]];
  }>();

  /** Способы выбора: подпись и ключ */
  const conditionItems = CREATURE_DAMAGE_CONDITIONS.map((condition) => ({
    label: CREATURE_DAMAGE_CONDITION_LABELS[condition],
    value: condition,
  }));

  /**
   * Строки вариантов для показа: берётся ли вариант сам (есть состояния в
   * формуле), чем он выбирается и дописан ли «по формуле».
   */
  const rows = computed(() =>
    props.modelValue.map((alternative) => {
      const statuses = listAlternativeStatuses(alternative);

      return {
        alternative,
        isAutomatic: statuses.length > 0,
        lacksStatus:
          statuses.length === 0
          && alternative.condition === FORMULA_CREATURE_DAMAGE_CONDITION,
        autoCaption: `${CREATURE_DAMAGE_ALTERNATIVE_LABELS.autoPrefix}${describeCreatureDamageCondition(alternative)}`,
        // Состояние цели у действия с областью не проверить: цель там не одна
        warnsArea:
          props.hasArea && statuses.some((token) => token.side === 'target'),
      };
    }),
  );

  /** Можно ли добавить ещё вариант */
  const canAdd = computed(
    () => props.modelValue.length < MAX_CREATURE_DAMAGE_ALTERNATIVES,
  );

  /**
   * Заменяет вариант по месту.
   *
   * @param index - место варианта
   * @param alternative - новый вид варианта
   */
  function replaceAlternative(
    index: number,
    alternative: CreatureDamageAlternative,
  ): void {
    emit(
      'update:modelValue',
      props.modelValue.map((entry, entryIndex) =>
        entryIndex === index ? alternative : entry,
      ),
    );
  }

  /** Добавляет вариант с копией основного урона */
  function addAlternative(): void {
    const copiedParts = props.baseParts
      .filter((part) => part.formula.trim().length > 0)
      .map((part) => ({ ...part }));

    emit('update:modelValue', [
      ...props.modelValue,
      {
        condition: DEFAULT_CREATURE_DAMAGE_CONDITION,
        damageParts:
          copiedParts.length > 0
            ? copiedParts
            : [{ formula: '', target: 'selected' }],
      },
    ]);
  }

  /**
   * Убирает вариант.
   *
   * @param index - место варианта
   */
  function removeAlternative(index: number): void {
    emit(
      'update:modelValue',
      props.modelValue.filter((_, entryIndex) => entryIndex !== index),
    );
  }

  /**
   * Меняет способ выбора варианта. Значение сверяется со списком: выпадающий
   * список отдаёт его без типа.
   *
   * @param index - место варианта
   * @param value - выбранное значение
   */
  function updateCondition(index: number, value: unknown): void {
    const condition = CREATURE_DAMAGE_CONDITIONS.find(
      (entry) => entry === value,
    );

    const alternative = props.modelValue[index];

    if (condition && alternative) {
      replaceAlternative(index, { ...alternative, condition });
    }
  }

  /**
   * Меняет подпись варианта. Пустая подпись не хранится: вариант тогда
   * называется своей формулой.
   *
   * @param index - место варианта
   * @param value - введённый текст
   */
  function updateLabel(index: number, value: unknown): void {
    const alternative = props.modelValue[index];

    if (!alternative) {
      return;
    }

    const { label: _previous, ...rest } = alternative;
    const text = String(value ?? '');

    replaceAlternative(index, text ? { ...rest, label: text } : rest);
  }

  /**
   * Меняет части урона варианта. Появилось состояние в формуле — способ сам
   * становится «по формуле»: вариант теперь решает состояние, и прежний способ
   * лишь путал бы, всплыв после того, как состояние уберут.
   *
   * @param index - место варианта
   * @param damageParts - новые части
   */
  function updateParts(index: number, damageParts: DamagePart[]): void {
    const alternative = props.modelValue[index];

    if (!alternative) {
      return;
    }

    const condition =
      listAlternativeStatuses({ damageParts }).length > 0
        ? FORMULA_CREATURE_DAMAGE_CONDITION
        : alternative.condition;

    replaceAlternative(index, { ...alternative, condition, damageParts });
  }
</script>

<template>
  <div class="space-y-2">
    <span class="text-xs font-semibold tracking-wide text-warning">
      {{ CREATURE_DAMAGE_ALTERNATIVE_LABELS.title }}
    </span>

    <p class="text-xs text-muted">
      {{ CREATURE_DAMAGE_ALTERNATIVE_LABELS.hint }}
    </p>

    <div
      v-for="(row, alternativeIndex) in rows"
      :key="alternativeIndex"
      class="space-y-2 rounded-lg border border-muted/60 bg-elevated/20 p-3"
    >
      <div class="flex items-center gap-2">
        <span
          class="shrink-0 text-xs font-semibold tracking-wide text-warning uppercase"
        >
          {{ CREATURE_DAMAGE_ALTERNATIVE_LABELS.or }}
        </span>

        <!-- Вариант с состоянием в формуле берётся сам — способ ему не нужен -->
        <span
          v-if="row.isAutomatic"
          class="min-w-0 flex-1 text-sm text-toned"
        >
          {{ row.autoCaption }}
        </span>

        <USelect
          v-else
          :model-value="row.alternative.condition"
          :items="conditionItems"
          value-key="value"
          size="sm"
          class="min-w-0 flex-1"
          :portal="false"
          :aria-label="CREATURE_DAMAGE_ALTERNATIVE_LABELS.condition"
          @update:model-value="updateCondition(alternativeIndex, $event)"
        />

        <UButton
          color="error"
          variant="ghost"
          icon="tabler:trash"
          size="xs"
          :title="CREATURE_DAMAGE_ALTERNATIVE_LABELS.remove"
          @click.left.exact.prevent="removeAlternative(alternativeIndex)"
        />
      </div>

      <p
        v-if="row.warnsArea"
        class="text-xs text-warning"
      >
        {{ CREATURE_DAMAGE_ALTERNATIVE_LABELS.areaTargetWarning }}
      </p>

      <p
        v-if="row.lacksStatus"
        class="text-xs text-warning"
      >
        {{ CREATURE_DAMAGE_ALTERNATIVE_LABELS.formulaWithoutStatus }}
      </p>

      <!-- Подпись называет вариант в вопросе и в чате -->
      <UFormField
        :label="CREATURE_DAMAGE_ALTERNATIVE_LABELS.label"
        size="sm"
      >
        <UInput
          :model-value="row.alternative.label ?? ''"
          :placeholder="CREATURE_DAMAGE_ALTERNATIVE_LABELS.labelPlaceholder"
          size="sm"
          class="w-full"
          @update:model-value="updateLabel(alternativeIndex, $event)"
        />
      </UFormField>

      <DamagePartsEditor
        :model-value="row.alternative.damageParts"
        :damage-type-options="damageTypeOptions"
        :include-spell-modifier="false"
        :hide-modifiers="true"
        :assume-statuses="row.isAutomatic"
        @update:model-value="updateParts(alternativeIndex, $event)"
      />
    </div>

    <UButton
      v-if="canAdd"
      color="primary"
      variant="ghost"
      size="xs"
      icon="tabler:plus"
      @click.left.exact.prevent="addAlternative"
    >
      {{ CREATURE_DAMAGE_ALTERNATIVE_LABELS.add }}
    </UButton>
  </div>
</template>
