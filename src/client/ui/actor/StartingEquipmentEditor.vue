<script setup lang="ts">
  import type { EditableStartingEquipmentOption } from './startingEquipmentEditorTypes';

  import { STARTING_EQUIPMENT_EDITOR_LABELS } from './constants';
  import FormSection from './FormSection.vue';
  import { createEquipmentOption } from './startingEquipmentEditorTypes';

  /**
   * Редактор вариантов стартового снаряжения: строка варианта, позиции, монеты.
   * Общий для предыстории и класса — у класса вариант помечен буквой, у
   * предыстории вместо метки есть альтернатива золотом.
   *
   * До появления позиций формы писали только строку, и записи компендиума
   * теряли разбор по предметам при первом же сохранении.
   */
  const options = defineModel<EditableStartingEquipmentOption[]>({
    required: true,
  });

  const props = withDefaults(
    defineProps<{
      /** Показывать метку варианта («А», «Б») — у класса */
      showKey?: boolean;
      /** Показывать альтернативу золотом — у предыстории */
      showGoldAlternative?: boolean;
    }>(),
    { showKey: false, showGoldAlternative: false },
  );

  /** Латинские метки вариантов по порядку — ими подписан выбор у класса. */
  const OPTION_KEYS = 'ABCDEFGH';

  /** Свободная метка для нового варианта класса. */
  function nextKey(): string {
    if (!props.showKey) {
      return '';
    }

    const taken = new Set(options.value.map((option) => option.key));

    return (
      [...OPTION_KEYS].find((key) => !taken.has(key))
      ?? String(options.value.length + 1)
    );
  }

  function addOption(): void {
    options.value = [...options.value, createEquipmentOption(nextKey())];
  }

  function removeOption(index: number): void {
    options.value = options.value.filter(
      (_, optionIndex) => optionIndex !== index,
    );
  }

  function addItem(option: EditableStartingEquipmentOption): void {
    option.items = [...option.items, { name: '' }];
  }

  function removeItem(
    option: EditableStartingEquipmentOption,
    index: number,
  ): void {
    option.items = option.items.filter((_, itemIndex) => itemIndex !== index);
  }

  /** Заголовок карточки варианта: номер и метка, если она есть. */
  function optionTitle(
    option: EditableStartingEquipmentOption,
    index: number,
  ): string {
    const suffix = option.key ? ` «${option.key}»` : '';

    return `${STARTING_EQUIPMENT_EDITOR_LABELS.optionTitle} ${
      index + 1
    }${suffix}`;
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-xs text-dimmed">
      {{ STARTING_EQUIPMENT_EDITOR_LABELS.hint }}
    </p>

    <div
      v-if="options.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ STARTING_EQUIPMENT_EDITOR_LABELS.empty }}
    </div>

    <FormSection
      v-for="(option, index) in options"
      :key="option.uid"
      :title="optionTitle(option, index)"
      icon="tabler:backpack"
    >
      <template #actions>
        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="optionTitle(option, index)"
          @click.left.exact.prevent="removeOption(index)"
        />
      </template>

      <div class="flex flex-col gap-2">
        <div class="flex items-end gap-2">
          <UFormField
            v-if="props.showKey"
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.optionKey"
            class="w-20"
          >
            <UInput
              v-model="option.key"
              :placeholder="
                STARTING_EQUIPMENT_EDITOR_LABELS.optionKeyPlaceholder
              "
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.description"
            class="flex-1"
          >
            <UInput
              v-model="option.description"
              :placeholder="
                STARTING_EQUIPMENT_EDITOR_LABELS.descriptionPlaceholder
              "
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="flex items-end gap-2">
          <UFormField
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.coins"
            class="w-32"
          >
            <UInputNumber
              v-model="option.coins"
              :min="0"
              :max="9999"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.coin"
            class="w-28"
          >
            <UInput
              v-model="option.coin"
              :placeholder="STARTING_EQUIPMENT_EDITOR_LABELS.coinPlaceholder"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="props.showGoldAlternative"
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.goldAlternative"
            class="flex-1"
          >
            <UInputNumber
              v-model="option.goldAlternative"
              :min="0"
              :max="9999"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-dimmed">
            {{ STARTING_EQUIPMENT_EDITOR_LABELS.itemsTitle }}
          </span>

          <div
            v-for="(item, itemIndex) in option.items"
            :key="itemIndex"
            class="flex items-center gap-2"
          >
            <UInput
              v-model="item.name"
              :placeholder="STARTING_EQUIPMENT_EDITOR_LABELS.itemName"
              class="flex-1"
            />

            <UInput
              v-model="item.url"
              :placeholder="STARTING_EQUIPMENT_EDITOR_LABELS.itemUrl"
              class="w-36"
            />

            <UInputNumber
              v-model="item.quantity"
              :min="1"
              :max="999"
              class="w-24"
              :aria-label="STARTING_EQUIPMENT_EDITOR_LABELS.itemQuantity"
            />

            <UInput
              v-model="item.note"
              :placeholder="STARTING_EQUIPMENT_EDITOR_LABELS.itemNote"
              class="w-36"
            />

            <UButton
              icon="tabler:trash"
              color="error"
              variant="ghost"
              size="xs"
              :aria-label="`${STARTING_EQUIPMENT_EDITOR_LABELS.itemName} ${
                itemIndex + 1
              }`"
              @click.left.exact.prevent="removeItem(option, itemIndex)"
            />
          </div>

          <UButton
            icon="tabler:plus"
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.itemAdd"
            color="neutral"
            variant="subtle"
            size="xs"
            class="self-start"
            @click.left.exact.prevent="addItem(option)"
          />
        </div>
      </div>
    </FormSection>

    <UButton
      icon="tabler:plus"
      :label="STARTING_EQUIPMENT_EDITOR_LABELS.optionAdd"
      color="primary"
      variant="soft"
      block
      @click.left.exact.prevent="addOption"
    />
  </div>
</template>
