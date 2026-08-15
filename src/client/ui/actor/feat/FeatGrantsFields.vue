<script setup lang="ts">
  import type { EditableFeatGrants } from './featEditorTypes';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    LANGUAGE_TYPES,
    SELECTABLE_CONDITIONS,
    SENSE_LABELS,
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
  import {
    createEmptyFeatGrants,
    MODIFIER_FLAG_KEYS,
    MODIFIER_NUMBER_KEYS,
    SENSE_KEYS,
    SPEED_MODIFIER_ROWS,
  } from './featEditorTypes';
  import GrantNumberRow from './GrantNumberRow.vue';

  /**
   * Переиспользуемый редактор «даров» черты: повышение характеристик, владения
   * (навыки/спасброски/доспехи/оружие/инструменты/языки), защиты от урона и
   * состояний, постоянные модификаторы листа (скорости, хиты, КД, инициатива),
   * требования. Двусторонняя привязка через {@link EditableFeatGrants} —
   * компонент не знает ни о форме-владельце, ни о сериализации в FeatData.
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
      /**
       * Скрыть секцию «Модификаторы листа» (для предыстории: скорости, хиты и
       * КД предыстория по правилам 2024 не выдаёт).
       */
      hideModifiers?: boolean;
    }>(),
    {
      hideAbilityScoreIncrease: false,
      hideSkillProficiencies: false,
      hideModifiers: false,
    },
  );

  const senseOptions = SENSE_KEYS.map((type) => ({
    type,
    label: SENSE_LABELS[type],
  }));

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

  const conditionOptions = SELECTABLE_CONDITIONS.map((condition) => ({
    value: condition.key,
    label: condition.nameRu,
  }));

  /** Задан ли хоть один модификатор — от этого зависит кнопка сброса. */
  const hasModifiers = computed(
    () =>
      MODIFIER_NUMBER_KEYS.some((key) => grants.value[key] !== 0)
      || MODIFIER_FLAG_KEYS.some((key) => grants.value[key]),
  );

  /**
   * Обнуляет блок модификаторов. Остальные дары (владения, защиты, чувства,
   * предусловия) не трогает: кнопка стоит в шапке своей секции.
   */
  function resetModifiers(): void {
    const empty = createEmptyFeatGrants();
    const next = { ...grants.value };

    for (const key of MODIFIER_NUMBER_KEYS) {
      next[key] = empty[key];
    }

    for (const key of MODIFIER_FLAG_KEYS) {
      next[key] = empty[key];
    }

    grants.value = next;
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Повышение характеристик -->
    <FormSection
      v-if="!hideAbilityScoreIncrease"
      :title="FEAT_GRANTS_LABELS.asiTitle"
      icon="tabler:arrow-big-up-lines"
      :hint="FEAT_GRANTS_LABELS.asiSectionHint"
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
      icon="tabler:certificate"
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
      icon="tabler:shield-check"
      :hint="FEAT_GRANTS_LABELS.defensesSectionHint"
    >
      <div class="flex flex-col gap-4">
        <UFormField :label="FEAT_GRANTS_LABELS.damageDefenses">
          <DamageDefenseEditor v-model="grants.damageDefenses" />
        </UFormField>

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

        <!-- Дистанции чувств: единицы и смысл нуля вынесены в заголовок,
          чтобы подписи строк остались короткими -->
        <div>
          <p class="mb-1 text-xs font-medium text-toned">
            {{ FEAT_GRANTS_LABELS.sensesTitle }}

            <span class="font-normal text-dimmed">
              — {{ FEAT_GRANTS_LABELS.sensesHint }}
            </span>
          </p>

          <GrantNumberRow
            v-model="grants.darkvision"
            :label="FEAT_GRANTS_LABELS.darkvisionShort"
            :max="300"
            :step="30"
          />

          <GrantNumberRow
            v-for="sense in senseOptions"
            :key="sense.type"
            v-model="grants.senses[sense.type]"
            :label="sense.label"
            :max="300"
            :step="10"
          />

          <GrantNumberRow
            v-model="grants.telepathyRange"
            :label="FEAT_GRANTS_LABELS.telepathyRange"
            :max="300"
            :step="30"
          />
        </div>
      </div>
    </FormSection>

    <!-- Модификаторы листа -->
    <FormSection
      v-if="!hideModifiers"
      :title="FEAT_GRANTS_LABELS.modifiersTitle"
      icon="tabler:adjustments"
    >
      <template #actions>
        <UTooltip
          v-if="hasModifiers"
          :text="FEAT_GRANTS_LABELS.modifiersReset"
        >
          <UButton
            icon="tabler:rotate"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :aria-label="FEAT_GRANTS_LABELS.modifiersReset"
            @click.left.exact.prevent="resetModifiers"
          />
        </UTooltip>
      </template>

      <p class="mb-3 text-xs text-dimmed">
        {{ FEAT_GRANTS_LABELS.modifiersHint }}
      </p>

      <div class="flex flex-col gap-4">
        <!-- Передвижение -->
        <div>
          <p class="mb-1 text-xs font-medium text-toned">
            {{ FEAT_GRANTS_LABELS.speedTitle }}
          </p>

          <GrantNumberRow
            v-model="grants.speedWalkBonus"
            :label="FEAT_GRANTS_LABELS.speedWalkBonus"
            :min="-60"
            :max="120"
            :step="5"
          >
            <template #trailing>
              <span class="text-xs text-dimmed">
                {{ FEAT_GRANTS_LABELS.speedWalkHint }}
              </span>
            </template>
          </GrantNumberRow>

          <GrantNumberRow
            v-for="speed in SPEED_MODIFIER_ROWS"
            :key="speed.key"
            v-model="grants[speed.key]"
            :label="speed.label"
            :max="200"
            :step="5"
            :disabled="grants[speed.equalsWalkKey]"
          >
            <template #trailing>
              <UCheckbox
                v-model="grants[speed.equalsWalkKey]"
                :label="speed.equalsWalkLabel"
                size="sm"
              />
            </template>
          </GrantNumberRow>
        </div>

        <!-- Хиты -->
        <div>
          <div class="mb-1 flex items-center gap-1.5">
            <span class="text-xs font-medium text-toned">
              {{ FEAT_GRANTS_LABELS.hitPointsTitle }}
            </span>

            <!-- Текст подсказки через слот, а не проп `text`: штатный спан
                 тултипа обрезает текст в одну строку классом `truncate` -->
            <UTooltip :ui="{ content: 'h-auto max-w-72 py-1.5' }">
              <UIcon
                name="tabler:info-circle-filled"
                class="size-3.5 shrink-0 cursor-help text-dimmed transition-colors hover:text-default"
              />

              <template #content>
                <span class="whitespace-normal">
                  {{ FEAT_GRANTS_LABELS.hitPointsHint }}
                </span>
              </template>
            </UTooltip>
          </div>

          <GrantNumberRow
            v-model="grants.hitPointsFlat"
            :label="FEAT_GRANTS_LABELS.hitPointsFlat"
            :min="-20"
            :max="100"
          />

          <GrantNumberRow
            v-model="grants.hitPointsPerAcquisitionLevel"
            :label="FEAT_GRANTS_LABELS.hitPointsPerAcquisitionLevel"
            :max="10"
          />

          <GrantNumberRow
            v-model="grants.hitPointsPerLevelAfterAcquisition"
            :label="FEAT_GRANTS_LABELS.hitPointsPerLevelAfterAcquisition"
            :max="10"
          />
        </div>

        <!-- КД и инициатива -->
        <div>
          <p class="mb-1 text-xs font-medium text-toned">
            {{ FEAT_GRANTS_LABELS.defenceTitle }}
          </p>

          <GrantNumberRow
            v-model="grants.armorClassBonus"
            :label="FEAT_GRANTS_LABELS.armorClassBonus"
            :min="-5"
            :max="10"
            reserve-trailing
          />

          <GrantNumberRow
            v-model="grants.initiativeBonus"
            :label="FEAT_GRANTS_LABELS.initiativeBonus"
            :min="-10"
            :max="20"
          >
            <template #trailing>
              <UCheckbox
                v-model="grants.initiativeProficiencyBonus"
                :label="FEAT_GRANTS_LABELS.initiativeProficiencyBonus"
                size="sm"
              />
            </template>
          </GrantNumberRow>
        </div>
      </div>
    </FormSection>

    <!-- Требования -->
    <FormSection
      :title="FEAT_GRANTS_LABELS.prerequisitesTitle"
      icon="tabler:list-check"
      :hint="FEAT_GRANTS_LABELS.prerequisitesCategoriesHint"
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
