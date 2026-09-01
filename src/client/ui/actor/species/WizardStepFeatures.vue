<script setup lang="ts">
  import type {
    DnDActor,
    ResolvedGrantedSpell,
    SpeciesDefinition,
    SpeciesFeature,
    SpeciesFeatureChoice,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { CompendiumFeat } from '../feat/featApply';
  import type {
    SpeciesFeatDataSourceView,
    SpeciesFeatPick,
    SpeciesWizardState,
  } from './useSpeciesWizard';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { isFeatPickChoice } from '@vtt/shared/system/dnd.js';

  import {
    CHOOSE_VARIANT_PLACEHOLDER,
    GRANTED_SPELL_FEATURE_PREFIX,
    LEVEL_BADGE_SUFFIX,
    SPECIES_FEAT_DEFAULT_EXCLUDED_CATEGORIES,
    SPECIES_WIZARD_LABELS,
  } from '../constants';
  import FeatChoicesFields from '../feat/FeatChoicesFields.vue';
  import WizardFeatPicker from '../feat/WizardFeatPicker.vue';

  const props = defineProps<{
    speciesDefinition: SpeciesDefinition;
    state: SpeciesWizardState;
    /** Granted-заклинания особенностей вида с данными из компендиума */
    grantedSpells: ResolvedGrantedSpell[];
    /** Лист персонажа: по нему сужаются пулы выборов даров */
    actor: DnDActor;
    /** Бонус мастерства — от него зависит количество у некоторых выборов */
    proficiencyBonus: number;
    /** Источники блоков даров featData с подготовленными вопросами */
    featDataSources: SpeciesFeatDataSourceView[];
    /** Заклинания компендиума — пул для выборов заклинаний в дарах */
    featChoiceSpells: ReadonlyArray<Spell>;
    /** Выборы черты в дарах — их спрашивает пикер компендиума */
    featPicks: SpeciesFeatPick[];
    /** Черты компендиума — пул этих выборов */
    featChoiceFeats: ReadonlyArray<CompendiumFeat>;
  }>();

  const emit = defineEmits<{
    'update:state': [value: SpeciesWizardState];
  }>();

  /**
   * Источники с вопросами к игроку и сами вопросы — БЕЗ выбора черты: его
   * спрашивает пикер компендиума ниже, а общие поля выбора показали бы пустой
   * список (пул черт живёт в компендиуме, а не в справочнике правил).
   */
  const sourcesWithChoices = computed(() =>
    props.featDataSources
      .map((source) => ({
        ...source,
        preparedChoices: source.preparedChoices.filter(
          (choice) => !isFeatPickChoice(choice),
        ),
      }))
      .filter((source) => source.preparedChoices.length > 0),
  );

  /**
   * Выбранная черта одного вопроса; `null` — не выбрана.
   *
   * @param pick - вопрос о черте
   */
  function selectedFeatId(pick: SpeciesFeatPick): string | null {
    return (
      props.state.featDataChoices[pick.sourceKey]?.[pick.choice.key]?.[0]
      ?? null
    );
  }

  /**
   * Записывает выбранную черту в ответы её блока даров. Ответы прежней черты
   * при этом стираются: у новой свои вопросы, а чужие ответы выдали бы ей то,
   * чего она не даёт.
   *
   * @param pick - вопрос о черте
   * @param featId - ключ выбранной черты; `null` — выбор снят
   */
  function updateFeatPick(pick: SpeciesFeatPick, featId: string | null): void {
    emit('update:state', {
      ...props.state,
      featDataChoices: {
        ...props.state.featDataChoices,
        [pick.sourceKey]: {
          ...props.state.featDataChoices[pick.sourceKey],
          [pick.choice.key]: featId ? [featId] : [],
        },
      },
      featPickAnswers: { ...props.state.featPickAnswers, [pick.pickKey]: {} },
    });
  }

  /**
   * Записывает ответы на собственные выборы выбранной черты.
   *
   * @param pick - вопрос о черте
   * @param answers - ответы черты: ключ выбора → выбранные значения
   */
  function updateFeatPickAnswers(
    pick: SpeciesFeatPick,
    answers: Record<string, string[]>,
  ): void {
    emit('update:state', {
      ...props.state,
      featPickAnswers: {
        ...props.state.featPickAnswers,
        [pick.pickKey]: answers,
      },
    });
  }

  /**
   * Записывает ответы одного блока даров в состояние мастера.
   *
   * @param sourceKey - ключ источника блока
   * @param answers - ответы блока: ключ выбора → выбранные значения
   */
  function updateFeatDataChoices(
    sourceKey: string,
    answers: Record<string, string[]>,
  ): void {
    emit('update:state', {
      ...props.state,
      featDataChoices: {
        ...props.state.featDataChoices,
        [sourceKey]: answers,
      },
    });
  }

  /**
   * Обновляет выбранный вариант для особенности вида.
   * @param featureKey - ключ особенности
   * @param choiceKey - ключ выбранного варианта
   */
  function selectFeatureChoice(featureKey: string, choiceKey: string) {
    emit('update:state', {
      ...props.state,
      featureChoices: {
        ...props.state.featureChoices,
        [featureKey]: choiceKey,
      },
    });
  }

  /**
   * Возвращает granted-заклинания, предоставляемые указанной особенностью.
   *
   * @param featureName - название особенности вида
   */
  function getGrantedSpellsOfFeature(
    featureName: string,
  ): ResolvedGrantedSpell[] {
    return props.grantedSpells.filter(
      (granted) => granted.featureName === featureName,
    );
  }

  /**
   * Возвращает выбранный вариант (подвид) для особенности, если он выбран.
   *
   * @param feature - особенность вида с вариантами
   */
  function getSelectedChoice(
    feature: SpeciesFeature,
  ): SpeciesFeatureChoice | undefined {
    return feature.choices?.find(
      (option) => option.key === props.state.featureChoices[feature.key],
    );
  }

  /**
   * Опции селекта вариантов (подвидов) для особенности.
   *
   * @param feature - особенность вида с вариантами
   */
  function getFeatureChoiceOptions(
    feature: SpeciesFeature,
  ): { value: string; label: string }[] {
    return (feature.choices ?? []).map((choice) => ({
      value: choice.key,
      label: choice.name,
    }));
  }
</script>

<template>
  <div class="flex flex-col gap-4 p-1">
    <div
      v-for="feature in speciesDefinition.features"
      :key="feature.key"
      class="flex flex-col gap-3 rounded-lg bg-elevated p-4"
    >
      <span class="font-medium text-primary">
        {{ feature.name }}
      </span>

      <ItemDescriptionRenderer :content="feature.description" />

      <!-- Заклинания, автоматически предоставляемые особенностью -->
      <div
        v-if="getGrantedSpellsOfFeature(feature.name).length > 0"
        class="flex flex-wrap gap-1.5"
      >
        <UBadge
          v-for="granted in getGrantedSpellsOfFeature(feature.name)"
          :key="granted.spell.id"
          color="primary"
          variant="subtle"
          size="md"
          class="gap-1.5"
        >
          <UIcon
            name="tabler:lock"
            class="size-3.5 opacity-60"
          />
          {{ granted.spell.name }}

          <span class="text-[10px] opacity-60">
            {{ GRANTED_SPELL_FEATURE_PREFIX }}{{ granted.featureName }}
          </span>
        </UBadge>
      </div>

      <!-- Если есть выбор внутри фичи (например, наследие драконорожденного) -->
      <div
        v-if="feature.choices && feature.choices.length > 0"
        class="mt-2 rounded-lg bg-default/50 p-3"
      >
        <span class="mb-2 block text-xs font-medium text-muted">
          {{ SPECIES_WIZARD_LABELS.chooseFeatureChoice }}
        </span>

        <USelectMenu
          :model-value="state.featureChoices[feature.key]"
          :items="getFeatureChoiceOptions(feature)"
          value-key="value"
          label-key="label"
          :placeholder="CHOOSE_VARIANT_PLACEHOLDER"
          @update:model-value="selectFeatureChoice(feature.key, $event)"
        />

        <template v-if="getSelectedChoice(feature)">
          <div class="mt-3 text-sm text-muted">
            {{ getSelectedChoice(feature)?.description }}
          </div>

          <!-- Что даёт выбранный подвид (со своими уровнями) -->
          <div
            v-if="getSelectedChoice(feature)?.features?.length"
            class="mt-3 flex flex-col gap-2"
          >
            <div
              v-for="subFeature in getSelectedChoice(feature)?.features ?? []"
              :key="subFeature.key"
              class="rounded-md border border-default/40 bg-default/40 p-2"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-healing">
                  {{ subFeature.name }}
                </span>

                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  {{ subFeature.level ?? 1 }}{{ LEVEL_BADGE_SUFFIX }}
                </UBadge>
              </div>

              <ItemDescriptionRenderer
                :content="subFeature.description"
                class="mt-1"
              />
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Выборы блоков даров featData: по блоку на источник — ключи выборов у
      разных особенностей могут совпадать, и общий список их бы склеил -->
    <div
      v-for="source in sourcesWithChoices"
      :key="source.sourceKey"
      class="flex flex-col gap-3 rounded-lg bg-elevated p-4"
    >
      <span class="font-medium text-primary">
        {{ SPECIES_WIZARD_LABELS.featDataChoicesPrefix }}{{ source.sourceName }}
      </span>

      <FeatChoicesFields
        :choices="source.preparedChoices"
        :actor="actor"
        :proficiency-bonus="proficiencyBonus"
        :spells="featChoiceSpells"
        :model-value="state.featDataChoices[source.sourceKey] ?? {}"
        @update:model-value="updateFeatDataChoices(source.sourceKey, $event)"
      />
    </div>

    <!-- Выборы черты: пул берётся из компендиума черт, поэтому у них свой
      пикер, а не общие поля выбора -->
    <div
      v-for="pick in featPicks"
      :key="pick.pickKey"
      class="flex flex-col gap-3 rounded-lg bg-elevated p-4"
    >
      <span class="font-medium text-primary">
        {{ SPECIES_WIZARD_LABELS.featDataChoicesPrefix }}{{ pick.sourceName }}
      </span>

      <WizardFeatPicker
        :choice="pick.choice"
        :feats="featChoiceFeats"
        :actor="actor"
        :excluded-categories="SPECIES_FEAT_DEFAULT_EXCLUDED_CATEGORIES"
        :model-value="selectedFeatId(pick)"
        @update:model-value="updateFeatPick(pick, $event)"
      />

      <!-- Собственные выборы выбранной черты: без них она легла бы на лист
        пустой — у «Одарённого» ни прибавки к характеристике, ни навыка -->
      <FeatChoicesFields
        v-if="pick.ownChoices.length > 0"
        :choices="pick.ownChoices"
        :actor="actor"
        :proficiency-bonus="proficiencyBonus"
        :spells="featChoiceSpells"
        :model-value="state.featPickAnswers[pick.pickKey] ?? {}"
        @update:model-value="updateFeatPickAnswers(pick, $event)"
      />
    </div>
  </div>
</template>
