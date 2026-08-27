import type { DefensibleDamageType } from '@vtt/shared';
import type {
  ActiveEffect,
  ActorSpeciesEntry,
  ConditionKey,
  CreatureSize,
  DamageDefenseEntry,
  DamageDefenseKind,
  DnDActor,
  EffectFlagKey,
  FeatChoice,
  GrantedSpellSource,
  ResolvedGrantedSpell,
  SpeciesDefinition,
  SpeciesFeatDataSource,
  SpeciesFeature,
} from '@vtt/shared/system/dnd.js';

import { computed, ref, watch } from 'vue';

import {
  appendGrantedSpells,
  applyFeatChoiceSelections,
  applyFeatDataProficiencies,
  buildFeatGrantEffect,
  calculateProficiencyBonus,
  collectSpeciesFeatDataSources,
  collectSpeciesGrantedSpellSources,
  collectSubspecies,
  computeSpeciesDarkvision,
  computeSpeciesMovement,
  CREATURE_SIZE_TO_TOKEN_SCALE,
  EFFECT_FLAG_LABELS,
  getConditionEntry,
  getTotalLevel,
  getVisibleFeatChoices,
  isSkillType,
  prepareFeatChoices,
  resolveChosenAbilities,
  resolveChosenDamageDefenses,
  resolveFeatChoiceCount,
  resolveSpeciesVision,
} from '@vtt/shared/system/dnd.js';

import {
  SPECIES_GRANT_EFFECT_PRESENTATION,
  SPECIES_WIZARD_LABELS,
} from '../constants';
import {
  isSpeciesProvidedEffect,
  rollbackSpeciesFeatures,
  rollbackSpeciesGrantedSpells,
  rollbackSpeciesProficiencies,
  SPECIES_DEFENSE_EFFECT_PREFIX,
  SPECIES_GRANT_EFFECT_PREFIX,
  SPECIES_OWN_EFFECT_PREFIX,
} from './speciesRollback';

export interface SpeciesWizardState {
  selectedSize: CreatureSize | null;
  grantSelections: Record<number, string[]>;
  featureChoices: Record<string, string>;
  /** Ключ выбранной записи-подвида; `null` — не выбрана или подвидов нет. */
  subspeciesKey: string | null;
  /** Ответы на выборы блоков даров: ключ источника → ответы блока. */
  featDataChoices: Record<string, Record<string, string[]>>;
}

/** Источник блока даров вместе с подготовленными вопросами к игроку. */
export interface SpeciesFeatDataSourceView extends SpeciesFeatDataSource {
  /** Вопросы блока в порядке показа (`prepareFeatChoices`). */
  preparedChoices: FeatChoice[];
}

/**
 * Собирает флаги защит от урона (`resistance.*`/`immunity.*`/`vulnerability.*`)
 * из гранта `damageDefense` основного вида, из защит выбранных легаси-вариантов
 * (`SpeciesFeatureChoice.damageDefenses` — как наследие драконорождённых) и из
 * легаси-грантов записи-подвида. Дедуп по типу урона: для типа берётся
 * последний заданный вид защиты (один тип = один вид), причём подвид может
 * переопределить защиту основного вида.
 *
 * @param definition - определение вида
 * @param chosenSubspecies - выбранные ключи легаси-вариантов
 * @param subspecies - выбранная запись-подвид; пусто — не выбрана
 */
function collectDamageDefenseFlags(
  definition: SpeciesDefinition,
  chosenSubspecies: ReadonlyArray<string>,
  subspecies?: SpeciesDefinition | null,
): EffectFlagKey[] {
  const kindByType = new Map<DefensibleDamageType, DamageDefenseKind>();

  const addEntries = (entries: DamageDefenseEntry[] | undefined): void => {
    for (const entry of entries ?? []) {
      kindByType.set(entry.damageType, entry.kind);
    }
  };

  for (const grant of definition.grants) {
    if (grant.type === 'damageDefense') {
      addEntries(grant.entries);
    }
  }

  for (const feature of definition.features) {
    for (const choice of feature.choices ?? []) {
      if (chosenSubspecies.includes(choice.key)) {
        addEntries(choice.damageDefenses);
      }
    }
  }

  for (const grant of subspecies?.grants ?? []) {
    if (grant.type === 'damageDefense') {
      addEntries(grant.entries);
    }
  }

  const flags: EffectFlagKey[] = [];

  for (const [damageType, kind] of kindByType) {
    flags.push(`${kind}.${damageType}`);
  }

  return flags;
}

