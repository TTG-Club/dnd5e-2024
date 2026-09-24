<!--
  Шаг «Что меняет»: состояние, модификаторы, особые правила и иммунитеты к
  состояниям.

  Шаблон состояния стоит первым в шаге, а его пункты повторены в меню
  «Готовые» у особых правил: «Отравленного» ищут среди правил, и из шапки окна
  шаблон никто не находил — просили добавить состояния в список правил.
-->
<script setup lang="ts">
  import type { WritableComputedRef } from 'vue';

  import type {
    ActiveEffect,
    ConditionRef,
    EffectChange,
    EffectFlagKey,
    EffectFormLayout,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    ADJACENT_ALLY_CONDITION_LABEL,
    ADJACENT_ALLY_CONDITION_OPTIONS,
    applyConditionPresetToEffect,
    buildConditionActiveEffect,
    describeConditionName,
    describeEffectChangeCondition,
    EFFECT_CONDITION_SUGGESTIONS,
    isAdjacentAllyCondition,
    TARGET_ALLY_ADJACENT_CONDITION,
  } from '@vtt/shared/system/dnd.js';

  import { SCROLLABLE_DROPDOWN_UI } from '../../actor/constants';
  import FieldHint from '../../actor/FieldHint.vue';
  import {
    CONDITION_PRESET_ICON,
    EFFECT_MODIFIERS_STEP_LABELS,
    EFFECT_ROLL_CONDITION_ALWAYS,
  } from '../constants';
  import {
    buildConditionItems,
    buildConditionPresetMenuItems,
  } from '../effectFormOptions';
  import EffectChangeRows from './EffectChangeRows.vue';
  import EffectFlagRows from './EffectFlagRows.vue';

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
    /** Показывать приоритет у всех модификаторов */
    showPriorityField: boolean;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  /**
   * Сохранённый бросок: пустая строка стирает поле, а не пишет пустоту —
   * иначе эффект уносил бы в мир настройку, которой автор не задавал
   */
  const savedRoll = computed({
    get: () => effect.value.savedRoll ?? '',
    set: (formula: string) => {
      const trimmed = formula.trim();

      effect.value = {
        ...effect.value,
        savedRoll: trimmed.length > 0 ? formula : undefined,
      };
    },
  });

  /** Название состояния, которым считается эффект */
  const conditionName = computed(() =>
    effect.value.conditionKey
      ? describeConditionName(effect.value.conditionKey)
      : '',
  );

  /** Условие броска о союзнике рядом с целью — какой союзник, выбирается ниже */
  const hasAdjacentAllyCondition = computed(
    () =>
      effect.value.rollCondition !== undefined
      && isAdjacentAllyCondition(effect.value.rollCondition),
  );

  // Условие из записи, которого нет в словаре подсказок (составное), тоже
  // видно в списке — иначе поле выглядело бы пустым. Условия о союзнике рядом
  // в списке одним пунктом: какой союзник, выбирается вторым полем
  const rollConditionOptions = computed(() => {
    const current = effect.value.rollCondition;

    const known =
      current === undefined
      || EFFECT_CONDITION_SUGGESTIONS.some(
        (suggestion) => suggestion.value === current,
      );

    return [
      {
        value: EFFECT_ROLL_CONDITION_ALWAYS,
        label: EFFECT_MODIFIERS_STEP_LABELS.rollConditionAlways,
      },
      ...(known
        ? []
        : [{ value: current, label: describeEffectChangeCondition(current) }]),
      ...EFFECT_CONDITION_SUGGESTIONS.flatMap((suggestion) => {
        if (suggestion.value === TARGET_ALLY_ADJACENT_CONDITION) {
          return [{ ...suggestion, label: ADJACENT_ALLY_CONDITION_LABEL }];
        }

        return isAdjacentAllyCondition(suggestion.value) ? [] : [suggestion];
      }),
    ];
  });

  /**
   * Записывает условие броска.
   *
   * @param value - условие; «Всегда» — без условия
   */
  function writeRollCondition(value: string): void {
    effect.value = {
      ...effect.value,
      rollCondition: value === EFFECT_ROLL_CONDITION_ALWAYS ? undefined : value,
    };
  }

  const rollCondition = computed({
    get: () =>
      hasAdjacentAllyCondition.value
        ? TARGET_ALLY_ADJACENT_CONDITION
        : (effect.value.rollCondition ?? EFFECT_ROLL_CONDITION_ALWAYS),
    set: (value: string) => {
      // Повторный выбор пункта о союзнике не сбрасывает выбранного союзника
      if (
        value === TARGET_ALLY_ADJACENT_CONDITION
        && hasAdjacentAllyCondition.value
      ) {
        return;
      }

      writeRollCondition(value);
    },
  });

  const adjacentAllyCondition = computed({
    get: () => effect.value.rollCondition ?? TARGET_ALLY_ADJACENT_CONDITION,
    set: writeRollCondition,
  });

  const changes = computed({
    get: () => effect.value.changes,
    set: (value: EffectChange[]) => {
      effect.value = { ...effect.value, changes: value };
    },
  });

  const flags = computed({
    get: () => effect.value.flags,
    set: (value: EffectFlagKey[]) => {
      effect.value = { ...effect.value, flags: value };
    },
  });

  // Список вычисляемый: кроме канона в него входят состояния, заведённые в
  // мире, — они появляются и исчезают, пока окно открыто
  const conditionOptions = computed(buildConditionItems);

  /**
   * Модель необязательного списка состояний эффекта: пустой список в данных
   * не пишется.
   *
   * @param field - поле эффекта со списком состояний
   * @returns модель для выбора
   */
  function conditionListModel(
    field: 'conditionImmunities' | 'suppressConditions',
  ): WritableComputedRef<ConditionRef[]> {
    return computed({
      get: () => effect.value[field] ?? [],
      set: (keys: ConditionRef[]) => {
        effect.value = {
          ...effect.value,
          [field]: keys.length > 0 ? keys : undefined,
        };
      },
    });
  }

  const conditionImmunities = conditionListModel('conditionImmunities');
  const suppressConditions = conditionListModel('suppressConditions');

  /**
   * Заполняет эффект тем, что делает состояние, не трогая срабатывание.
   *
   * @param conditionKey - ключ состояния
   */
  function applyConditionPreset(conditionKey: ConditionRef): void {
    const condition = buildConditionActiveEffect(conditionKey);

    if (!condition) {
      return;
    }

    effect.value = applyConditionPresetToEffect(effect.value, condition);
  }

  // Список вычисляемый: кроме канона в него входят состояния, заведённые в
  // мире, — они появляются и исчезают, пока окно открыто. В окне самого
  // состояния шаблона нет: там эффект и есть состояние
  const conditionPresetItems = computed(() =>
    props.layout.showConditionPreset
      ? buildConditionPresetMenuItems(applyConditionPreset)
      : [],
  );

  /**
   * Перестаёт считать эффект состоянием: модификаторы и правила остаются, но
   * иммунитет к состоянию на нём больше не сработает.
   */
  function removeCondition(): void {
    effect.value = {
      ...effect.value,
      conditionKey: undefined,
      exhaustionLevel: undefined,
    };
  }
