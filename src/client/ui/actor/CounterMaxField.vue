<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type { CounterMaxSource } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import {
    ABILITY_OPTIONS,
    COUNTER_COUNT_MAX,
    COUNTER_COUNT_MIN,
    COUNTER_MAX_DEFAULT_ABILITY,
    COUNTER_MAX_OFFSET_MAX,
    COUNTER_MAX_OFFSET_MIN,
    counterMaxFormula,
    parseCounterMaxFormula,
  } from '@vtt/shared/system/dnd.js';

  import { COUNTER_RESOURCE_LABELS } from './constants';

  /**
   * Откуда берётся максимум ресурса.
   *
   * Хранится ОДНОЙ формулой: число, `@prof`, `@level`, `@mod.<abbr>` — ту же
   * грамматику понимают ресурсы черт, активные эффекты и лист. Поле лишь
   * раскладывает формулу на понятный выбор: знать про `@mod.cha` ни автор черты,
   * ни игрок не обязаны. Формулу, написанную руками и не разобравшуюся, поле
   * показывает как есть — подставив вместо неё число, оно потеряло бы
   * написанное.
   */
  const model = defineModel<string>({ required: true });

  const props = defineProps<{
    /**
     * Посчитанный максимум для строки-пояснения. Есть только там, где известен
     * лист: в редакторе черты считать не от кого.
     */
    computedMax?: number;

    /** Компактная раскладка для строки редактора черты. */
    dense?: boolean;
  }>();

  /** Вид максимума: источник формулы либо «своя формула» у неразобранной. */
  type CounterMaxKind = CounterMaxSource | 'formula';

  const kindOptions: { value: CounterMaxKind; label: string }[] = [
    { value: 'fixed', label: COUNTER_RESOURCE_LABELS.sourceFixed },
    { value: 'proficiency', label: COUNTER_RESOURCE_LABELS.sourceProficiency },
    { value: 'ability', label: COUNTER_RESOURCE_LABELS.sourceAbility },
    {
      value: 'spellAbility',
      label: COUNTER_RESOURCE_LABELS.sourceSpellAbility,
    },
    { value: 'level', label: COUNTER_RESOURCE_LABELS.sourceLevel },
    { value: 'formula', label: COUNTER_RESOURCE_LABELS.sourceFormula },
  ];

  /** Разобранное правило; null — формула пуста либо написана руками. */
  const rule = computed(() => parseCounterMaxFormula(model.value));

  /**
   * «Свою формулу» выбрали в списке. Без этого пустое поле сразу читалось бы
   * как «своё число», и вид схлопывался бы обратно, не дав ничего написать.
   */
  const isCustomFormula = ref(false);

  const kind = computed<CounterMaxKind>(() => {
    if (rule.value) {
      return rule.value.source;
    }

    // Пустое поле — это ещё не «своя формула»: новый ресурс открывается обычным
    // полем количества
    return model.value.trim() || isCustomFormula.value ? 'formula' : 'fixed';
  });

  /** Максимум привязан к растущему значению листа, а не задан числом. */
  const isComputed = computed(
    () => kind.value !== 'fixed' && kind.value !== 'formula',
  );

  /** Своё число максимума: у «своего числа» оно целиком лежит в прибавке. */
  const fixedAmount = computed(() =>
    kind.value === 'fixed' ? (rule.value?.offset ?? 0) : 0,
  );

  const offset = computed(() => rule.value?.offset ?? 0);

  const ability = computed<AbilityType>(
    () => rule.value?.ability ?? COUNTER_MAX_DEFAULT_ABILITY,
  );

  /**
   * Смена вида переписывает формулу целиком: прибавка и характеристика
   * переносятся, чтобы «бонус мастерства − 1» не сбрасывался при переборе
   * источников.
   *
   * @param next - выбранный вид максимума
   */
  function setKind(next: CounterMaxKind): void {
    isCustomFormula.value = next === 'formula';

    if (next === 'formula') {
      // «Своя формула» начинается с пустого поля: подставленный `@prof`
      // прочитался бы обратно как «бонус мастерства», и вид тут же сменился бы
      model.value = '';

      return;
    }

    model.value = counterMaxFormula({
      source: next,
      ability: ability.value,
      // Число и прибавка живут в одном поле правила, но значат разное:
      // «своё число» с прибавкой −1 стало бы ресурсом на минус один заряд
      offset: next === 'fixed' ? Math.max(fixedAmount.value, 1) : offset.value,
    });
  }

  /**
   * Записывает своё число максимума.
   *
   * @param value - количество зарядов
   */
  function setFixedAmount(value: number | undefined): void {
    model.value = String(value ?? COUNTER_COUNT_MIN);
  }

  /**
   * Записывает прибавку к значению источника.
   *
   * @param value - прибавка, может быть отрицательной
   */
  function setOffset(value: number | undefined): void {
    if (!rule.value) {
      return;
    }

    model.value = counterMaxFormula({ ...rule.value, offset: value ?? 0 });
  }

  /**
   * Записывает характеристику, чей модификатор идёт в максимум.
   *
   * @param value - выбранная характеристика
   */
  function setAbility(value: AbilityType): void {
    if (!rule.value) {
      return;
    }

    model.value = counterMaxFormula({ ...rule.value, ability: value });
  }
</script>

<template>
  <div class="flex flex-wrap items-end gap-2">
    <UFormField
      :label="COUNTER_RESOURCE_LABELS.max"
      :class="props.dense ? 'w-44' : 'min-w-40 flex-1'"
    >
      <USelect
        :model-value="kind"
        :items="kindOptions"
        :aria-label="COUNTER_RESOURCE_LABELS.maxSourceAria"
        value-key="value"
        label-key="label"
        size="sm"
        class="w-full"
        @update:model-value="setKind"
      />
    </UFormField>

    <UFormField
      v-if="kind === 'fixed'"
      :label="COUNTER_RESOURCE_LABELS.maxAmount"
      class="w-24"
    >
      <UInputNumber
        :model-value="fixedAmount"
        :min="COUNTER_COUNT_MIN"
        :max="COUNTER_COUNT_MAX"
        size="sm"
        class="w-full"
        @update:model-value="setFixedAmount"
      />
    </UFormField>

    <UFormField
      v-else-if="kind === 'formula'"
      :label="COUNTER_RESOURCE_LABELS.formula"
      class="w-32"
    >
      <UInput
        v-model="model"
        size="sm"
        class="w-full"
        :placeholder="COUNTER_RESOURCE_LABELS.formulaPlaceholder"
      />
    </UFormField>

    <template v-else>
      <UFormField
        v-if="kind === 'ability'"
        :label="COUNTER_RESOURCE_LABELS.ability"
        class="w-40"
      >
        <USelect
          :model-value="ability"
          :items="ABILITY_OPTIONS"
          :aria-label="COUNTER_RESOURCE_LABELS.ability"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
          @update:model-value="setAbility"
        />
      </UFormField>

      <UFormField
        :label="COUNTER_RESOURCE_LABELS.offset"
        class="w-24"
      >
        <UInputNumber
          :model-value="offset"
          :min="COUNTER_MAX_OFFSET_MIN"
          :max="COUNTER_MAX_OFFSET_MAX"
          :aria-label="COUNTER_RESOURCE_LABELS.offset"
          size="sm"
          class="w-full"
          @update:model-value="setOffset"
        />
      </UFormField>
    </template>

    <p
      v-if="isComputed && props.computedMax !== undefined"
      class="mb-1.5 grow text-xs text-dimmed"
    >
      {{ COUNTER_RESOURCE_LABELS.computed }}: {{ props.computedMax }}
    </p>
  </div>
</template>
