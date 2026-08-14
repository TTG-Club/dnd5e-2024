<script setup lang="ts">
  /**
   * Строки своих бонусов: пометка, источник и вклад.
   *
   * Источник один селектор на всё: своё число и шесть характеристик стоят
   * общим списком — парой полей строка занимала бы вдвое больше места. У вида
   * «характеристика» вклад считается сам, поэтому вместо поля ввода там стоит
   * коробка того же размера: колонка значений не едет.
   */
  import type {
    DnDCustomBonus,
    DnDCustomBonusContext,
    DnDCustomBonusSource,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { generateEntityId } from '@/core/entityUtils';
  import {
    ABILITY_OPTIONS,
    CUSTOM_BONUS_FLAT_SOURCE,
    CUSTOM_BONUS_LABEL_MAX_LENGTH,
    CUSTOM_BONUS_MAX,
    CUSTOM_BONUS_MIN,
    CUSTOM_BONUS_PROFICIENCY_SOURCE,
    getCustomBonusSource,
    getCustomBonusValue,
    NEW_CUSTOM_BONUS,
    withCustomBonusSource,
  } from '@vtt/shared/system/dnd.js';

  import { BONUS_INPUT_FORMAT_OPTIONS, CUSTOM_BONUS_LABELS } from './constants';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  const props = withDefaults(
    defineProps<{
      /** Числа листа, от которых считается вклад бонусов */
      context: DnDCustomBonusContext;

      /**
       * Показывать кнопку «Добавить бонус». У спасброска бонус заводит плюс в
       * шапке строки, и своя кнопка там только дублировала бы его.
       */
      withAdd?: boolean;

      /**
       * Предлагать источником бонус мастерства. Само окно мастерства его не
       * предлагает: бонус к мастерству от мастерства ссылался бы сам на себя.
       */
      withProficiency?: boolean;
    }>(),
    { withAdd: true, withProficiency: true },
  );

  const rows = defineModel<DnDCustomBonus[]>({ required: true });

  /** Источники бонуса: своё число, мастерство и характеристики одним списком */
  const sourceOptions = computed(() => [
    { value: CUSTOM_BONUS_FLAT_SOURCE, label: CUSTOM_BONUS_LABELS.flatSource },
    ...(props.withProficiency
      ? [
          {
            value: CUSTOM_BONUS_PROFICIENCY_SOURCE,
            label: CUSTOM_BONUS_LABELS.proficiencySource,
          },
        ]
      : []),
    ...ABILITY_OPTIONS.map((ability) => ({
      value: ability.value,
      label: ability.label,
    })),
  ]);

  /**
   * Вклад бонуса, который считается сам (характеристика, мастерство): место
   * числа в строке занимает готовое значение — вводить там нечего.
   *
   * @param bonus - свой бонус строки
   * @returns вклад бонуса со знаком
   */
  function getDerivedValue(bonus: DnDCustomBonus): string {
    return formatSignedNumber(getCustomBonusValue(props.context, bonus));
  }

  /** Заводит пустой бонус: заготовка «+1» правится тут же в строке */
  function addBonus(): void {
    rows.value = [
      ...rows.value,
      { ...NEW_CUSTOM_BONUS, id: generateEntityId('bonus') },
    ];
  }

  /**
   * Убирает бонус из списка.
   *
   * @param rowId - идентификатор строки
   */
  function removeBonus(rowId: string): void {
    rows.value = rows.value.filter((row) => row.id !== rowId);
  }

  /**
   * Смена источника бонуса: своё число при этом не теряется — оно ждёт
   * возврата к нему.
   *
   * @param rowId - идентификатор строки
   * @param source - выбранный источник
   */
  function setSource(rowId: string, source: DnDCustomBonusSource): void {
    rows.value = rows.value.map((row) =>
      row.id === rowId ? withCustomBonusSource(row, source) : row,
    );
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Строка не переносится: корзина ходит за своим бонусом, и на отдельной
      строке её не с чем связать. Пометка с источником вместо переноса ужимаются
      — их поля тянутся по остатку ширины -->
    <div
      v-for="row in rows"
      :key="row.id"
      class="flex items-center gap-2"
    >
      <UInput
        v-model="row.label"
        :maxlength="CUSTOM_BONUS_LABEL_MAX_LENGTH"
        :placeholder="CUSTOM_BONUS_LABELS.labelPlaceholder"
        size="sm"
        class="min-w-0 grow basis-40"
      />

      <USelect
        :model-value="getCustomBonusSource(row)"
        :items="sourceOptions"
        value-key="value"
        label-key="label"
        size="sm"
        class="min-w-0 grow basis-32"
        :aria-label="CUSTOM_BONUS_LABELS.source"
        @update:model-value="setSource(row.id, $event)"
      />

      <UInputNumber
        v-if="row.kind === 'flat'"
        v-model="row.value"
        :min="CUSTOM_BONUS_MIN"
        :max="CUSTOM_BONUS_MAX"
        :format-options="BONUS_INPUT_FORMAT_OPTIONS"
        size="sm"
        class="w-28 shrink-0"
      />

      <span
        v-else
        class="w-28 shrink-0 rounded-md border border-default/50 bg-elevated/40 px-2 py-1 text-center text-sm font-semibold text-toned tabular-nums"
      >
        {{ getDerivedValue(row) }}
      </span>

      <!-- Размер тот же, что у полей строки: кнопка стоит с ними в ряд, и
        меньшая ростом сбивала бы линию -->
      <UTooltip :text="CUSTOM_BONUS_LABELS.remove">
        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="sm"
          square
          class="shrink-0"
          :aria-label="CUSTOM_BONUS_LABELS.remove"
          @click.left.exact.prevent="removeBonus(row.id)"
        />
      </UTooltip>
    </div>

    <!-- Кнопка во всю ширину с пунктиром: она же место будущей строки, поэтому
      пустому списку не нужна отдельная подпись «бонусов нет» -->
    <UButton
      v-if="withAdd"
      :label="CUSTOM_BONUS_LABELS.add"
      icon="tabler:plus"
      color="neutral"
      variant="ghost"
      size="sm"
      block
      class="border border-dashed border-default hover:border-primary hover:text-primary"
      @click.left.exact.prevent="addBonus"
    />
  </div>
</template>
