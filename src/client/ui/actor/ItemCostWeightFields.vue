<script setup lang="ts">
  import type { ItemRarity } from '@vtt/shared';
  import type { CurrencyType } from '@vtt/shared/system/dnd.js';

  import { CURRENCY_OPTIONS, RARITY_OPTIONS } from '@vtt/shared/system/dnd.js';

  import { ITEM_FORM_LABELS } from './constants';

  /**
   * Переиспользуемые поля «Стоимость / Вес / Редкость» для форм снаряжения,
   * оружия и инструмента. Раскладка одна на все три формы, поэтому живёт здесь,
   * а не копируется в каждую.
   */
  const costValue = defineModel<number>('costValue', { required: true });

  const costCurrency = defineModel<CurrencyType>('costCurrency', {
    required: true,
  });

  const weight = defineModel<number>('weight', { required: true });
  const rarity = defineModel<ItemRarity>('rarity', { required: true });
</script>

<template>
  <!-- Свой `@container`: колонки считаются по ширине самой формы, а не экрана —
       окно редактора бывает узким и на широком мониторе. В узкой форме
       стоимость занимает всю строку, иначе числу рядом с выбором монеты не
       остаётся места. -->
  <div class="@container">
    <div class="grid grid-cols-2 gap-3 @md:grid-cols-5">
      <UFormField
        :label="ITEM_FORM_LABELS.cost"
        class="col-span-2"
      >
        <div class="flex gap-1.5">
          <UInput
            v-model.number="costValue"
            type="number"
            :min="0"
            :placeholder="ITEM_FORM_LABELS.zeroPlaceholder"
            class="min-w-0 flex-1"
          />

          <USelect
            v-model="costCurrency"
            :items="CURRENCY_OPTIONS"
            value-key="value"
            label-key="labelShort"
            class="w-20 shrink-0"
            :portal="false"
          />
        </div>
      </UFormField>

      <UFormField :label="ITEM_FORM_LABELS.weight">
        <UInput
          v-model.number="weight"
          type="number"
          :min="0"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="ITEM_FORM_LABELS.rarity"
        class="@md:col-span-2"
      >
        <USelect
          v-model="rarity"
          :items="RARITY_OPTIONS"
          value-key="value"
          :placeholder="ITEM_FORM_LABELS.rarity"
          class="w-full"
          :portal="false"
        />
      </UFormField>
    </div>
  </div>
</template>
