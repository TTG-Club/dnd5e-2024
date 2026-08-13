<script setup lang="ts">
  import type { EditableFeatGrants } from './featEditorTypes';

  import {
    ABILITY_OPTIONS,
    CONDITIONS,
    LANGUAGE_TYPES,
    SKILLS_LIST,
    TOOLS_LABELS,
  } from '@vtt/shared/system/dnd.js';

  import {
    ARMOR_PROF_LABELS,
    FEAT_GRANTS_LABELS,
    GRANT_FIELD_LABELS,
    GRANT_SECTION_LABELS,
    WEAPON_PROF_LABELS,
  } from '../constants';
  import FormSection from '../FormSection.vue';
  import DamageDefenseEditor from '../species/DamageDefenseEditor.vue';

  /**
   * Переиспользуемый редактор «даров» черты: повышение характеристик, владения
   * (навыки/спасброски/доспехи/оружие/инструменты/языки), защиты от урона и
   * состояний, предусловия. Двусторонняя привязка через {@link EditableFeatGrants}
   * — компонент не знает ни о форме-владельце, ни о сериализации в FeatData.
   *
   * Для предыстории характеристики и навыки выдаются каноническими полями
   * (abilityGrant/skillGrant), поэтому соответствующие секции можно скрыть
   * (`hideAbilityScoreIncrease`/`hideSkillProficiencies`) — иначе бонус
   * характеристик применился бы дважды.
   */
  const grants = defineModel<EditableFeatGrants>({ required: true });

  withDefaults(
    defineProps<{
      /** Скрыть секцию «Повышение характеристик» (для предыстории). */
      hideAbilityScoreIncrease?: boolean;
      /** Скрыть поле «Навыки» во владениях (для предыстории). */
      hideSkillProficiencies?: boolean;
    }>(),
    { hideAbilityScoreIncrease: false, hideSkillProficiencies: false },
  );

  const skillsOptions = SKILLS_LIST.map((skill) => ({
    value: skill.key,
    label: skill.label,
  }));

  const abilitiesOptions = ABILITY_OPTIONS.map((ability) => ({
    value: ability.value,
    label: ability.label,
  }));

  const armorOptions = Object.entries(ARMOR_PROF_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  const weaponOptions = Object.entries(WEAPON_PROF_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  const toolsOptions = Object.entries(TOOLS_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  const languageOptions = LANGUAGE_TYPES.map((language) => ({
    value: language,
    label: language,
  }));

  const conditionOptions = CONDITIONS.map((condition) => ({
    value: condition.key,
    label: condition.nameRu,
  }));
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Повышение характеристик -->
    <FormSection
      v-if="!hideAbilityScoreIncrease"
      :title="FEAT_GRANTS_LABELS.asiTitle"
      title-color="healing"
    >
      <div class="grid grid-cols-3 gap-2">
        <UFormField
          v-for="ability in abilitiesOptions"
          :key="ability.value"
          :label="ability.label"
        >
          <UInputNumber
            v-model="grants.asiFixed[ability.value]"
            :min="0"
            :max="10"
            class="w-full"
          />
        </UFormField>
      </div>

      <div class="mt-3 flex flex-col gap-2">
        <p class="text-xs text-dimmed">
          {{ FEAT_GRANTS_LABELS.asiChoiceHint }}
        </p>

        <div class="flex items-start gap-2">
          <UFormField
            :label="FEAT_GRANTS_LABELS.asiChoiceAmount"
            class="w-1/4"
          >
            <UInputNumber
              v-model="grants.asiChoiceAmount"
              :min="0"
              :max="5"
            />
          </UFormField>

          <UFormField
            :label="GRANT_FIELD_LABELS.choiceCount"
            class="w-1/4"
          >
            <UInputNumber
              v-model="grants.asiChoiceCount"
              :min="0"
              :max="6"
            />
          </UFormField>

          <UFormField
            :label="FEAT_GRANTS_LABELS.asiChoiceFrom"
            class="flex-1"
          >
            <USelectMenu
              v-model="grants.asiChoiceFrom"
              :items="abilitiesOptions"
              value-key="value"
              label-key="label"
              multiple
              :disabled="grants.asiChoiceCount === 0"
              class="w-full"
              :placeholder="FEAT_GRANTS_LABELS.asiChoiceFromPlaceholder"
            />
          </UFormField>
        </div>
      </div>
    </FormSection>

    <!-- Владения -->
    <FormSection
      :title="GRANT_SECTION_LABELS.proficiencies"
      title-color="healing"
    >
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UFormField
          v-if="!hideSkillProficiencies"
          :label="GRANT_SECTION_LABELS.skills"
        >
          <USelectMenu
            v-model="grants.skillProficiencies"
            :items="skillsOptions"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
            :placeholder="FEAT_GRANTS_LABELS.skillsPlaceholder"
          />
        </UFormField>

        <UFormField :label="GRANT_SECTION_LABELS.savingThrows">
          <USelectMenu
            v-model="grants.savingThrowProficiencies"
            :items="abilitiesOptions"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
            :placeholder="GRANT_FIELD_LABELS.abilitiesPlaceholder"
          />
        </UFormField>

        <UFormField :label="GRANT_SECTION_LABELS.armor">
          <USelectMenu
            v-model="grants.armorProficiencies"
            :items="armorOptions"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
            :placeholder="FEAT_GRANTS_LABELS.armorPlaceholder"
          />
        </UFormField>

        <UFormField :label="GRANT_SECTION_LABELS.weapons">
          <USelectMenu
            v-model="grants.weaponProficiencies"
            :items="weaponOptions"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
            :placeholder="FEAT_GRANTS_LABELS.weaponsPlaceholder"
          />
        </UFormField>

        <UFormField :label="GRANT_SECTION_LABELS.tools">
          <USelectMenu
            v-model="grants.toolProficiencies"
            :items="toolsOptions"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
            :placeholder="FEAT_GRANTS_LABELS.toolsPlaceholder"
          />
        </UFormField>

        <UFormField :label="GRANT_SECTION_LABELS.languages">
          <USelectMenu
            v-model="grants.languages"
            :items="languageOptions"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
            :placeholder="FEAT_GRANTS_LABELS.languagesPlaceholder"
          />
        </UFormField>
      </div>
    </FormSection>

    <!-- Защиты -->
    <FormSection
      :title="FEAT_GRANTS_LABELS.defensesTitle"
      title-color="healing"
    >
      <div class="flex flex-col gap-4">
        <UFormField :label="FEAT_GRANTS_LABELS.damageDefenses">
          <DamageDefenseEditor v-model="grants.damageDefenses" />
        </UFormField>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UFormField :label="GRANT_FIELD_LABELS.conditionImmunities">
            <USelectMenu
              v-model="grants.conditionImmunities"
              :items="conditionOptions"
              value-key="value"
              label-key="label"
              multiple
              class="w-full"
              :placeholder="GRANT_FIELD_LABELS.conditionsPlaceholder"
            />
          </UFormField>

          <UFormField :label="GRANT_FIELD_LABELS.darkvision">
            <UInputNumber
              v-model="grants.darkvision"
              :min="0"
              :max="300"
              :step="30"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>
    </FormSection>

    <!-- Предусловия -->
    <FormSection
      :title="FEAT_GRANTS_LABELS.prerequisitesTitle"
      title-color="source"
    >
      <p class="mb-2 text-xs text-dimmed">
        {{ FEAT_GRANTS_LABELS.prerequisitesHint }}
      </p>

      <div class="grid grid-cols-3 gap-2">
        <UFormField
          v-for="ability in abilitiesOptions"
          :key="ability.value"
          :label="ability.label"
        >
          <UInputNumber
            v-model="grants.prerequisiteAbilities[ability.value]"
            :min="0"
            :max="20"
            class="w-full"
          />
        </UFormField>
      </div>

      <div class="mt-3 flex flex-col gap-3">
        <div class="flex items-center gap-4">
          <UFormField
            :label="FEAT_GRANTS_LABELS.prerequisiteMinLevel"
            class="w-1/3"
          >
            <UInputNumber
              v-model="grants.prerequisiteMinLevel"
              :min="0"
              :max="20"
            />
          </UFormField>

          <UCheckbox
            v-model="grants.prerequisiteSpellcasting"
            :label="FEAT_GRANTS_LABELS.prerequisiteSpellcasting"
            class="mt-5"
          />
        </div>

        <UFormField :label="FEAT_GRANTS_LABELS.prerequisiteText">
          <UInput
            v-model="grants.prerequisiteText"
            :placeholder="FEAT_GRANTS_LABELS.prerequisiteTextPlaceholder"
            class="w-full"
          />
        </UFormField>
      </div>
    </FormSection>
  </div>
</template>