/**
 * Собирает ключи состояний, к которым вид даёт иммунитет: грант
 * `conditionImmunity` основного вида, иммунитеты выбранных легаси-вариантов
 * (`SpeciesFeatureChoice.conditionImmunities`) и легаси-гранты записи-подвида.
 * Дедуп по ключу состояния.
 *
 * @param definition - определение вида
 * @param chosenSubspecies - выбранные ключи легаси-вариантов
 * @param subspecies - выбранная запись-подвид; пусто — не выбрана
 */
function collectSpeciesConditionImmunities(
  definition: SpeciesDefinition,
  chosenSubspecies: ReadonlyArray<string>,
  subspecies?: SpeciesDefinition | null,
): ConditionKey[] {
  const conditions = new Set<ConditionKey>();

  const addGrants = (record: SpeciesDefinition): void => {
    for (const grant of record.grants) {
      if (grant.type === 'conditionImmunity') {
        for (const conditionKey of grant.conditions) {
          conditions.add(conditionKey);
        }
      }
    }
  };

  addGrants(definition);

  for (const feature of definition.features) {
    for (const choice of feature.choices ?? []) {
      if (chosenSubspecies.includes(choice.key)) {
        for (const conditionKey of choice.conditionImmunities ?? []) {
          conditions.add(conditionKey);
        }
      }
    }
  }

  if (subspecies) {
    addGrants(subspecies);
  }

  return [...conditions];
}

/**
 * Собирает эффекты, заявленные самим видом и его умениями в компендиуме.
 *
 * Умение отдаёт эффекты, только когда оно уже действует: у умения с уровнем это
 * уровень персонажа, у легаси-варианта — сделанный игроком выбор. Иначе эльф
 * получал бы «Туманный шаг» пятого уровня на первом. Для записи-подвида функция
 * вызывается отдельно — подвид и есть `SpeciesDefinition`.
 *
 * @param definition - определение вида
 * @param chosenSubspecies - выбранные ключи легаси-вариантов
 * @param characterLevel - суммарный уровень персонажа
 * @returns эффекты вида с id, привязанными к ключу вида
 */
function collectSpeciesDeclaredEffects(
  definition: SpeciesDefinition,
  chosenSubspecies: ReadonlyArray<string>,
  characterLevel: number,
): ActiveEffect[] {
  const collected: ActiveEffect[] = [...(definition.activeEffects ?? [])];

  const addFeature = (feature: SpeciesFeature): void => {
    if ((feature.level ?? 1) > characterLevel) {
      return;
    }

    collected.push(...(feature.activeEffects ?? []));

    for (const choice of feature.choices ?? []) {
      if (!chosenSubspecies.includes(choice.key)) {
        continue;
      }

      for (const nested of choice.features ?? []) {
        addFeature(nested);
      }
    }
  };

  for (const feature of definition.features) {
    addFeature(feature);
  }

  return collected.map((effect) => ({
    ...effect,
    id: `${SPECIES_OWN_EFFECT_PREFIX}${definition.key}:${effect.id}`,
    origin: 'feature',
    originId: definition.key,
  }));
}

/**
 * Строит пассивный активный эффект защит вида: флаги защит от урона
 * (`resistance/immunity/vulnerability.*`) и/или иммунитеты к состояниям.
 *
 * @param definition - определение вида (для имени и id-провенанса)
 * @param flags - флаги защит от урона
 * @param conditionImmunities - иммунитеты к состояниям
 */
