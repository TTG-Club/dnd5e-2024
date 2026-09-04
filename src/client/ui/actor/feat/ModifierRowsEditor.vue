<script setup lang="ts">
  import type {
    DamageDefenseSource,
    EditableModifierRow,
  } from './featEditorTypes';

  import { computed } from 'vue';

  import { typedObjectEntries } from '@vtt/shared';
  import {
    DAMAGE_DEFENSE_KIND_LABELS,
    DAMAGE_TYPE_LABELS,
    DEFENSIBLE_DAMAGE_TYPES,
    listSelectableConditions,
  } from '@vtt/shared/system/dnd.js';

  import {
    FEAT_DAMAGE_CHOICE_COUNT,
    FEAT_GRANTS_LABELS,
    MODIFIER_ROW_LABELS,
  } from '../constants';
  import FieldHint from '../FieldHint.vue';
  import {
    isDamageDefenseChoiceRow,
    isFixedDamageDefenseRow,
    modifierHasValue,
    modifierSupportsEqualsWalk,
  } from './featEditorTypes';

  /**
   * Редактор постоянных правок листа: одна строка — одна правка. Строка рисует
   * только свои поля — прежняя сетка держала на экране все чувства и все
   * скорости сразу, и почти все поля в ней всегда были нулями.
   *
   * Список видов живёт в меню кнопки добавления ({@link ModifierAddMenu}), а
   * сама кнопка — в шапке раздела: пустому блоку хватает строки заголовка.
   */
  const rows = defineModel<EditableModifierRow[]>({ required: true });

  const damageTypeOptions = DEFENSIBLE_DAMAGE_TYPES.map((damageType) => ({
    value: damageType,
    label: DAMAGE_TYPE_LABELS[damageType],
  }));

  const defenseKindOptions = typedObjectEntries(DAMAGE_DEFENSE_KIND_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  // Вычисляемый: помимо канона в списке состояния, заведённые в мире
  const conditionOptions = computed(() =>
    listSelectableConditions().map((condition) => ({
      value: condition.key,
      label: condition.nameRu,
    })),
  );

  /** Кто называет тип урона: автор черты или игрок при её взятии. */
  const damageSourceOptions: { value: DamageDefenseSource; label: string }[] = [
    { value: 'fixed', label: FEAT_GRANTS_LABELS.damageSourceFixed },
    { value: 'choice', label: FEAT_GRANTS_LABELS.damageSourceChoice },
  ];

  function removeRow(index: number): void {
    rows.value = rows.value.filter((_, rowIndex) => rowIndex !== index);
  }

  /** Подпись строки — она же подпись вида модификатора. */
  function rowLabel(row: EditableModifierRow): string {
    return MODIFIER_ROW_LABELS[row.kind];
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(row, index) in rows"
      :key="row.uid"
      class="flex flex-col gap-2 rounded-lg bg-elevated/40 p-2"
    >
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-sm">
          {{ rowLabel(row) }}
        </span>

        <UInputNumber
          v-if="modifierHasValue(row.kind) && !row.equalsWalk"
          v-model="row.value"
          :min="-99"
          :max="999"
          size="sm"
          class="w-28"
          :aria-label="FEAT_GRANTS_LABELS.modifierValue"
        />

        <UCheckbox
          v-if="modifierSupportsEqualsWalk(row.kind)"
          v-model="row.equalsWalk"
          :label="FEAT_GRANTS_LABELS.equalsWalk"
        />

        <USelect
          v-if="row.kind === 'damageDefense'"
          v-model="row.source"
          :items="damageSourceOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-44"
          :aria-label="FEAT_GRANTS_LABELS.damageSource"
        />

        <FieldHint
          v-if="row.kind === 'damageDefense'"
          :text="FEAT_GRANTS_LABELS.damageSourceHint"
        />

        <USelect
          v-if="isFixedDamageDefenseRow(row)"
          v-model="row.damageType"
          :items="damageTypeOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-40"
          :aria-label="FEAT_GRANTS_LABELS.damageType"
        />

        <USelect
          v-if="row.kind === 'damageDefense'"
          v-model="row.defenseKind"
          :items="defenseKindOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-40"
          :aria-label="FEAT_GRANTS_LABELS.defenseKind"
        />

        <USelect
          v-if="row.kind === 'conditionImmunity'"
          v-model="row.condition"
          :items="conditionOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-48"
          :aria-label="FEAT_GRANTS_LABELS.condition"
        />

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="rowLabel(row)"
          @click.left.exact.prevent="removeRow(index)"
        />
      </div>

      <!-- Тип урона называет игрок: чем ограничен выбор и как он подписан -->
      <div
        v-if="isDamageDefenseChoiceRow(row)"
        class="flex flex-wrap items-end gap-2"
      >
        <UFormField
          :label="FEAT_GRANTS_LABELS.damageChoicePool"
          class="min-w-56 flex-1"
        >
          <USelectMenu
            v-model="row.damageTypes"
            :items="damageTypeOptions"
            value-key="value"
            label-key="label"
            multiple
            size="sm"
            :placeholder="FEAT_GRANTS_LABELS.damageChoicePoolPlaceholder"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="FEAT_GRANTS_LABELS.damageChoiceCount"
          class="w-28"
        >
          <UInputNumber
            v-model="row.count"
            :min="FEAT_DAMAGE_CHOICE_COUNT.min"
            :max="FEAT_DAMAGE_CHOICE_COUNT.max"
            size="sm"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="FEAT_GRANTS_LABELS.damageChoiceLabel"
          class="min-w-56 flex-1"
        >
          <UInput
            v-model="row.label"
            size="sm"
            :placeholder="FEAT_GRANTS_LABELS.damageChoiceLabelPlaceholder"
            class="w-full"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
