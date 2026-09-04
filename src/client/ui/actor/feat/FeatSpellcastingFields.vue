<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';

  import type { EditableFeatGrants } from './featEditorTypes';

  import { ABILITY_OPTIONS, isAbilityType } from '@vtt/shared/system/dnd.js';

  import { SPELL_CHOICE_LABELS } from '../constants';

  /**
   * Характеристика заклинаний, которые игрок ВЫБИРАЕТ.
   *
   * Одно поле на три случая: пусто — характеристику задаёт класс, чья это магия;
   * одна — она и есть; несколько — лист даст игроку выбрать одну из них
   * («Посвящённый в магию»). Так автору не приходится выбирать между «задать» и
   * «спросить»: это одно и то же поле с разным числом значений.
   *
   * У ВЫДАННЫХ заклинаний характеристика своя у каждой группы выдачи: один набор
   * может считаться от одной характеристики, другой — от другой, и одно поле на
   * всех такого не описывает. Там же живёт и отметка подготовки.
   *
   * Своей рамки нет: раздел рисует форма — так же, как у остальных блоков
   * вкладки, — иначе рамка вложилась бы в рамку.
   *
   * Блок общий для формы черты и формы предыстории — у обеих свой `featData`.
   */
  const grants = defineModel<EditableFeatGrants>({ required: true });

  /**
   * Характеристики — все шесть.
   *
   * Не только три «заклинательные»: заклинание записи может считаться от любой
   * характеристики, и урезанный набор просто нельзя было бы заполнить.
   */
  const abilityOptions = ABILITY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

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
</template>