function buildSpeciesDefenseEffect(
  definition: SpeciesDefinition,
  flags: EffectFlagKey[],
  conditionImmunities: ConditionKey[],
): ActiveEffect {
  const summaryParts: string[] = [];

  for (const flag of flags) {
    summaryParts.push(EFFECT_FLAG_LABELS[flag] ?? flag);
  }

  for (const conditionKey of conditionImmunities) {
    const label = getConditionEntry(conditionKey)?.nameRu ?? conditionKey;

    summaryParts.push(`Иммунитет к состоянию: ${label}`);
  }

  const effect: ActiveEffect = {
    id: `${SPECIES_DEFENSE_EFFECT_PREFIX}${definition.key}`,
    name: `Защиты вида (${definition.name})`,
    description: `${summaryParts.join('; ')}.`,
    disabled: false,
    origin: 'feature',
    originId: definition.key,
    transfer: false,
    duration: { type: 'permanent' },
    changes: [],
    flags,
  };

  if (conditionImmunities.length > 0) {
    effect.conditionImmunities = conditionImmunities;
  }

  return effect;
}

export function useSpeciesWizard(
  actor: import('vue').Ref<DnDActor>,
  speciesDef: import('vue').Ref<SpeciesDefinition | null>,
  speciesRecords: import('vue').Ref<SpeciesDefinition[]>,
) {
  const state = ref<SpeciesWizardState>({
    selectedSize: null,
    grantSelections: {},
    featureChoices: {},
    subspeciesKey: null,
    featDataChoices: {},
  });

  // Инициализация при смене вида
  watch(
    () => speciesDef.value,
    (definition) => {
      if (!definition) {
        state.value = {
          selectedSize: null,
          grantSelections: {},
          featureChoices: {},
          subspeciesKey: null,
          featDataChoices: {},
        };

        return;
      }

      // 1. Инициализация grantSelections массивами нужной длины или пустыми
      const grantSelections: Record<number, string[]> = {};

      definition.grants.forEach((grant, index) => {
        if ('count' in grant || ('choices' in grant && grant.choices?.count)) {
          grantSelections[index] = [];
        }
      });

      state.value = {
        selectedSize: definition.size.length === 1 ? definition.size[0] : null,
        grantSelections,
        featureChoices: {},
        subspeciesKey: null,
        featDataChoices: {},
      };
    },
    { immediate: true },
  );

  /** Записи-подвиды выбранного вида (мир + компендиум), по алфавиту. */
  const subspeciesOptions = computed<SpeciesDefinition[]>(() => {
    if (!speciesDef.value) {
      return [];
    }

    return collectSubspecies(speciesDef.value.key, speciesRecords.value);
  });

  /** Выбранная запись-подвид; `null` — не выбрана. */
  const selectedSubspecies = computed<SpeciesDefinition | null>(
    () =>
      subspeciesOptions.value.find(
        (option) => option.key === state.value.subspeciesKey,
      ) ?? null,
  );

  const totalLevel = computed(() => getTotalLevel(actor.value.system.classes));

  /** Бонус мастерства — от него зависит количество у некоторых выборов даров. */
  const proficiencyBonus = computed(() =>
    calculateProficiencyBonus(totalLevel.value),
  );

  /**
   * Источники блоков даров `featData` (запись, подвид, активные особенности) с
   * подготовленными вопросами. Вопросы у каждого источника свои — ключи выборов
   * двух особенностей могут совпадать, и общий список их бы склеил.
   */
  const featDataSources = computed<SpeciesFeatDataSourceView[]>(() => {
    if (!speciesDef.value) {
      return [];
    }

    return collectSpeciesFeatDataSources(
      speciesDef.value,
      totalLevel.value,
      Object.values(state.value.featureChoices),
      selectedSubspecies.value,
    ).map((source) => ({
      ...source,
      preparedChoices: prepareFeatChoices(source.featData.choices),
    }));
  });

  /** Отвечены ли все видимые вопросы всех блоков даров. */
  const areFeatDataChoicesComplete = computed(() =>
    featDataSources.value.every((source) => {
      const answers = state.value.featDataChoices[source.sourceKey];

      return getVisibleFeatChoices(source.preparedChoices, answers).every(
        (choice) =>
          (answers?.[choice.key] ?? []).length
          >= resolveFeatChoiceCount(choice, proficiencyBonus.value),
      );
    }),
  );

  const steps = computed(() => {
    if (!speciesDef.value) {
      return [];
    }

    const result = [{ key: 'overview', title: 'Обзор' }];

    if (subspeciesOptions.value.length > 0) {
      result.push({
        key: 'subspecies',
        title: SPECIES_WIZARD_LABELS.stepSubspecies,
      });
    }

    // Есть ли гранты с выбором?
    const hasGrantChoices = speciesDef.value.grants.some((grant) => {
      if (grant.type === 'skillProficiency' && grant.count > 0) {
        return true;
      }

      if (grant.type === 'weaponProficiency' && grant.choices) {
        return true;
      }

      if (grant.type === 'armorProficiency' && grant.choices) {
        return true;
      }

      if (grant.type === 'toolProficiency' && grant.choices) {
        return true;
      }

      if (grant.type === 'language' && grant.choices) {
        return true;
      }

      return false;
    });

    if (hasGrantChoices) {
      result.push({ key: 'grants', title: 'Владения' });
    }

    const hasFeatures =
      speciesDef.value.features.length > 0 || featDataSources.value.length > 0;

    if (hasFeatures) {
      result.push({ key: 'features', title: 'Особенности' });
    }

    return result;
  });

  const currentStepIndex = ref(0);

  const currentStep = computed(() => {
    if (steps.value.length === 0) {
      return null;
    }

    return steps.value[currentStepIndex.value];
  });

  function nextStep() {
    if (currentStepIndex.value < steps.value.length - 1) {
      currentStepIndex.value++;
    }
  }

  function prevStep() {
    if (currentStepIndex.value > 0) {
      currentStepIndex.value--;
    }
  }

  const canProceed = computed(() => {
    if (!speciesDef.value || !currentStep.value) {
      return false;
    }

    const stepKey = currentStep.value.key;

    if (stepKey === 'overview') {
      return state.value.selectedSize !== null;
    }

    if (stepKey === 'subspecies') {
      return state.value.subspeciesKey !== null;
    }

    if (stepKey === 'grants') {
      return speciesDef.value.grants.every((grant, index) => {
        if (grant.type === 'skillProficiency' && grant.count > 0) {
          return state.value.grantSelections[index]?.length === grant.count;
        }

        if ('choices' in grant && grant.choices) {
          return (
            state.value.grantSelections[index]?.length === grant.choices.count
          );
        }

        return true;
      });
    }

    if (stepKey === 'features') {
      const featuresWithChoices = speciesDef.value.features.filter(
        (feature) => feature.choices && feature.choices.length > 0,
      );

      const legacyChoicesAnswered = featuresWithChoices.every(
        (feature) => !!state.value.featureChoices[feature.key],
      );

      return legacyChoicesAnswered && areFeatDataChoicesComplete.value;
    }

    return true;
  });

  const isFinalStep = computed(() => {
    return currentStepIndex.value === steps.value.length - 1;
  });

  /**
   * Заклинания, автоматически предоставляемые особенностями вида
   * (поле `grantedSpells` особенности) — включая особенности записи-подвида.
   */
  const grantedSpellSources = computed((): GrantedSpellSource[] => {
    if (!speciesDef.value) {
      return [];
    }

    return collectSpeciesGrantedSpellSources(
      speciesDef.value,
      selectedSubspecies.value,
    );
  });

  /**
   * Собирает обновления для применения нового вида.
   * Если у актора уже есть вид — откатывает все его бонусы
   * (владения, features, darkvision, granted-заклинания)
   * перед применением нового.
   *
   * @param previousSpeciesDef - определение предыдущего вида (для отката фиксированных грантов)
   * @param resolvedGrantedSpells - granted-заклинания особенностей вида,
   * сопоставленные с данными компендиума
   * @param previousSubspeciesDef - определение предыдущего подвида-записи
   */
  function buildUpdates(
    previousSpeciesDef?: SpeciesDefinition | null,
    resolvedGrantedSpells: ResolvedGrantedSpell[] = [],
    previousSubspeciesDef?: SpeciesDefinition | null,
  ): {
    systemUpdates: Partial<DnDActor['system']>;
    rootUpdates: Partial<DnDActor>;
  } {
    if (!speciesDef.value || !state.value.selectedSize) {
      return { systemUpdates: {}, rootUpdates: {} };
    }

    const definition = speciesDef.value;
    const subspecies = selectedSubspecies.value;
    const previousSpecies = actor.value.system.species;

    const grantChoices: Record<number, string[]> = {};

    Object.entries(state.value.grantSelections).forEach(([key, value]) => {
      grantChoices[Number(key)] = [...value];
    });

    const speciesEntry: ActorSpeciesEntry = {
      speciesKey: definition.key,
      speciesName: definition.name,
      creatureType: definition.creatureType,
      size: state.value.selectedSize,
      featureChoices: { ...state.value.featureChoices },
      grantChoices,
    };

    if (subspecies) {
      speciesEntry.subspeciesKey = subspecies.key;
      speciesEntry.subspeciesName = subspecies.name;
    }

    if (Object.keys(state.value.featDataChoices).length > 0) {
      speciesEntry.featDataChoices = JSON.parse(
        JSON.stringify(state.value.featDataChoices),
      );
    }

    // Уровне-зависимые дары: скорость и тёмное зрение считаются от текущего
    // суммарного уровня персонажа и выбранного подвида.
    const chosenSubspecies = Object.values(state.value.featureChoices);
    const characterLevel = totalLevel.value;

    // --- Откат предыдущего вида ---
    const baseProficiencies = rollbackSpeciesProficiencies(
      actor.value.system.proficiencies,
      previousSpecies,
      previousSpeciesDef,
      previousSubspeciesDef,
      characterLevel,
    );

    const speciesMovement = computeSpeciesMovement(
      definition,
      characterLevel,
      chosenSubspecies,
      subspecies,
    );

    const systemUpdates: Partial<DnDActor['system']> = {
      species: speciesEntry,
      size: state.value.selectedSize,
      movement: {
        ...speciesMovement,
        hover: false, // by default false
        units: 'ft',
      },
      proficiencies: baseProficiencies,
    };

    const tokenUpdates: Partial<DnDActor['token']> = JSON.parse(
      JSON.stringify(actor.value.token || {}),
    );

    if (!tokenUpdates!.vision) {
      tokenUpdates!.vision = {
        enabled: true,
        range: 60,
        darkvision: 0,
        angle: 360,
      };
    }

    // При СМЕНЕ вида сбрасываем прежнее тёмное зрение ТОЛЬКО если оно совпадает
    // с вкладом предыдущего вида — иначе затёрли бы тёмное зрение из других
    // источников (класс/предмет/ручная правка). Полного учёта источников нет
    // (нет провенанса) — это известное ограничение.
    if (previousSpecies) {
      const previousSpeciesDarkvision = previousSpeciesDef
        ? computeSpeciesDarkvision(
            previousSpeciesDef,
            characterLevel,
            Object.values(previousSpecies.featureChoices ?? {}),
            previousSubspeciesDef,
          )
        : tokenUpdates!.vision!.darkvision;

      if (tokenUpdates!.vision!.darkvision === previousSpeciesDarkvision) {
        tokenUpdates!.vision!.darkvision = 0;
      }
    }

    // Итоговое тёмное зрение вида (база + подвид + активные на уровне
    // особенности, включая featData) — максимум с уже имеющимся значением.
    const speciesDarkvision = computeSpeciesDarkvision(
      definition,
      characterLevel,
      chosenSubspecies,
      subspecies,
    );

    if (speciesDarkvision > tokenUpdates!.vision!.darkvision) {
      tokenUpdates!.vision!.darkvision = speciesDarkvision;
    }

    // Обычное зрение вида — дальность зрения токена днём; не задано — токен
    // остаётся со своей
    const speciesVision = resolveSpeciesVision(definition, subspecies);

    if (speciesVision !== undefined) {
      tokenUpdates!.vision!.range = speciesVision;
    }

    tokenUpdates!.scale =
      CREATURE_SIZE_TO_TOKEN_SCALE[state.value.selectedSize];

    // --- Применяем легаси-гранты нового вида ---
    definition.grants.forEach((grant, index) => {
      const userChoices = state.value.grantSelections[index] || [];

      if (grant.type === 'skillProficiency') {
        userChoices.forEach((choice) => {
          if (isSkillType(choice)) {
            systemUpdates.proficiencies!.skills[choice] = 'proficient';
          }
        });
      } else if (grant.type === 'weaponProficiency') {
        grant.items?.forEach((item) => {
          if (!systemUpdates.proficiencies!.weapons.includes(item)) {
            systemUpdates.proficiencies!.weapons.push(item);
          }
        });

        userChoices.forEach((choice) => {
          if (!systemUpdates.proficiencies!.weapons.includes(choice)) {
            systemUpdates.proficiencies!.weapons.push(choice);
          }
        });
      } else if (grant.type === 'armorProficiency') {
        grant.items?.forEach((item) => {
          if (!systemUpdates.proficiencies!.armor.includes(item)) {
            systemUpdates.proficiencies!.armor.push(item);
          }
        });

        userChoices.forEach((choice) => {
          if (!systemUpdates.proficiencies!.armor.includes(choice)) {
            systemUpdates.proficiencies!.armor.push(choice);
          }
        });
      } else if (grant.type === 'toolProficiency') {
        grant.items?.forEach((item) => {
          if (!systemUpdates.proficiencies!.tools.includes(item)) {
            systemUpdates.proficiencies!.tools.push(item);
          }
        });

        userChoices.forEach((choice) => {
          if (!systemUpdates.proficiencies!.tools.includes(choice)) {
            systemUpdates.proficiencies!.tools.push(choice);
          }
        });
      } else if (grant.type === 'language') {
        grant.items?.forEach((item) => {
          if (!systemUpdates.proficiencies!.languages.includes(item)) {
            systemUpdates.proficiencies!.languages.push(item);
          }
        });

        userChoices.forEach((choice) => {
          if (!systemUpdates.proficiencies!.languages.includes(choice)) {
            systemUpdates.proficiencies!.languages.push(choice);
          }
        });
      } else if (grant.type === 'savingThrowProficiency') {
        grant.abilities.forEach((ability) => {
          if (!systemUpdates.proficiencies!.savingThrows.includes(ability)) {
            systemUpdates.proficiencies!.savingThrows.push(ability);
          }
        });
      }
      // darkvision — применяется через computeSpeciesDarkvision (с учётом уровня).
      // resistance — пока без поддержки в proficiencies.
    });

    // --- Применяем блоки даров featData: владения без выбора и ответы игрока ---
    for (const source of featDataSources.value) {
      applyFeatDataProficiencies(systemUpdates.proficiencies!, source.featData);

      applyFeatChoiceSelections(
        systemUpdates.proficiencies!,
        source.featData,
        state.value.featDataChoices[source.sourceKey],
        actor.value,
      );
    }

    const rootUpdates: Partial<DnDActor> = {
      token: tokenUpdates,
    };

    // --- Удаляем старые видовые features и добавляем новые ---
    let newFeatures = [...(actor.value.features || [])];

    // Удаляем features от предыдущего вида
    if (previousSpecies) {
      newFeatures = rollbackSpeciesFeatures(newFeatures);
    }

    /**
     * Добавляет видовую особенность в список актёра (без дублей по названию).
     * Уровень НЕ фильтруем: храним все, лист показывает по достижении уровня.
     *
     * @param featureName - итоговое название особенности
     * @param description - итоговое описание (Markdown)
     * @param level - уровень появления особенности
     * @param grantedBy - название записи-источника (вид либо подвид)
     */
    const pushSpeciesFeature = (
      featureName: string,
      description: string,
      level: number,
      grantedBy: string = definition.name,
    ): void => {
      if (
        newFeatures.some(
          (existing) =>
            existing.grantedBy === grantedBy && existing.name === featureName,
        )
      ) {
        return;
      }

      newFeatures.push({
        id: Math.random().toString(36).substring(2, 11),
        name: featureName,
        description,
        grantedBy,
        featureType: 'species',
        level,
      });
    };

    const resolvedSpellIds = new Set(
      resolvedGrantedSpells.map((resolved) => resolved.spell.id),
    );

    /**
     * Дописывает в описание блок заклинаний особенности: связанные и найденные
     * (или просто именованные) — как выдаваемые; связанные, но не найденные в
     * компендиуме — как требующие ручного добавления.
     *
     * @param feature - особенность вида
     * @returns описание с приписанным блоком заклинаний (если есть)
     */
    const describeGrantedSpells = (feature: SpeciesFeature): string => {
      const refs = feature.grantedSpells ?? [];

      if (refs.length === 0) {
        return feature.description;
      }

      const granted: string[] = [];
      const missing: string[] = [];

      for (const spellRef of refs) {
        if (spellRef.spellId && !resolvedSpellIds.has(spellRef.spellId)) {
          missing.push(spellRef.name);
        } else {
          granted.push(spellRef.name);
        }
      }

      let description = feature.description;

      if (granted.length > 0) {
        description += `\n\n**Заклинания:** ${granted.join(', ')}`;
      }

      if (missing.length > 0) {
        description += `\n\n⚠ **Не найдены в компендиуме (добавьте вручную):** ${missing.join(', ')}`;
      }

      return description;
    };

    // Имена применённых особенностей — чтобы выдать заклинания только от них
    // (не от невыбранных подвидов): сверяем с источником granted-заклинаний.
    const appliedFeatureNames = new Set<string>();

    definition.features.forEach((speciesFeature) => {
      const selectedChoice = speciesFeature.choices?.find(
        (featureChoice) =>
          featureChoice.key === state.value.featureChoices[speciesFeature.key],
      );

      // Базовая особенность вида (если не чисто информационная)
      if (!speciesFeature.isInformationalOnly) {
        let description = describeGrantedSpells(speciesFeature);
        let finalName = speciesFeature.name;

        if (selectedChoice) {
          finalName = `${speciesFeature.name}: ${selectedChoice.name}`;
          description += `\n\n**Выбранный вариант:** ${selectedChoice.name}\n${selectedChoice.description}`;
        }

        pushSpeciesFeature(finalName, description, speciesFeature.level ?? 1);
        appliedFeatureNames.add(speciesFeature.name);
      }

      // Особенности выбранного легаси-варианта — со своими уровнями появления.
      for (const subspeciesFeature of selectedChoice?.features ?? []) {
        if (subspeciesFeature.isInformationalOnly) {
          continue;
        }

        pushSpeciesFeature(
          subspeciesFeature.name,
          describeGrantedSpells(subspeciesFeature),
          subspeciesFeature.level ?? 1,
        );

        appliedFeatureNames.add(subspeciesFeature.name);
      }
    });

    // Особенности записи-подвида — своей записью-источником.
    if (subspecies) {
      for (const subspeciesFeature of subspecies.features) {
        if (subspeciesFeature.isInformationalOnly) {
          continue;
        }

        pushSpeciesFeature(
          subspeciesFeature.name,
          describeGrantedSpells(subspeciesFeature),
          subspeciesFeature.level ?? 1,
          subspecies.name,
        );

        appliedFeatureNames.add(subspeciesFeature.name);
      }
    }

    rootUpdates.features = newFeatures;

    // --- Granted-заклинания: откатываем от предыдущего вида и добавляем новые ---
    const originalSpells = actor.value.spells ?? [];

    let updatedSpells = [...originalSpells];

    if (previousSpecies && previousSpeciesDef) {
      updatedSpells = rollbackSpeciesGrantedSpells(
        updatedSpells,
        previousSpeciesDef,
        previousSubspeciesDef,
      );
    }

    // Выдаём только заклинания от применённых особенностей (выбранных подвидов).
    const applicableGrantedSpells = resolvedGrantedSpells.filter((resolved) =>
      appliedFeatureNames.has(resolved.featureName),
    );

    updatedSpells = appendGrantedSpells(updatedSpells, applicableGrantedSpells);

    // Сравнение по длине недостаточно: удаление и добавление могут совпасть
    // по количеству, поэтому дополнительно сверяем ссылки поэлементно
    const spellsChanged =
      updatedSpells.length !== originalSpells.length
      || updatedSpells.some((spell, index) => spell !== originalSpells[index]);

    if (spellsChanged) {
      rootUpdates.spells = updatedSpells;
    }

    // --- Защиты вида: применяются актёру как пассивный активный эффект
    // (у актёров нет system.defenses). Защиты от урона — через флаги
    // resistance/immunity/vulnerability.*, иммунитеты к состояниям — через
    // поле conditionImmunities. Эффект помечен стабильным id-префиксом, что
    // позволяет снять прежний при смене/удалении вида, не задевая эффекты из
    // других источников. ---
    const damageDefenseFlags = collectDamageDefenseFlags(
      definition,
      chosenSubspecies,
      subspecies,
    );

    const speciesConditionImmunities = collectSpeciesConditionImmunities(
      definition,
      chosenSubspecies,
      subspecies,
    );

    const baseEffects = (actor.value.activeEffects ?? []).filter(
      (effect) => !isSpeciesProvidedEffect(effect),
    );

    const hasDefenses =
      damageDefenseFlags.length > 0 || speciesConditionImmunities.length > 0;

    // --- Синтетические эффекты блоков даров featData: модификаторы листа,
    // защиты (включая выбранные игроком), прибавки. Id стабилен по источнику —
    // по префиксу эффект снимается при смене/удалении вида. ---
    const grantEffects: ActiveEffect[] = [];

    for (const source of featDataSources.value) {
      const answers = state.value.featDataChoices[source.sourceKey];

      const grantEffect = buildFeatGrantEffect(
        source.sourceKey,
        source.sourceName,
        source.featData,
        {
          originPrefix: SPECIES_GRANT_EFFECT_PREFIX,
          ...SPECIES_GRANT_EFFECT_PRESENTATION,
        },
        {
          acquisitionLevel: characterLevel,
          walkSpeed: speciesMovement.walk,
          chosenDamageDefenses: resolveChosenDamageDefenses(
            source.featData,
            answers,
          ),
          chosenAbilities: resolveChosenAbilities(source.featData, answers),
        },
      );

      if (grantEffect) {
        grantEffects.push({
          ...grantEffect,
          id: `${SPECIES_GRANT_EFFECT_PREFIX}${source.sourceKey}`,
        });
      }
    }

    const updatedEffects = [
      ...baseEffects,
      ...(hasDefenses
        ? [
            buildSpeciesDefenseEffect(
              definition,
              damageDefenseFlags,
              speciesConditionImmunities,
            ),
          ]
        : []),
      ...collectSpeciesDeclaredEffects(
        definition,
        chosenSubspecies,
        characterLevel,
      ),
      ...(subspecies
        ? collectSpeciesDeclaredEffects(subspecies, [], characterLevel)
        : []),
      ...grantEffects,
    ];

    const originalEffects = actor.value.activeEffects ?? [];

    const effectsChanged =
      updatedEffects.length !== originalEffects.length
      || updatedEffects.some(
        (effect, index) => effect !== originalEffects[index],
      );

    if (effectsChanged) {
      rootUpdates.activeEffects = updatedEffects;
    }

    return { systemUpdates, rootUpdates };
  }

  return {
    state,
    steps,
    currentStepIndex,
    currentStep,
    nextStep,
    prevStep,
    canProceed,
    isFinalStep,
    grantedSpellSources,
    subspeciesOptions,
    selectedSubspecies,
    featDataSources,
    proficiencyBonus,
    buildUpdates,
  };
}
