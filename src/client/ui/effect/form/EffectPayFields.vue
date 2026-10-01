<!--
  Цена ресурсом: чем платят за применение, включение, каст или срабатывание —
  счётчик листа, кости хитов, ячейка заклинания, заряды предмета, вдохновение.
  Платежей может быть несколько: платятся все. Один блок на эффект и на строку
  срабатывания — поля у цены везде одни.
-->
<script setup lang="ts">
  import type {
    EffectPay,
    EffectPrice,
    EffectPriceKind,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    DEFAULT_EFFECT_PRICE_KIND,
    MAX_EFFECT_PRICES,
    MAX_SPELL_SLOT_LEVEL,
    MIN_SPELL_SLOT_LEVEL,
    priceHasAmount,
  } from '@vtt/shared/system/dnd.js';

  import FieldHint from '../../actor/FieldHint.vue';
  import {
    EFFECT_PAY_FIELD_LABELS,
    EFFECT_PAY_ROW_ICONS,
    EFFECT_PRICE_KIND_OPTIONS,
  } from '../payLabels';

  defineProps<{
    /** Пояснение к блоку: кто платит и какие токены доступны */
    hint: string;
  }>();

  /** Цена; нет — платить не за что */
  const pay = defineModel<EffectPay | undefined>({ required: true });

  const prices = computed(() => pay.value ?? []);

  const canAdd = computed(() => prices.value.length < MAX_EFFECT_PRICES);

  /**
   * Записывает платежи: пустой список — отсутствием цены.
   *
   * @param next - платежи
   */
  function write(next: EffectPrice[]): void {
    pay.value = next.length > 0 ? next : undefined;
  }

  /**
   * Новый платёж выбранного вида с полями по умолчанию.
   *
   * @param kind - вид цены
   * @returns платёж
   */
  function createPrice(kind: EffectPriceKind): EffectPrice {
    return kind === 'counter' ? { kind, counter: '' } : { kind };
  }

  /** Добавляет платёж */
  function addPrice(): void {
    write([...prices.value, createPrice(DEFAULT_EFFECT_PRICE_KIND)]);
  }

  /**
   * Убирает платёж.
   *
   * @param index - номер платежа
   */
  function removePrice(index: number): void {
    write(prices.value.filter((_, at) => at !== index));
  }

  /**
   * Заменяет платёж.
   *
   * @param index - номер платежа
   * @param next - новый платёж
   */
  function replacePrice(index: number, next: EffectPrice): void {
    write(prices.value.map((price, at) => (at === index ? next : price)));
  }

  /**
   * Меняет вид платежа: поля прежнего вида не переносятся — у каждого свои.
   *
   * @param index - номер платежа
   * @param kind - выбранный вид
   */
  function selectKind(index: number, kind: EffectPriceKind): void {
    if (prices.value[index]?.kind !== kind) {
      replacePrice(index, createPrice(kind));
    }
  }

  /**
   * Меняет текстовое поле платежа: ключ счётчика или формулу количества.
   * Пустая формула — отсутствием поля.
   *
   * @param index - номер платежа
   * @param field - поле
   * @param value - введённое значение
   */
  function updateText(
    index: number,
    field: 'counter' | 'amount' | 'max',
    value: string | number,
  ): void {
    const price = prices.value[index];
    const text = String(value);

    if (!price) {
      return;
    }

    if (field === 'counter') {
      if (price.kind === 'counter') {
        replacePrice(index, { ...price, counter: text });
      }

      return;
    }

    if (priceHasAmount(price)) {
      replacePrice(index, {
        ...price,
        [field]: text.trim() ? text : undefined,
      });
    }
  }

  /**
   * Меняет границу круга ячейки: пустое поле — без границы.
   *
   * @param index - номер платежа
   * @param field - нижняя или верхняя граница
   * @param level - круг
   */
  function updateSlotLevel(
    index: number,
    field: 'minLevel' | 'maxLevel',
    level: number | null,
  ): void {
    const price = prices.value[index];

    if (price?.kind === 'spellSlot') {
      replacePrice(index, { ...price, [field]: level ?? undefined });
    }
  }

  /**
   * Включает «только ячейка договора».
   *
   * @param index - номер платежа
   * @param enabled - включено ли
   */
  function updatePact(index: number, enabled: boolean): void {
    const price = prices.value[index];

    if (price?.kind === 'spellSlot') {
      replacePrice(index, { ...price, pact: enabled ? true : undefined });
    }
  }

  /** Строки платежей с готовыми значениями полей */
  const rows = computed(() =>
    prices.value.map((price, index) => ({
      index,
      kind: price.kind,
      counter: price.kind === 'counter' ? price.counter : '',
      hasAmount: priceHasAmount(price),
      amount: priceHasAmount(price) ? (price.amount ?? '') : '',
      max: priceHasAmount(price) ? (price.max ?? '') : '',
      isSlot: price.kind === 'spellSlot',
      minLevel: price.kind === 'spellSlot' ? (price.minLevel ?? null) : null,
      maxLevel: price.kind === 'spellSlot' ? (price.maxLevel ?? null) : null,
      pact: price.kind === 'spellSlot' && price.pact === true,
      note: resolveKindNote(price.kind),
    })),
  );

  /**
   * Пояснение к виду цены без своих полей.
   *
   * @param kind - вид цены
   * @returns пояснение либо пустая строка
   */
  function resolveKindNote(kind: EffectPriceKind): string {
    if (kind === 'itemUses') {
      return EFFECT_PAY_FIELD_LABELS.itemUsesHint;
    }

    return kind === 'inspiration'
      ? EFFECT_PAY_FIELD_LABELS.inspirationHint
      : '';
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-1 text-xs font-medium text-toned">
      {{ EFFECT_PAY_FIELD_LABELS.title }}

      <FieldHint :text="hint" />
    </div>

    <div
      v-for="row in rows"
      :key="row.index"
      class="flex flex-col gap-1"
    >
      <div class="flex flex-wrap items-end gap-2">
        <UFormField
          :label="EFFECT_PAY_FIELD_LABELS.kind"
          class="w-52"
        >
          <USelect
            :model-value="row.kind"
            :items="EFFECT_PRICE_KIND_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
            @update:model-value="selectKind(row.index, $event)"
          />
        </UFormField>

        <UFormField
          v-if="row.kind === 'counter'"
          :label="EFFECT_PAY_FIELD_LABELS.counter"
          class="w-56"
        >
          <UInput
            :model-value="row.counter"
            :placeholder="EFFECT_PAY_FIELD_LABELS.counterPlaceholder"
            size="sm"
            class="w-full"
            @update:model-value="updateText(row.index, 'counter', $event)"
          />
        </UFormField>

        <template v-if="row.hasAmount">
          <UFormField class="w-36">
            <template #label>
              <span class="flex items-center gap-1">
                {{ EFFECT_PAY_FIELD_LABELS.amount }}

                <FieldHint :text="EFFECT_PAY_FIELD_LABELS.amountHint" />
              </span>
            </template>

            <UInput
              :model-value="row.amount"
              :placeholder="EFFECT_PAY_FIELD_LABELS.amountPlaceholder"
              size="sm"
              class="w-full"
              @update:model-value="updateText(row.index, 'amount', $event)"
            />
          </UFormField>

          <UFormField class="w-36">
            <template #label>
              <span class="flex items-center gap-1">
                {{ EFFECT_PAY_FIELD_LABELS.max }}

                <FieldHint :text="EFFECT_PAY_FIELD_LABELS.maxHint" />
              </span>
            </template>

            <UInput
              :model-value="row.max"
              size="sm"
              class="w-full"
              @update:model-value="updateText(row.index, 'max', $event)"
            />
          </UFormField>
        </template>

        <template v-if="row.isSlot">
          <UFormField
            :label="EFFECT_PAY_FIELD_LABELS.minLevel"
            class="w-24"
          >
            <UInputNumber
              :model-value="row.minLevel"
              :min="MIN_SPELL_SLOT_LEVEL"
              :max="MAX_SPELL_SLOT_LEVEL"
              :placeholder="String(MIN_SPELL_SLOT_LEVEL)"
              size="sm"
              class="w-full"
              @update:model-value="
                updateSlotLevel(row.index, 'minLevel', $event)
              "
            />
          </UFormField>

          <UFormField
            :label="EFFECT_PAY_FIELD_LABELS.maxLevel"
            class="w-24"
          >
            <UInputNumber
              :model-value="row.maxLevel"
              :min="MIN_SPELL_SLOT_LEVEL"
              :max="MAX_SPELL_SLOT_LEVEL"
              :placeholder="String(MAX_SPELL_SLOT_LEVEL)"
              size="sm"
              class="w-full"
              @update:model-value="
                updateSlotLevel(row.index, 'maxLevel', $event)
              "
            />
          </UFormField>

          <USwitch
            :model-value="row.pact"
            class="mb-2"
            :label="EFFECT_PAY_FIELD_LABELS.pact"
            @update:model-value="updatePact(row.index, $event)"
          />
        </template>

        <UButton
          :icon="EFFECT_PAY_ROW_ICONS.remove"
          :aria-label="EFFECT_PAY_FIELD_LABELS.remove"
          color="neutral"
          variant="ghost"
          size="sm"
          class="mb-0.5"
          @click.left.exact.prevent="removePrice(row.index)"
        />
      </div>

      <p
        v-if="row.note"
        class="text-xs text-muted"
      >
        {{ row.note }}
      </p>
    </div>

    <UButton
      v-if="canAdd"
      :icon="EFFECT_PAY_ROW_ICONS.add"
      :label="EFFECT_PAY_FIELD_LABELS.add"
      color="neutral"
      variant="soft"
      size="xs"
      class="w-fit"
      @click.left.exact.prevent="addPrice"
    />
  </div>
</template>