</script>

<template>
  <div
    v-if="conditionName"
    class="flex flex-wrap items-center gap-2"
  >
    <UBadge
      color="primary"
      variant="subtle"
      size="lg"
      icon="tabler:heart-broken"
    >
      {{ EFFECT_MODIFIERS_STEP_LABELS.conditionPrefix }}{{ conditionName }}
    </UBadge>

    <UDropdownMenu
      v-if="conditionPresetItems.length > 0"
      :items="conditionPresetItems"
      :ui="SCROLLABLE_DROPDOWN_UI"
    >
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="CONDITION_PRESET_ICON"
        :label="EFFECT_MODIFIERS_STEP_LABELS.conditionPresetChange"
        :title="EFFECT_MODIFIERS_STEP_LABELS.conditionPresetChangeHint"
      />
    </UDropdownMenu>

    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      icon="tabler:x"
      :label="EFFECT_MODIFIERS_STEP_LABELS.conditionRemove"
      :title="EFFECT_MODIFIERS_STEP_LABELS.conditionRemoveHint"
      @click.left.exact.prevent="removeCondition"
    />
  </div>

  <div
    v-else-if="conditionPresetItems.length > 0"
    class="flex items-center justify-between gap-2"
  >
    <span class="flex items-center gap-1 text-xs font-medium text-default">
      {{ EFFECT_MODIFIERS_STEP_LABELS.conditionPresetTitle }}

      <FieldHint :text="EFFECT_MODIFIERS_STEP_LABELS.conditionPresetHint" />
    </span>

    <UDropdownMenu
      :items="conditionPresetItems"
      :content="{ align: 'end' }"
      :ui="SCROLLABLE_DROPDOWN_UI"
    >
      <UButton
        color="primary"
        variant="soft"
        size="xs"
        :icon="CONDITION_PRESET_ICON"
        :label="EFFECT_MODIFIERS_STEP_LABELS.conditionPresetPick"
      />
    </UDropdownMenu>
  </div>

  <!-- Поля в строку; окно сужают — переносятся друг под друга. Перенос по
       ширине окна, а не экрана: окно двигают и тянут отдельно от экрана -->
  <div class="flex flex-wrap gap-x-3 gap-y-1.5">
    <UFormField class="min-w-56 flex-1">
      <template #label>
        <span class="flex items-center gap-1">
          {{ EFFECT_MODIFIERS_STEP_LABELS.rollConditionTitle }}

          <FieldHint :text="EFFECT_MODIFIERS_STEP_LABELS.rollConditionHint" />
        </span>
      </template>

      <USelectMenu
        v-model="rollCondition"
        :items="rollConditionOptions"
        value-key="value"
        label-key="label"
        class="w-full"
        :portal="false"
      />
    </UFormField>

    <UFormField class="min-w-56 flex-1">
      <template #label>
        <span class="flex items-center gap-1">
          {{ EFFECT_MODIFIERS_STEP_LABELS.savedRollTitle }}

          <FieldHint :text="EFFECT_MODIFIERS_STEP_LABELS.savedRollHint" />
        </span>
      </template>

      <UInput
        v-model="savedRoll"
        :placeholder="EFFECT_MODIFIERS_STEP_LABELS.savedRollPlaceholder"
        class="w-full"
      />
    </UFormField>

    <UFormField
      v-if="hasAdjacentAllyCondition"
      class="min-w-56 flex-1"
    >
      <template #label>
        <span class="flex items-center gap-1">
          {{ EFFECT_MODIFIERS_STEP_LABELS.adjacentAllyTitle }}

          <FieldHint :text="EFFECT_MODIFIERS_STEP_LABELS.adjacentAllyHint" />
        </span>
      </template>

      <USelectMenu
        v-model="adjacentAllyCondition"
        :items="ADJACENT_ALLY_CONDITION_OPTIONS"
        value-key="value"
        label-key="label"
        class="w-full"
        :portal="false"
      />
    </UFormField>
  </div>

  <EffectChangeRows
    v-model:changes="changes"
    :show-priority-field="showPriorityField"
  />

  <EffectFlagRows
    v-model:flags="flags"
    :condition-preset-items="conditionPresetItems"
  />

  <div
    v-if="layout.showConditionImmunities"
    class="flex flex-wrap gap-x-3 gap-y-1.5"
  >
    <UFormField class="min-w-56 flex-1">
      <template #label>
        <span class="flex items-center gap-1">
          {{ EFFECT_MODIFIERS_STEP_LABELS.immunitiesTitle }}

          <FieldHint :text="EFFECT_MODIFIERS_STEP_LABELS.immunitiesHint" />
        </span>
      </template>

      <USelectMenu
        v-model="conditionImmunities"
        :items="conditionOptions"
        value-key="value"
        label-key="label"
        multiple
        class="w-full"
        :placeholder="EFFECT_MODIFIERS_STEP_LABELS.immunitiesPlaceholder"
        :portal="false"
      />
    </UFormField>

    <UFormField class="min-w-56 flex-1">
      <template #label>
        <span class="flex items-center gap-1">
          {{ EFFECT_MODIFIERS_STEP_LABELS.suppressTitle }}

          <FieldHint :text="EFFECT_MODIFIERS_STEP_LABELS.suppressHint" />
        </span>
      </template>

      <USelectMenu
        v-model="suppressConditions"
        :items="conditionOptions"
        value-key="value"
        label-key="label"
        multiple
        class="w-full"
        :placeholder="EFFECT_MODIFIERS_STEP_LABELS.suppressPlaceholder"
        :portal="false"
      />
    </UFormField>
  </div>
</template>
