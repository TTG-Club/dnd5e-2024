<!--
  Поле Сл спасброска. Где у Сл есть источник (заклинатель, действие, оружие),
  выбирается «Авто» — Сл источника, в данных это 0 — или «Вручную» со своим
  числом. Где источника нет, остаётся число. У Сл эффекта есть ещё «Формулой»
  — по владельцу эффекта («8 + @prof + @mod.str»); число тогда запасное.
-->
<script setup lang="ts">
  import type { SaveDcFieldMode } from '../constants';

  import { computed } from 'vue';

  import {
    DEFAULT_EFFECT_SAVE_DC,
    describeSaveDcFormulaError,
    SOURCE_SAVE_DC,
  } from '@vtt/shared/system/dnd.js';

  import { SAVE_DC_FORMULA_LABELS } from '../constants';
  import {
    SAVE_DC_AUTO_SEPARATOR,
    SAVE_DC_FIELD_MODE_OPTIONS,
  } from '../effectFormOptions';

  const props = defineProps<{
    /** Подпись поля */
    label: string;
    /** Пояснение под подписью */
    description?: string;
    /** Можно ли «Авто»: у Сл есть источник */
    autoAllowed: boolean;
    /** Чья Сл подставляется в «Авто» («Сл заклинателя») */
    autoLabel?: string;
    /** Посчитанная Сл источника, если окно её знает */
    autoValue?: number;
    /** Можно ли «Формулой»: у Сл эффекта есть владелец */
    formulaAllowed?: boolean;
    /** Есть ли у события урон — токен `@damage` в формуле */
    acceptsDamage?: boolean;
  }>();

  /** Сл: `SOURCE_SAVE_DC` — «Авто» */
  const dc = defineModel<number>({ required: true });

  /** Сл формулой; `undefined` — формулы нет, пустая строка — её набирают */
  const formula = defineModel<string | undefined>('formula');

  const modeOptions = computed(() =>
    SAVE_DC_FIELD_MODE_OPTIONS.filter(
      (option) =>
        (option.value !== 'auto' || props.autoAllowed)
        && (option.value !== 'formula' || props.formulaAllowed),
    ),
  );

  const mode = computed<SaveDcFieldMode>({
    get: () => {
      if (props.formulaAllowed && formula.value !== undefined) {
        return 'formula';
      }

      return props.autoAllowed && dc.value === SOURCE_SAVE_DC
        ? 'auto'
        : 'manual';
    },
    set: (nextMode) => {
      if (nextMode === 'formula') {
        formula.value = formula.value ?? '';

        return;
      }

      formula.value = undefined;

      if (nextMode === 'auto') {
        dc.value = SOURCE_SAVE_DC;

        return;
      }

      // Своё число начинается с того, что сейчас дал бы источник
      if (dc.value === SOURCE_SAVE_DC) {
        dc.value = props.autoValue ?? DEFAULT_EFFECT_SAVE_DC;
      }
    },
  });

  const manualDc = computed({
    get: () => dc.value,
    set: (value: number | null) => {
      if (value !== null) {
        dc.value = value;
      }
    },
  });

  const formulaText = computed({
    get: () => formula.value ?? '',
    set: (value: string | number) => {
      formula.value = String(value);
    },
  });

  /** Что подставится в «Авто»: чья Сл и её число, если известно */
  const autoText = computed(() => {
    const label = props.autoLabel ?? '';

    return props.autoValue === undefined
      ? label
      : `${label}${SAVE_DC_AUTO_SEPARATOR}${props.autoValue}`;
  });

  const formulaError = computed(() => {
    const text = formula.value?.trim();

    return mode.value === 'formula' && text
      ? describeSaveDcFormulaError(text, {
          acceptsDamage: props.acceptsDamage === true,
        })
      : undefined;
  });

  const formulaHelp = computed(() =>
    mode.value === 'formula'
      ? `${SAVE_DC_FORMULA_LABELS.hint}${props.acceptsDamage ? SAVE_DC_FORMULA_LABELS.damageHint : ''}`
      : undefined,
  );
</script>

<template>
  <UFormField
    :label="label"
    :description="description"
    :help="formulaHelp"
    :error="formulaError"
    class="min-w-56"
  >
    <div class="flex items-center gap-2">
      <USelect
        v-if="modeOptions.length > 1"
        v-model="mode"
        :items="modeOptions"
        value-key="value"
        size="sm"
        class="w-32"
        :portal="false"
      />

      <span
        v-if="mode === 'auto'"
        class="text-sm text-muted"
      >
        {{ autoText }}
      </span>

      <UInput
        v-else-if="mode === 'formula'"
        v-model="formulaText"
        :placeholder="SAVE_DC_FORMULA_LABELS.placeholder"
        size="sm"
        class="w-64"
      />

      <UInputNumber
        v-else
        v-model="manualDc"
        :min="1"
        size="sm"
        class="w-28"
      />
    </div>
  </UFormField>
</template>
