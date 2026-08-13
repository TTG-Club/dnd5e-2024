<script setup lang="ts">
  import type { EditableItemUses } from '../../composables/useItemUsesForm';

  import { ITEM_USES_RECOVERY_OPTIONS } from '../../composables/useItemUsesForm';
  import { ITEM_USES_LABELS } from './constants';

  /**
   * Переиспользуемый блок «Заряды» для форм снаряжения, оружия и инструмента.
   * Двусторонняя привязка через {@link EditableItemUses} — компонент не знает
   * ни о форме-владельце, ни о сериализации в `GameItem.uses`.
   *
   * Остаток зарядов здесь не правится: это состояние конкретного экземпляра, и
   * им управляет карточка предмета на листе, а не справочная форма.
   */
  const uses = defineModel<EditableItemUses>({ required: true });
</script>

<template>
  <div class="flex flex-col gap-3">
    <UCheckbox
      v-model="uses.enabled"
      :label="ITEM_USES_LABELS.enabled"
    />

    <template v-if="uses.enabled">
      <div class="grid grid-cols-2 items-start gap-3">
        <UFormField :label="ITEM_USES_LABELS.max">
          <UInput
            v-model.number="uses.max"
            type="number"
            :min="1"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="ITEM_USES_LABELS.cost">
          <UInput
            v-model.number="uses.cost"
            type="number"
            :min="1"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField :label="ITEM_USES_LABELS.recovery">
        <USelect
          v-model="uses.recovery"
          :items="ITEM_USES_RECOVERY_OPTIONS"
          value-key="value"
          class="w-full"
        />
      </UFormField>

      <UFormField
        v-if="uses.recovery !== 'manual'"
        :label="ITEM_USES_LABELS.formula"
        :hint="ITEM_USES_LABELS.formulaHint"
      >
        <UInput
          v-model="uses.formula"
          :placeholder="ITEM_USES_LABELS.formulaPlaceholder"
          class="w-full"
        />
      </UFormField>
    </template>
  </div>
</template>
