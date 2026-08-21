<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';

  import type { EditableFeatGrants } from './featEditorTypes';

  import {
    getFeatChoiceDefaultPool,
    isAbilityType,
  } from '@vtt/shared/system/dnd.js';

  import { SPELL_CHOICE_LABELS } from '../constants';

  /**
   * Заклинательная характеристика черты и настройка подготовки.
   *
   * Характеристика одна на все заклинания черты — и выданные, и выбранные
   * игроком, — поэтому живёт своим блоком, а не рядом с одним из списков.
   * Одно поле на три случая: пусто — характеристику задаёт класс, чья это магия;
   * одна — она и есть; несколько — лист даст игроку выбрать одну из них. Так
   * автору не приходится выбирать между «задать» и «спросить»: это одно и то же
   * поле с разным числом значений.
   *
   * Своей рамки нет: раздел рисует форма — так же, как у остальных блоков
   * вкладки, — иначе рамка вложилась бы в рамку.
   *
   * Блок общий для формы черты и формы предыстории — у обеих свой `featData`.
   */
  const grants = defineModel<EditableFeatGrants>({ required: true });

  /**
   * Заклинательной характеристикой бывают только три — берём их из того же
   * справочника, из которого лист собирает варианты выбора.
   */
  const abilityOptions = getFeatChoiceDefaultPool('spellcastingAbility').map(
    (option) => ({
      value: option.value,
      label: option.name ?? option.value,
    }),
  );

  /**
   * Записывает характеристики, от которых считаются заклинания черты.
   *
   * @param values - выбранные характеристики
   */
  function setAbilities(values: string[]): void {
    const abilities = values.filter((value): value is AbilityType =>
      isAbilityType(value),
    );

    grants.value = {
      ...grants.value,
      spellChoice: { ...grants.value.spellChoice, abilityOptions: abilities },
    };
  }
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end gap-3">
      <UFormField class="w-72">
        <USelectMenu
          :model-value="grants.spellChoice.abilityOptions"
          :items="abilityOptions"
          value-key="value"
          label-key="label"
          multiple
          :placeholder="SPELL_CHOICE_LABELS.spellcastingAbilityPlaceholder"
          class="w-full"
          @update:model-value="setAbilities"
        />
      </UFormField>

      <UCheckbox
        v-model="grants.grantedSpellsAlwaysPrepared"
        :label="SPELL_CHOICE_LABELS.grantedSpellsAlwaysPrepared"
        class="mb-2"
      />
    </div>

    <p class="mt-2 text-xs text-dimmed">
      {{ SPELL_CHOICE_LABELS.grantedSpellsAlwaysPreparedHint }}
    </p>
  </div>
</template>
