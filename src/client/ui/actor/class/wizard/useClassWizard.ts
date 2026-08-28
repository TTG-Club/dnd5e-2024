/**
 * Composable для управления пошаговым мастером добавления/повышения класса.
 *
 * Формирует список шагов динамически на основе контекста:
 * - Первый класс (1 уровень): все шаги (ХП, Спасброски, Владения, Навыки, Особенности, Заклинания)
 * - Level Up: ХП → Особенности → Заклинания → ASI (если нужен)
 * - Мультикласс: ХП → Владения (сокращённые) → Навыки (если есть) → Особенности → Заклинания
 */

import type { Ref } from 'vue';

import type { AbilityType, ProficiencyLevel, SkillType } from '@vtt/shared';
import type {
  ActiveEffect,
  ClassCounterDefinition,
  ClassDefinition,
  ClassFeature,
  ClassFeatureSkillChoice,
  DnDActor,
  FeatChoice,
  FeatData,
  FormulaContext,
  GrantedSpellSource,
  HitPointMethod,
  ResolvedGrantedSpell,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { AppliedFeatFeature } from '../../feat/featApply';

import { computed, reactive, ref, watch } from 'vue';

import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
import { generateId } from '@vtt/shared';
import {
  ABILITY_LABELS,
  appendGrantedSpells,
  buildCounterFormulaContext,
  buildFeatGrantEffect,
  calculateProficiencyBonus,
  collectFeatChoiceProficiencies,
  collectFeatGrantedSpellSources,
  collectGrantedSpellSourcesForClassLevel,
  COUNTER_FORMULA_TOKENS,
  counterAbilityModifierFormula,
  evaluateCounterMaxFormula,
  expandChoiceScaling,
  getMulticlassProficiencies,
  getTotalLevel,
  getVisibleFeatChoices,
  hasAbilityImprovementAtLevel,
  isAsiFeature,
  isFeatPickChoice,
  normalizeSpellName,
  prepareFeatChoices,
  raiseTokenDarkvision,
  refreshCounterMaxima,
  refreshFeatCounters,
  resolveChosenAbilities,
  resolveChosenDamageDefenses,
  resolveFeatChoiceCount,
  SKILLS_LIST,
  withCounterMinimum,
} from '@vtt/shared/system/dnd.js';

import {
  CLASS_EQUIPMENT_NONE_INDEX,
  CLASS_GRANT_EFFECT_PRESENTATION,
} from '../../constants';
import { applyFeatToActor } from '../../feat/featApply';
import {
  buildClassEffectId,
  collectClassEffects,
  collectFeatureEffects,
  collectSubclassEffects,
  mergeClassEffects,
} from '../classEffects';

// ── Типы ──────────────────────────────────────────────────────

/** Ключ шага мастера */
export type WizardStepKey =
  | 'hitPoints'
  | 'savingThrows'
  | 'proficiencies'
  | 'skills'
  | 'features'
  | 'featureSkills'
  | 'equipment'
  | 'spellcasting'
  | 'asi';

/** Элемент списка шагов для UStepper */
export interface WizardStepItem {
  value: WizardStepKey;
  title: string;
  icon?: string;
  description?: string;
}

/** Состояние шага ХП */
export interface WizardHitPointsState {
  value: number;
  method: HitPointMethod;
}

/** Состояние шага ASI */
export interface WizardAsiState {
  mode: 'asi' | 'feat';
  abilityIncreases: Partial<Record<AbilityType, number>>;
  featKey: string | null;
}

/** Лимиты выбора заклинаний и заговоров */
export interface SpellSelectionLimits {
  /** Количество новых заговоров */
  cantrips: number;
  /** Общее количество новых заклинаний (свободный выбор круга) */
  spells: number;
  /** Покруговые ограничения (если заданы — заменяют spells) */
  spellsByLevel: Record<string, number> | null;
}

/** Полное состояние мастера */
export interface WizardState {
  hitPoints: WizardHitPointsState;
  selectedSkills: SkillType[];
  /**
   * Навыки, выбранные на шаге умения («Эксперт» и подобные). Отдельно от
   * `selectedSkills`: те берут при взятии класса, эти — на уровне умения, и
   * применяются они разными путями.
   */
  selectedFeatureSkills: SkillType[];
  /**
   * Выбранный вариант стартового снаряжения; `null` — не выбран,
   * `CLASS_EQUIPMENT_NONE_INDEX` — выбран явный отказ. Снаряжение берут только
   * при взятии класса на 1 уровне.
   */
  selectedEquipmentIndex: number | null;
  subclassKey: string | null;
  featureChoices: Record<string, string>;
  asi: WizardAsiState;
  /** Заклинания, выбранные на шаге заклинаний */
  selectedSpells: Spell[];
  /**
   * Ключи владений инструментами, разобранные на шаге владений. Определение
   * класса хранит их человекочитаемым текстом, а на лист персонажа уходят
   * ключи словаря — сопоставление делает шаг, здесь лежит его результат.
   */
  toolProficiencies: string[];
  /**
   * Ответы на выборы даров умений уровня по ключу выбора.
   *
   * Отдельно от `featureChoices`: там варианты самого умения («Боевой стиль»),
   * а здесь — выборы даров той же модели, что у черты, и применяет их общий
   * код черты.
   */
  featDataChoices: Record<string, string[]>;
}

/** Особенность класса с указанием источника (базовый класс или подкласс) */
export interface WizardFeatureItem extends ClassFeature {
  sourceName?: string;
  isSubclass?: boolean;
}

/**
 * Черта компендиума с полями, которых базовый тип особенности не знает:
 * категория нужна пикеру, чтобы сузить пул выбора черты умения.
 */
export interface CompendiumFeat extends AppliedFeatFeature {
  /** Категория черты подписью записи компендиума («Боевой стиль») */
  category?: string;
}

/** Выбор черты умения уровня вместе с названием умения-источника */
export interface WizardFeatPick {
  choice: FeatChoice;
  sourceName: string;
}

// ── Константы ─────────────────────────────────────────────────

/** Все шаги с метаданными */
const STEP_DEFINITIONS: Record<WizardStepKey, Omit<WizardStepItem, 'value'>> = {
  hitPoints: { title: 'Очки здоровья' },
  savingThrows: { title: 'Спасброски' },
  proficiencies: { title: 'Владения' },
  skills: { title: 'Навыки' },
  features: { title: 'Особенности' },
  featureSkills: { title: 'Навыки умения' },
  equipment: { title: 'Снаряжение' },
  spellcasting: { title: 'Заклинания' },
  asi: { title: 'Характеристики' },
};

/** Владения актора — то, что дары уровня правят. */
type WizardProficiencies = DnDActor['system']['proficiencies'];

/**
 * Копия владений актора: обновления собираются на копии, а сам актор приходит из
 * листа реактивным объектом — менять его на месте нельзя.
 *
 * @param proficiencies - владения актора
 * @returns независимая копия
 */
function cloneWizardProficiencies(
  proficiencies: WizardProficiencies,
): WizardProficiencies {
  return {
    armor: [...(proficiencies?.armor ?? [])],
    weapons: [...(proficiencies?.weapons ?? [])],
    weaponMasteries: [...(proficiencies?.weaponMasteries ?? [])],
    masteryProperties: [...(proficiencies?.masteryProperties ?? [])],
    tools: [...(proficiencies?.tools ?? [])],
    languages: [...(proficiencies?.languages ?? [])],
    savingThrows: [...(proficiencies?.savingThrows ?? [])],
    skills: { ...(proficiencies?.skills ?? {}) },
  };
}

/**
 * Дописывает значения, которых ещё нет: одно и то же владение из двух умений —
 * это одно владение.
 *
 * @param target - список владений
 * @param values - что дописать
 */
function pushUniqueValues(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

/**
 * Дописывает во владения дары уровня: безусловные — из самих блоков, выбранные
 * игроком — общим разбором ответов черты.
 *
 * Выборы применяются после безусловных даров: выбор, который поднимает владение
 * до компетентности, обязан видеть уже выданное.
 *
 * @param base - владения, к которым дописываются дары
 * @param featData - дары уровня: класса, подкласса и умений
 * @param selections - ответы игрока на выборы даров
 * @returns владения с дарами уровня
 */
function applyLevelFeatData(
  base: WizardProficiencies,
  featData: ReadonlyArray<FeatData>,
  selections: Record<string, string[]>,
): WizardProficiencies {
  const result = cloneWizardProficiencies(base);

  for (const data of featData) {
    for (const skill of data.skillProficiencies ?? []) {
      result.skills[skill] = 'proficient';
    }

    pushUniqueValues(result.weapons, data.weaponProficiencies ?? []);
    pushUniqueValues(result.weaponMasteries, data.weaponMasteries ?? []);

    pushUniqueValues(
      (result.masteryProperties ??= []),
      data.masteryProperties ?? [],
    );

    pushUniqueValues(result.armor, data.armorProficiencies ?? []);
    pushUniqueValues(result.tools, data.toolProficiencies ?? []);
    pushUniqueValues(result.languages, data.languages ?? []);
    pushUniqueValues(result.savingThrows, data.savingThrowProficiencies ?? []);
  }

  for (const data of featData) {
    const chosen = collectFeatChoiceProficiencies(data, selections);

    for (const skill of chosen.skills) {
      result.skills[skill] = 'proficient';
    }

    pushUniqueValues(result.weapons, chosen.weapons);
    pushUniqueValues(result.weaponMasteries, chosen.weaponMasteries);

    pushUniqueValues(
      (result.masteryProperties ??= []),
      chosen.masteryProperties,
    );

    pushUniqueValues(result.armor, chosen.armor);
    pushUniqueValues(result.tools, chosen.tools);
    pushUniqueValues(result.languages, chosen.languages);
    pushUniqueValues(result.savingThrows, chosen.savingThrows);
  }

  return result;
}

// ── Composable ────────────────────────────────────────────────

/**
 * Слова формулы максимума из редактора класса прежних лет: тогда её набирали
 * руками и своими словами, а не выбирали источник списком.
 */
const LEGACY_COUNTER_FORMULAS = {
  level: 'level',
  charismaModifier: 'chaMod',
} as const;

/**
 * Формула максимума счётчика в диалекте листа (`@prof`, `@level`,
 * `@mod.<abbr>`); пустая строка — максимум задан прогрессией по уровням.
 *
 * Компендиум TTG Club пишет формулу сразу в этом диалекте, а класс, собранный
 * в редакторе системы, — своими словами прежних лет (`level`, `chaMod`,
 * `level * 5`). Перевод здесь один на оба случая: считать формулу дальше умеет
 * только движок листа, и второй его разбор разошёлся бы с первым.
 *
 * @param definition - определение счётчика из компендиума
 * @returns формула в диалекте листа; пустая строка — формулы нет
 */
function counterMaxFormulaOf(definition: ClassCounterDefinition): string {
  const formula = definition.formula?.trim();

  if (definition.progression || !formula) {
    return '';
  }

  if (formula === LEGACY_COUNTER_FORMULAS.level) {
    return COUNTER_FORMULA_TOKENS.level;
  }

  if (formula === LEGACY_COUNTER_FORMULAS.charismaModifier) {
    return counterAbilityModifierFormula('charisma');
  }

  const multiplyMatch = /^level\s*\*\s*(\d+)$/.exec(formula);

  return multiplyMatch
    ? `${COUNTER_FORMULA_TOKENS.level} * ${multiplyMatch[1]}`
    : formula;
}

/**
 * Вычисляет максимальное значение счётчика по определению и листу персонажа.
 *
 * Приоритет: прогрессия по уровням старше формулы — ряд, который формулой не
 * пишется, задан ею же и точнее любого выражения. Нижняя граница
 * ({@link ClassCounterDefinition.min}) подпирает результат снизу: вдохновение
 * барда равно модификатору Харизмы, но не меньше одного.
 *
 * @param definition - определение счётчика
 * @param classLevel - уровень персонажа в этом классе
 * @param context - `@`-переменные листа для расчёта формулы
 * @returns максимум зарядов
 */
function computeCounterMax(
  definition: ClassCounterDefinition,
  classLevel: number,
  context: FormulaContext,
): number {
  if (definition.progression) {
    return withCounterMinimum(
      progressionCounterMax(definition.progression, classLevel),
      definition.min,
    );
  }

  const formula = counterMaxFormulaOf(definition);

  return withCounterMinimum(
    formula ? evaluateCounterMaxFormula(formula, context) : 0,
    definition.min,
  );
}

/**
 * Максимум по таблице прогрессии: берётся старшая ступень, до которой персонаж
 * дорос.
 *
 * @param progression - максимум по уровням: ключ — уровень строкой
 * @param classLevel - уровень персонажа в этом классе
 * @returns максимум зарядов; 0 — персонаж не дорос до первой ступени
 */
function progressionCounterMax(
  progression: Record<string, number>,
  classLevel: number,
): number {
  const levelKey = String(classLevel);

  if (progression[levelKey] !== undefined) {
    return progression[levelKey];
  }

  const availableLevels = Object.keys(progression)
    .map(Number)
    .filter((level) => level <= classLevel)
    .sort((levelA, levelB) => levelB - levelA);

  return availableLevels.length > 0
    ? progression[String(availableLevels[0])]
    : 0;
}

/**
 * Composable мастера настройки класса (добавление, мультикласс, повышение уровня).
 *
 * Формирует список шагов на основе контекста актора, хранит состояние выбора
 * (хиты, навыки, особенности, заклинания, ASI) и собирает итоговые обновления
 * актора для применения.
 *
 * @param classDefinition - определение выбранного класса (реактивная ссылка)
 * @param actor - актор, к которому применяется мастер (реактивная ссылка)
 * @param isOpen - флаг открытия модального окна мастера (реактивная ссылка)
 * @returns Набор реактивных значений и методов управления мастером
 */
export function useClassWizard(
  classDefinition: Ref<ClassDefinition | null>,
  actor: Ref<DnDActor>,
  isOpen: Ref<boolean>,
  /**
   * Черты компендиума: из них собирается пул выбора черты умения и берётся
   * сама черта при применении. Пусто — выбирать нечего.
   */
  compendiumFeats: Ref<ReadonlyArray<CompendiumFeat>> = ref<
    ReadonlyArray<CompendiumFeat>
  >([]),
) {
  // ── Контекст ──────────────────────────────────────────────

  /** Это первый класс персонажа (нет ни одного класса) */
  const isFirstClass = computed(() => {
    return (
      !actor.value.system.classes || actor.value.system.classes.length === 0
    );
  });

  /** Это мультикласс (у актора есть классы, и добавляемый класс — новый) */
  const isMulticlass = computed(() => {
    if (!classDefinition.value || isFirstClass.value) {
      return false;
    }

    return !actor.value.system.classes?.some(
      (entry) => entry.classKey === classDefinition.value?.key,
    );
  });

  /** Запись текущего класса на акторе (null если класс новый) */
  const currentClassEntry = computed(() => {
    if (!classDefinition.value) {
      return null;
    }

    return (
      actor.value.system.classes?.find(
        (entry) => entry.classKey === classDefinition.value?.key,
      ) ?? null
    );
  });

  /** Следующий уровень в этом классе */
  const nextLevel = computed(() => {
    return (currentClassEntry.value?.level ?? 0) + 1;
  });

  /** Является ли следующий уровень первым уровнем первого класса (макс хитдайс) */
  const isMaxHitDieLevel = computed(() => {
    return isFirstClass.value && nextLevel.value === 1;
  });

  /** Среднее значение кости хитов */
  const averageHitPoints = computed(() => {
    if (!classDefinition.value) {
      return 0;
    }

    return Math.floor(classDefinition.value.hitDie / 2) + 1;
  });

  // ── Состояние ──────────────────────────────────────────────

  const wizardState = reactive<WizardState>({
    hitPoints: { value: 0, method: 'average' },
    selectedSkills: [],
    selectedFeatureSkills: [],
    selectedEquipmentIndex: null,
    subclassKey: null,
    featureChoices: {},
    asi: {
      mode: 'asi',
      abilityIncreases: {},
      featKey: null,
    },
    selectedSpells: [],
    toolProficiencies: [],
    featDataChoices: {},
  });

  /** Активный ключ подкласса (выбранный ранее или на текущем шаге) */
  const activeSubclassKey = computed((): string | null => {
    return currentClassEntry.value?.subclassKey || wizardState.subclassKey;
  });

  /** Определение активного подкласса */
  const activeSubclass = computed(() => {
    const subKey = activeSubclassKey.value;

    if (!subKey || !classDefinition.value) {
      return null;
    }

    return (
      classDefinition.value.subclasses.find(
        (subclass) => subclass.key === subKey,
      ) ?? null
    );
  });

  /** Особенности, доступные на текущем уровне */
  const levelFeatures = computed((): WizardFeatureItem[] => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const levelEntry = classDef.levelTable.find(
      (row) => row.level === nextLevel.value,
    );

    if (!levelEntry) {
      return [];
    }

    const baseFeatures = levelEntry.featureKeys
      .map((featureKey) =>
        classDef.features.find((feature) => feature.key === featureKey),
      )
      .filter((feature): feature is ClassFeature => feature !== undefined)
      .map((feature) => ({
        ...feature,
        sourceName: classDef.name,
        isSubclass: false,
      }));

    // Добавляем особенности подкласса, если он выбран
    const subclassDef = activeSubclass.value;

    if (subclassDef) {
      const subclassFeatures = subclassDef.features
        .filter((featureEntry) => featureEntry.level === nextLevel.value)
        .map((feature) => ({
          ...feature,
          sourceName: subclassDef.name,
          isSubclass: true,
        }));

      baseFeatures.push(...subclassFeatures);
    }

    return baseFeatures;
  });

  /**
   * Бонус мастерства персонажа после этого уровня: от него зависит количество у
   * выборов вида «столько, сколько бонус мастерства».
   */
  const featChoiceProficiencyBonus = computed(() =>
    calculateProficiencyBonus(getTotalLevel(actor.value.system.classes) + 1),
  );

  /**
   * Выборы умений прошлых уровней, открывающиеся ровно на этом уровне.
   *
   * Отдаются пустыми дарами с одними выборами: умение уже выдано, и повторить
   * его владения и заклинания значило бы выдать их дважды.
   */
  const reopenedFeatData = computed<FeatData[]>(() => {
    const classDef = classDefinition.value;
    const level = nextLevel.value;

    if (!classDef) {
      return [];
    }

    const gainedKeys = new Set(levelFeatures.value.map((entry) => entry.key));

    const features = [
      ...classDef.features,
      ...(activeSubclass.value?.features ?? []),
    ];

    const collected: FeatData[] = [];

    for (const feature of features) {
      if (gainedKeys.has(feature.key) || feature.isInformationalOnly) {
        continue;
      }

      const reopened = expandChoiceScaling(feature.featData?.choices).filter(
        (choice) => choice.requiredLevel === level,
      );

      if (reopened.length) {
        collected.push({ type: 'feat', choices: reopened });
      }
    }

    return collected;
  });

  /**
   * Дары, которые приносит этот уровень: сам класс на первом уровне, выбранный
   * прямо сейчас подкласс и каждое умение уровня.
   *
   * Информационные умения даров не дают: их и в списке умений листа нет.
   */
  const levelFeatData = computed<FeatData[]>(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const collected: FeatData[] = [];

    if (nextLevel.value === 1 && classDef.featData) {
      collected.push(classDef.featData);
    }

    if (wizardState.subclassKey && activeSubclass.value?.featData) {
      collected.push(activeSubclass.value.featData);
    }

    for (const feature of levelFeatures.value) {
      if (!feature.isInformationalOnly && feature.featData) {
        collected.push(openedFeatData(feature.featData, nextLevel.value));
      }
    }

    // Умения прошлых уровней, у которых на этом уровне открывается ещё один
    // вопрос: компетентность плут получает на 1 уровне и снова на 6, а умение
    // в книге одно. Берутся ТОЛЬКО их выборы — остальные дары уже выданы, и
    // повтор выдал бы их дважды
    for (const featData of reopenedFeatData.value) {
      collected.push(featData);
    }

    return collected;
  });

  /**
   * Источники даров уровня с ключами — для синтетических эффектов даров.
   *
   * Параллельно {@link levelFeatData}, но без переоткрытых выборов прошлых
   * уровней: у тех одни вопросы, модификаторов они не несут, и эффект по ним
   * пуст. Ключ источника стабилен — по нему эффект не ставится второй копией
   * при переоткрытии мастера.
   */
  const levelFeatDataSources = computed<
    { sourceKey: string; sourceName: string; featData: FeatData }[]
  >(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const collected: {
      sourceKey: string;
      sourceName: string;
      featData: FeatData;
    }[] = [];

    if (nextLevel.value === 1 && classDef.featData) {
      collected.push({
        sourceKey: classDef.key,
        sourceName: classDef.name,
        featData: classDef.featData,
      });
    }

    if (wizardState.subclassKey && activeSubclass.value?.featData) {
      collected.push({
        sourceKey: activeSubclass.value.key,
        sourceName: activeSubclass.value.name,
        featData: activeSubclass.value.featData,
      });
    }

    for (const feature of levelFeatures.value) {
      if (!feature.isInformationalOnly && feature.featData) {
        collected.push({
          sourceKey: feature.key,
          sourceName: feature.name,
          featData: openedFeatData(feature.featData, nextLevel.value),
        });
      }
    }

    return collected;
  });

  /**
   * Дары умения без выборов, до которых персонаж ещё не дорос.
   *
   * @param featData - дары умения из справочника
   * @param level - уровень, который берут сейчас
   * @returns дары с отобранными выборами
   */
  function openedFeatData(featData: FeatData, level: number): FeatData {
    const choices = featData.choices;

    if (!choices?.length) {
      return featData;
    }

    // Ступени роста разворачиваются в отдельные выборы со своим уровнем: дальше
    // их отбирает то же правило, что и выбор, которому уровень задали вручную
    return {
      ...featData,
      choices: expandChoiceScaling(choices).filter(
        (choice) => !choice.requiredLevel || choice.requiredLevel <= level,
      ),
    };
  }

  /**
   * Выборы даров уровня — в том же порядке и тем же разбором, что у черты:
   * сперва список класса, потом заклинания из него, потом характеристика.
   */
  const preparedFeatChoices = computed<FeatChoice[]>(() =>
    prepareFeatChoices(
      levelFeatData.value.flatMap((data) => data.choices ?? []),
    ),
  );

  /**
   * Ключи умений уровня с повышением характеристик: их выбор черты
   * спрашивается на шаге характеристик, а не среди даров умений.
   */
  const asiFeatureKeys = computed(
    () =>
      new Set(
        levelFeatures.value
          .filter((feature) => isAsiFeature(feature))
          .map((feature) => feature.key),
      ),
  );

  /**
   * Выборы черты умений уровня — боевой стиль и подобные — со своим
   * умением-источником: спрашиваются пикером компендиума, а не общими полями
   * выбора, потому что пул у них не из справочника правил.
   */
  const featPickChoices = computed<WizardFeatPick[]>(() =>
    levelFeatDataSources.value
      .filter((source) => !asiFeatureKeys.value.has(source.sourceKey))
      .flatMap((source) =>
        (source.featData.choices ?? [])
          .filter(isFeatPickChoice)
          .map((choice) => ({ choice, sourceName: source.sourceName })),
      ),
  );

  /**
   * Выбор черты умения повышения характеристик: им сужается пул на шаге
   * характеристик в режиме «Взять черту». `null` — умение описано одним
   * флагом, и пул берётся по правилу листа.
   */
  const asiFeatChoice = computed<FeatChoice | null>(
    () =>
      levelFeatDataSources.value
        .filter((source) => asiFeatureKeys.value.has(source.sourceKey))
        .flatMap((source) =>
          (source.featData.choices ?? []).filter(isFeatPickChoice),
        )[0] ?? null,
  );

  /**
   * Выборы, спрошенные прямо сейчас: остальные ждут ответа про класс. Выбор
   * черты сюда не входит — у него свой пикер.
   */
  const visibleFeatChoices = computed<FeatChoice[]>(() =>
    getVisibleFeatChoices(
      preparedFeatChoices.value,
      wizardState.featDataChoices,
    ).filter((choice) => !isFeatPickChoice(choice)),
  );

  /** Все выборы уровня отвечены — без этого шаг умений не пройти. */
  const areFeatChoicesComplete = computed(
    () =>
      visibleFeatChoices.value.every(
        (choice) =>
          (wizardState.featDataChoices[choice.key] ?? []).length
          >= resolveFeatChoiceCount(choice, featChoiceProficiencyBonus.value),
      )
      && featPickChoices.value.every(
        ({ choice }) =>
          (wizardState.featDataChoices[choice.key] ?? []).length > 0,
      ),
  );

  /**
   * Ключи черт компендиума, которые уровень кладёт на лист: выбранные в умениях,
   * взятая вместо повышения характеристик и выданные умениями без выбора.
   */
  const chosenFeatIds = computed<string[]>(() => {
    const classDef = classDefinition.value;

    const asiFeatKey =
      classDef
      && hasAbilityImprovementAtLevel(classDef, nextLevel.value)
      && wizardState.asi.mode === 'feat'
        ? wizardState.asi.featKey
        : null;

    return [
      ...featPickChoices.value.flatMap(
        ({ choice }) => wizardState.featDataChoices[choice.key] ?? [],
      ),
      ...(asiFeatKey ? [asiFeatKey] : []),
      ...levelFeatData.value.flatMap((data) =>
        (data.grantedFeats ?? []).map((feat) => feat.featId),
      ),
    ];
  });

  /** Записи компендиума для взятых уровнем черт; неизвестные ключи пропускаются */
  const chosenCompendiumFeats = computed<CompendiumFeat[]>(() =>
    chosenFeatIds.value.flatMap((featId) => {
      const feat = compendiumFeats.value.find((entry) => entry.id === featId);

      return feat ? [feat] : [];
    }),
  );

  /**
   * Выбор владения навыками, который дают умения этого уровня.
   *
   * Умений с таким выбором на одном уровне может оказаться несколько (класс и
   * подкласс), поэтому они складываются в один шаг: количество суммируется, пул
   * объединяется. Пустой пул хотя бы у одного умения означает «любой навык» и
   * забирает пул целиком — сузить его было бы неверно.
   *
   * `null` — на этом уровне выбирать нечего, шаг не показывается.
   */
  const featureSkillChoice = computed((): ClassFeatureSkillChoice | null => {
    const choices = levelFeatures.value
      .map((feature) => feature.skillChoice)
      .filter((choice): choice is ClassFeatureSkillChoice =>
        Boolean(choice && choice.count > 0),
      );

    if (choices.length === 0) {
      return null;
    }

    const count = choices.reduce((sum, choice) => sum + choice.count, 0);
    const anySkill = choices.some((choice) => choice.from.length === 0);

    const from = anySkill
      ? SKILLS_LIST.map((skill) => skill.key)
      : Array.from(new Set(choices.flatMap((choice) => choice.from)));

    return { count, from };
  });

  /**
   * Позиции выбранного варианта стартового снаряжения. Пусто — вариант не
   * выбран, выбран отказ или приехал без позиций; тогда мастер инвентарь
   * не трогает.
   */
  const selectedEquipmentItems = computed(() => {
    const index = wizardState.selectedEquipmentIndex;

    if (index === null || index === CLASS_EQUIPMENT_NONE_INDEX) {
      return [];
    }

    return classDefinition.value?.startingEquipment?.[index]?.items ?? [];
  });

  /**
   * Заклинания, автоматически предоставляемые умениями на получаемом уровне:
   * `grantedSpells` умений этого уровня плюс `grantedSpellsByLevel` ранее
   * полученных умений (поуровневые списки доменов/клятв/покровителей).
   * Не тратят лимит ручного выбора.
   */
  const grantedSpellSources = computed((): GrantedSpellSource[] => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const allFeatures = [
      ...classDef.features,
      ...(activeSubclass.value?.features ?? []),
    ];

    // Заклинания черт, взятых уровнем, идут тем же путём, что и заклинания
    // умений: «Посвящённый в магию» вместо повышения характеристик обязан
    // положить свои заговоры в книгу
    return [
      ...collectGrantedSpellSourcesForClassLevel(allFeatures, nextLevel.value),
      ...chosenCompendiumFeats.value.flatMap((feat) =>
        collectFeatGrantedSpellSources(feat, actor.value),
      ),
    ];
  });

  /** Требуется ли выбор подкласса на этом уровне */
  const hasSubclassSelection = computed(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return false;
    }

    // Выбор нужен, если мы достигли нужного уровня и у актора ещё нет подкласса
    return (
      nextLevel.value === classDef.subclassLevel
      && !currentClassEntry.value?.subclassKey
    );
  });

  /** Есть ли ASI на этом уровне */
  const hasAsiAtLevel = computed(() => {
    const classDef = classDefinition.value;

    return classDef
      ? hasAbilityImprovementAtLevel(classDef, nextLevel.value)
      : false;
  });

  /**
   * Есть ли заклинания у класса или выбранного подкласса.
   *
   * Учитывает подклассы-заклинатели (Мистический рыцарь, Таинственный стрелок),
   * у которых магия определена в SubclassDefinition.spellcasting, а не в ClassDefinition.
   */
  const hasSpellcasting = computed(() => {
    if (
      classDefinition.value?.spellcasting !== null
      && classDefinition.value?.spellcasting !== undefined
    ) {
      return true;
    }

    // Проверяем заклинательность подкласса
    return (
      activeSubclass.value?.spellcasting !== null
      && activeSubclass.value?.spellcasting !== undefined
    );
  });

  /**
   * Лимиты выбора новых заклинаний и заговоров на текущем уровне.
   * Считывается напрямую из JSON-таблицы класса/подкласса.
   */
  const spellSelectionLimits = computed((): SpellSelectionLimits => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return { cantrips: 0, spells: 0, spellsByLevel: null };
    }

    const subclassTable = activeSubclass.value?.levelTable;
    const table = subclassTable ?? classDef.levelTable;
    const entry = table.find((row) => row.level === nextLevel.value);

    if (!entry) {
      return { cantrips: 0, spells: 0, spellsByLevel: null };
    }

    const cantrips =
      typeof entry.newCantrips === 'number' ? entry.newCantrips : 0;

    const spells = typeof entry.newSpells === 'number' ? entry.newSpells : 0;
    const spellsByLevel = entry.newSpellsByLevel ?? null;

    return { cantrips, spells, spellsByLevel };
  });

  /** Количество навыков для выбора */
  const skillChoicesCount = computed(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return 0;
    }

    if (isFirstClass.value) {
      return classDef.skillChoices.count;
    }

    if (isMulticlass.value) {
      const multiProf = getMulticlassProficiencies(classDef);

      return multiProf?.skillChoices ?? 0;
    }

    return 0;
  });

  /** Доступные навыки для выбора */
  const availableSkills = computed((): SkillType[] => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    return classDef.skillChoices.from;
  });

  /**
   * Навыки, которыми персонаж уже владеет из внешних источников
   * (раса, предыстория, другие классы при мультиклассировании).
   *
   * Навыки, выбранные на предыдущих уровнях этого же класса,
   * внешними дубликатами не считаются. Для первого уровня класса
   * (или мультикласса) внешними являются все навыки актора.
   */
  const alreadyProficientSkills = computed((): SkillType[] => {
    const skillProficiencies = actor.value.system.proficiencies?.skills;

    if (!skillProficiencies) {
      return [];
    }

    const currentClassSkills = new Set<SkillType>(
      currentClassEntry.value?.chosenSkills ?? [],
    );

    return SKILLS_LIST.filter((skillEntry) => {
      const proficiencyLevel = skillProficiencies[skillEntry.key];

      return (
        (proficiencyLevel === 'proficient' || proficiencyLevel === 'expertise')
        && !currentClassSkills.has(skillEntry.key)
      );
    }).map((skillEntry) => skillEntry.key);
  });

  /** Текущий индекс шага */
  const stepIndex = ref(0);

  // ── Шаги ──────────────────────────────────────────────────

  /** Динамически сформированный список шагов */
  const wizardSteps = computed((): WizardStepItem[] => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const steps: WizardStepItem[] = [];

    // ХП — всегда
    steps.push({ value: 'hitPoints', ...STEP_DEFINITIONS.hitPoints });

    if (isFirstClass.value) {
      // Первый класс: Спасброски → Владения → Навыки → Особенности → Заклинания
      steps.push({ value: 'savingThrows', ...STEP_DEFINITIONS.savingThrows });
      steps.push({ value: 'proficiencies', ...STEP_DEFINITIONS.proficiencies });

      if (classDef.skillChoices.count > 0) {
        steps.push({ value: 'skills', ...STEP_DEFINITIONS.skills });
      }
    } else if (isMulticlass.value) {
      // Мультикласс: Владения (сокращённые)
      steps.push({ value: 'proficiencies', ...STEP_DEFINITIONS.proficiencies });

      const multiProf = getMulticlassProficiencies(classDef);

      if (multiProf && multiProf.skillChoices > 0) {
        steps.push({ value: 'skills', ...STEP_DEFINITIONS.skills });
      }
    }

    // Особенности — если есть на текущем уровне или нужен выбор подкласса
    if (levelFeatures.value.length > 0 || hasSubclassSelection.value) {
      steps.push({ value: 'features', ...STEP_DEFINITIONS.features });
    }

    // Навыки от самого умения — сразу за особенностями, которые их дали
    if (featureSkillChoice.value) {
      steps.push({ value: 'featureSkills', ...STEP_DEFINITIONS.featureSkills });
    }

    // Стартовое снаряжение берут один раз — при взятии класса на 1 уровне
    if (isFirstClass.value && (classDef.startingEquipment?.length ?? 0) > 0) {
      steps.push({ value: 'equipment', ...STEP_DEFINITIONS.equipment });
    }

    // Заклинания — если класс заклинатель
    if (hasSpellcasting.value) {
      steps.push({ value: 'spellcasting', ...STEP_DEFINITIONS.spellcasting });
    }

    // ASI — если на этом уровне есть ASI
    if (hasAsiAtLevel.value) {
      steps.push({ value: 'asi', ...STEP_DEFINITIONS.asi });
    }

    return steps;
  });

  /** Текущий ключ шага */
  const activeStepKey = computed((): WizardStepKey | null => {
    return wizardSteps.value[stepIndex.value]?.value ?? null;
  });

  const isFirstStep = computed(() => stepIndex.value === 0);

  const isLastStep = computed(
    () => stepIndex.value === wizardSteps.value.length - 1,
  );

  // ── Валидация ──────────────────────────────────────────────

  /**
   * Полностью ли выбраны заклинания на текущем уровне (заговоры + заклинания).
   *
   * Используется не для жёсткой блокировки шага (заклинания можно выбрать
   * позже), а чтобы предупредить пользователя при завершении мастера.
   */
  const isSpellSelectionComplete = computed((): boolean => {
    const limits = spellSelectionLimits.value;

    // Если лимитов нет — выбирать нечего
    if (limits.cantrips === 0 && limits.spells === 0 && !limits.spellsByLevel) {
      return true;
    }

    const selectedCantripsCount = wizardState.selectedSpells.filter(
      (spell) => spell.level === 0,
    ).length;

    if (selectedCantripsCount < limits.cantrips) {
      return false;
    }

    if (limits.spellsByLevel) {
      for (const [levelStr, requiredCount] of Object.entries(
        limits.spellsByLevel,
      )) {
        const targetLevel = Number(levelStr);

        const count = wizardState.selectedSpells.filter(
          (spell) => spell.level === targetLevel,
        ).length;

        if (count < requiredCount) {
          return false;
        }
      }
    } else if (limits.spells > 0) {
      const selectedSpellsCount = wizardState.selectedSpells.filter(
        (spell) => spell.level > 0,
      ).length;

      if (selectedSpellsCount < limits.spells) {
        return false;
      }
    }

    return true;
  });

  /**
   * Проверяет, можно ли перейти на следующий шаг
   */
  const canProceed = computed((): boolean => {
    const stepKey = activeStepKey.value;

    if (!stepKey) {
      return false;
    }

    switch (stepKey) {
      case 'hitPoints':
        return wizardState.hitPoints.value >= 1;
      case 'skills':
        return wizardState.selectedSkills.length === skillChoicesCount.value;
      case 'featureSkills':
        return (
          wizardState.selectedFeatureSkills.length
          === (featureSkillChoice.value?.count ?? 0)
        );
      case 'features': {
        if (hasSubclassSelection.value && !wizardState.subclassKey) {
          return false;
        }

        // Все фичи с choices должны иметь выбранный вариант
        const featuresWithChoices = levelFeatures.value.filter(
          (feature) => feature.choices && feature.choices.length > 0,
        );

        const variantsChosen = featuresWithChoices.every(
          (feature) => wizardState.featureChoices[feature.key] !== undefined,
        );

        // Дары уровня спрашивают своё: без ответа игрок ушёл бы с уровня, не
        // получив того, что умение выдаёт
        return variantsChosen && areFeatChoicesComplete.value;
      }
      case 'asi': {
        if (wizardState.asi.mode === 'feat') {
          return wizardState.asi.featKey !== null;
        }

        // Сумма прибавок должна быть ровно 2
        const totalIncrease = Object.values(
          wizardState.asi.abilityIncreases,
        ).reduce((sum, increment) => sum + (increment ?? 0), 0);

        return totalIncrease === 2;
      }
      // Информационные шаги — всегда можно перейти
      case 'savingThrows':
      case 'proficiencies':
        return true;
      // Заклинания можно не выбирать — переход не блокируется.
      // Неполный выбор подтверждается отдельной модалкой при завершении.
      case 'spellcasting':
        return true;
      default:
        return true;
    }
  });

  // ── Навигация ──────────────────────────────────────────────

  function nextStep(): void {
    if (stepIndex.value < wizardSteps.value.length - 1) {
      stepIndex.value++;
    }
  }

  function prevStep(): void {
    if (stepIndex.value > 0) {
      stepIndex.value--;
    }
  }

  // ── Инициализация ──────────────────────────────────────────

  /**
   * Сбрасывает состояние мастера к значениям по умолчанию.
   * Вызывается при открытии модалки, чтобы очистить выбор предыдущего запуска.
   */
  function resetState(): void {
    stepIndex.value = 0;

    if (isMaxHitDieLevel.value) {
      wizardState.hitPoints.value = classDefinition.value?.hitDie ?? 0;
      wizardState.hitPoints.method = 'max';
    } else {
      wizardState.hitPoints.value = averageHitPoints.value;
      wizardState.hitPoints.method = 'average';
    }

    wizardState.selectedSkills = [];
    wizardState.selectedFeatureSkills = [];
    wizardState.selectedEquipmentIndex = null;
    wizardState.subclassKey = null;
    wizardState.featureChoices = {};
    wizardState.featDataChoices = {};
    wizardState.asi = { mode: 'asi', abilityIncreases: {}, featKey: null };
    wizardState.selectedSpells = [];
    wizardState.toolProficiencies = [];
  }

  watch(isOpen, (opened) => {
    if (opened) {
      resetState();
    }
  });

  // ── Сбор результатов ──────────────────────────────────────

  /**
   * Формирует объект обновлений для записи в актора
   *
   * @param resolvedGrantedSpells - granted-заклинания умений текущего уровня,
   * сопоставленные с данными компендиума (добавляются как всегда подготовленные)
   */
  function buildUpdates(resolvedGrantedSpells: ResolvedGrantedSpell[] = []): {
    systemUpdates: Partial<DnDActor['system']>;
    rootUpdates: Partial<DnDActor>;
  } {
    const classDef = classDefinition.value;

    if (!classDef) {
      return { systemUpdates: {}, rootUpdates: {} };
    }

    const systemUpdates: Partial<DnDActor['system']> = {};
    const rootUpdates: Partial<DnDActor> = {};
    const classes = [...(actor.value.system.classes || [])];

    const existingIndex = classes.findIndex(
      (entry) => entry.classKey === classDef.key,
    );

    const rolledHp = Math.max(1, wizardState.hitPoints.value);

    const levelGained =
      (existingIndex !== -1 ? classes[existingIndex].level : 0) + 1;

    // Заклинательная конфигурация: из класса или из выбранного подкласса
    const chosenSubclassKey =
      wizardState.subclassKey
      || (existingIndex !== -1 ? classes[existingIndex].subclassKey : null);

    const chosenSubclass = chosenSubclassKey
      ? classDef.subclasses.find(
          (subclass) => subclass.key === chosenSubclassKey,
        )
      : undefined;

    const effectiveSpellcasting =
      classDef.spellcasting ?? chosenSubclass?.spellcasting ?? null;

    if (existingIndex !== -1) {
      // Level up
      classes[existingIndex] = {
        ...classes[existingIndex],
        level: classes[existingIndex].level + 1,
        subclassKey:
          wizardState.subclassKey || classes[existingIndex].subclassKey,
        hitPointsGained: [
          ...classes[existingIndex].hitPointsGained,
          {
            level: levelGained,
            method: wizardState.hitPoints.method,
            rolled: rolledHp,
          },
        ],
        featureChoices: {
          ...classes[existingIndex].featureChoices,
          ...wizardState.featureChoices,
        },
        ...(effectiveSpellcasting && !classes[existingIndex].spellcastingAbility
          ? {
              spellcastingAbility: effectiveSpellcasting.ability,
              casterType: effectiveSpellcasting.type,
            }
          : {}),
      };
    } else {
      // Новый класс
      classes.push({
        classKey: classDef.key,
        className: classDef.name,
        level: 1,
        subclassKey: wizardState.subclassKey || null,
        hitDie: classDef.hitDie,
        hitDiceUsed: 0,
        hitPointsGained: [
          {
            level: 1,
            method: wizardState.hitPoints.method,
            rolled: rolledHp,
          },
        ],
        chosenSkills: [...wizardState.selectedSkills],
        featureChoices: { ...wizardState.featureChoices },
        ...(effectiveSpellcasting
          ? {
              spellcastingAbility: effectiveSpellcasting.ability,
              casterType: effectiveSpellcasting.type,
            }
          : {}),
      });
    }

    systemUpdates.classes = classes;

    // ── Счётчики классовых ресурсов ──────────────────────────────
    // Собираем определения счётчиков из класса и выбранного подкласса
    const counterDefinitions: ClassCounterDefinition[] = [
      ...(classDef.counters ?? []),
      ...(chosenSubclass?.counters ?? []),
    ];

    if (counterDefinitions.length > 0) {
      const existingCounters = [...(actor.value.system.classCounters ?? [])];

      const classLevel =
        existingIndex !== -1 ? classes[existingIndex].level : 1;

      // Контекст формул собирается один раз на весь список счётчиков. Уровень в
      // нём — уровень В ЭТОМ КЛАССЕ, а не суммарный: классовый ресурс растёт
      // вместе со своим классом, и у чародея 3 / воина 2 очков чародейства три,
      // а не пять. Бонус мастерства при этом остаётся общим — он считается по
      // суммарному уровню и классу не принадлежит
      const counterContext: FormulaContext = {
        ...buildCounterFormulaContext({
          ...actor.value,
          system: { ...actor.value.system, classes },
        }),
        level: classLevel,
      };

      for (const counterDef of counterDefinitions) {
        // Проверяем, что уровень персонажа достаточен для этого счётчика
        if (classLevel < counterDef.startLevel) {
          continue;
        }

        // Проверяем, что счётчик ещё не добавлен (защита от дублей)
        const alreadyExists = existingCounters.some(
          (existing) =>
            existing.counterKey === counterDef.key
            && existing.classKey === classDef.key,
        );

        if (alreadyExists) {
          // Обновляем max при level-up
          const existingCounter = existingCounters.find(
            (entry) =>
              entry.counterKey === counterDef.key
              && entry.classKey === classDef.key,
          );

          if (existingCounter) {
            const newMax = computeCounterMax(
              counterDef,
              classLevel,
              counterContext,
            );

            existingCounter.max = newMax;

            // current не может превышать новый max
            if (existingCounter.current > newMax) {
              existingCounter.current = newMax;
            }

            // Backfill названия для счётчиков, добавленных до этого фикса
            // (раньше имя не сохранялось и подставлялось только в рантайме).
            if (!existingCounter.name?.trim()) {
              existingCounter.name = counterDef.name;
            }

            if (!existingCounter.shortName?.trim()) {
              existingCounter.shortName = counterDef.shortName;
            }

            existingCounter.recovery ??= counterDef.recovery;

            // Нижняя граница появилась у счётчика позже: у записей, добавленных
            // до неё, её нет вовсе
            existingCounter.min ??= counterDef.min;
          }

          continue;
        }

        // Создаём новый счётчик
        const maxValue = computeCounterMax(
          counterDef,
          classLevel,
          counterContext,
        );

        existingCounters.push({
          counterKey: counterDef.key,
          classKey: classDef.key,
          subclassKey: counterDef.subclassKey ?? undefined,
          // Сразу сохраняем название/восстановление из определения на актора,
          // чтобы имя на русском отображалось всегда, даже если компендиум
          // недоступен или сопоставление по ключу не сработает.
          name: counterDef.name,
          shortName: counterDef.shortName,
          recovery: counterDef.recovery,
          // Нижняя граница живёт на счётчике: её читают и панель ресурсов, и
          // отдых. Формула НЕ сохраняется: её `@level` — уровень в этом классе,
          // а пересчёт вне мастера знает только суммарный, и у мультикласса
          // максимум разошёлся бы с выданным
          ...(counterDef.min ? { min: counterDef.min } : {}),
          current: maxValue,
          max: maxValue,
        });
      }

      systemUpdates.classCounters = existingCounters;
    }

    // Ресурсы черт пересчитываются на каждом повышении уровня: у «Удачливого»
    // максимум равен бонусу мастерства и обязан вырасти вместе с ним. Считаем
    // от уже обновлённого списка счётчиков, чтобы не потерять классовые
    // Уровень уже новый: формулы ресурсов (`@prof`, `@level`) обязаны считать
    // от него, иначе очки удачи вырастут только со следующим повышением
    const leveledActor = {
      ...actor.value,
      system: { ...actor.value.system, ...systemUpdates },
    };

    systemUpdates.classCounters = refreshFeatCounters(
      leveledActor,
      systemUpdates.classCounters ?? actor.value.system.classCounters ?? [],
    );

    // Свои ресурсы игрока с формулой максимума растут по той же причине: их
    // `refreshFeatCounters` не трогает — черты им не владеют
    systemUpdates.classCounters = refreshCounterMaxima(
      leveledActor,
      systemUpdates.classCounters,
    );

    // Владения — обновляем proficiencies при добавлении нового класса
    if (isFirstClass.value || isMulticlass.value) {
      const existingProf = actor.value.system.proficiencies;
      const systemStore = useSystemDataStore();

      /**
       * Разворачивает список владений доспехами: заменяет категории
       * (напр. «light») на конкретные ключи базовых типов доспехов.
       *
       * @param items - список ключей категорий или конкретных доспехов
       * @returns Плоский список ключей базовых типов доспехов без дубликатов
       */
      const unpackArmor = (items: string[]) => {
        const result = new Set<string>();

        for (const item of items) {
          const matchedTypes = systemStore.armorBaseTypes.filter(
            (baseType) => baseType.category === item || baseType.key === item,
          );

          if (matchedTypes.length > 0) {
            matchedTypes.forEach((baseType) => result.add(baseType.key));
          } else {
            result.add(item);
          }
        }

        return Array.from(result);
      };

      /**
       * Разворачивает список владений оружием: заменяет категории
       * (напр. «simple») на конкретные ключи базовых типов оружия.
       *
       * @param items - список ключей категорий или конкретного оружия
       * @returns Плоский список ключей базовых типов оружия без дубликатов
       */
      const unpackWeapons = (items: string[]) => {
        const result = new Set<string>();

        for (const item of items) {
          const matchedTypes = systemStore.weaponBaseTypes.filter(
            (baseType) => baseType.category === item || baseType.key === item,
          );

          if (matchedTypes.length > 0) {
            matchedTypes.forEach((baseType) => result.add(baseType.key));
          } else {
            result.add(item);
          }
        }

        return Array.from(result);
      };

      const proficiencies = {
        armor: [...(existingProf?.armor ?? [])],
        weapons: [...(existingProf?.weapons ?? [])],
        weaponMasteries: [...(existingProf?.weaponMasteries ?? [])],
        masteryProperties: [...(existingProf?.masteryProperties ?? [])],
        tools: [...(existingProf?.tools ?? [])],
        languages: [...(existingProf?.languages ?? [])],
        savingThrows: [...(existingProf?.savingThrows ?? [])],
        skills: { ...(existingProf?.skills ?? {}) },
      };

      if (isFirstClass.value) {
        // Первый класс — полные стартовые владения
        const armorList = unpackArmor(classDef.armorProficiencies);

        for (const armor of armorList) {
          if (!proficiencies.armor.includes(armor)) {
            proficiencies.armor.push(armor);
          }
        }

        const weaponList = unpackWeapons(classDef.weaponProficiencies);

        for (const weapon of weaponList) {
          if (!proficiencies.weapons.includes(weapon)) {
            proficiencies.weapons.push(weapon);
          }
        }

        // Ключи, разобранные шагом владений, — не текст из определения: текст
        // окно выбора инструментов не узнаёт и молча выбрасывает при сохранении.
        for (const tool of wizardState.toolProficiencies) {
          if (!proficiencies.tools.includes(tool)) {
            proficiencies.tools.push(tool);
          }
        }

        // Спасброски
        for (const saving of classDef.savingThrowProficiencies) {
          if (!proficiencies.savingThrows.includes(saving)) {
            proficiencies.savingThrows.push(saving);
          }
        }
      } else {
        // Мультикласс — сокращённые владения (PHB 2024)
        const multiProf = getMulticlassProficiencies(classDef);

        if (multiProf) {
          const armorList = unpackArmor(multiProf.armor);

          for (const armor of armorList) {
            if (!proficiencies.armor.includes(armor)) {
              proficiencies.armor.push(armor);
            }
          }

          const weaponList = unpackWeapons(multiProf.weapons);

          for (const weapon of weaponList) {
            if (!proficiencies.weapons.includes(weapon)) {
              proficiencies.weapons.push(weapon);
            }
          }

          for (const tool of wizardState.toolProficiencies) {
            if (!proficiencies.tools.includes(tool)) {
              proficiencies.tools.push(tool);
            }
          }
        }
      }

      // Навыки — устанавливаем владение ('proficient')
      const profLevel: ProficiencyLevel = 'proficient';

      for (const skill of wizardState.selectedSkills) {
        proficiencies.skills[skill] = profLevel;
      }

      systemUpdates.proficiencies = proficiencies;
    }

    // Навыки от умения — своим блоком: их дают и на повышении уровня, когда
    // блок стартовых владений выше не выполняется
    if (wizardState.selectedFeatureSkills.length > 0) {
      const existingProf = actor.value.system.proficiencies;

      const skills = {
        ...(systemUpdates.proficiencies?.skills ?? existingProf?.skills ?? {}),
      };

      for (const skill of wizardState.selectedFeatureSkills) {
        skills[skill] = 'proficient';
      }

      systemUpdates.proficiencies = {
        ...(systemUpdates.proficiencies
          ?? existingProf ?? {
            armor: [],
            weapons: [],
            weaponMasteries: [],
            tools: [],
            languages: [],
            savingThrows: [],
            skills: {},
          }),
        skills,
      };
    }

    // Дары уровня: то, что класс, подкласс и умения этого уровня выдают сами, и
    // то, что игрок назвал в их выборах. Модель та же, что у черты, поэтому и
    // разбор ответов общий с ней — второй бы разошёлся с первым
    if (levelFeatData.value.length > 0) {
      systemUpdates.proficiencies = applyLevelFeatData(
        systemUpdates.proficiencies ?? actor.value.system.proficiencies,
        levelFeatData.value,
        wizardState.featDataChoices,
      );
    }

    // ASI — создаём Active Effect с бонусами к характеристикам (5.5e: ASI — это черта)
    if (hasAsiAtLevel.value && wizardState.asi.mode === 'asi') {
      const asiChanges: ActiveEffect['changes'] = [];

      const abilityKeys: AbilityType[] = [
        'strength',
        'dexterity',
        'constitution',
        'intelligence',
        'wisdom',
        'charisma',
      ];

      const labelParts: string[] = [];

      for (const abilityKey of abilityKeys) {
        const increment = wizardState.asi.abilityIncreases[abilityKey];

        if (increment && increment > 0) {
          asiChanges.push({
            key: `ability.${abilityKey}`,
            mode: 'add',
            value: String(increment),
            priority: 20,
          });

          labelParts.push(`${ABILITY_LABELS[abilityKey]} +${increment}`);
        }
      }

      if (asiChanges.length > 0) {
        const asiEffect: ActiveEffect = {
          id: generateId('effect'),
          name: `Повышение характеристик (${classDef.name}, ${levelGained} ур.)`,
          description: labelParts.join(', '),
          icon: 'tabler:trending-up',
          disabled: false,
          origin: 'feature',
          transfer: false,
          duration: { type: 'permanent' },
          changes: asiChanges,
          flags: [],
        };

        rootUpdates.activeEffects = [
          ...(actor.value.activeEffects ?? []),
          asiEffect,
        ];
      }
    }

    // Эффекты, заявленные классом, подклассом и умениями уровня. Считаются
    // поверх ASI-эффекта выше: тот уже мог занять rootUpdates.activeEffects, и
    // второй список затёр бы первый
    const declaredEffects = [
      ...collectClassEffects(classDef, levelGained),
      ...collectSubclassEffects(
        classDef,
        chosenSubclass,
        Boolean(wizardState.subclassKey),
      ),
      ...collectFeatureEffects(classDef, levelFeatures.value),
    ];

    // Синтетические эффекты даров featData уровня: модификаторы листа, защиты
    // (включая выбранные игроком), прибавки — тот же сборщик, что у черты.
    // Раньше из featData применялись только владения, и модификаторы с
    // защитами до листа не доезжали. Id стабилен по источнику, поэтому
    // mergeClassEffects не поставит вторую копию при переоткрытии мастера, а
    // снятие класса снимет эффект по префиксу класса.
    for (const source of levelFeatDataSources.value) {
      const grantEffect = buildFeatGrantEffect(
        source.sourceKey,
        source.sourceName,
        source.featData,
        CLASS_GRANT_EFFECT_PRESENTATION,
        {
          acquisitionLevel: getTotalLevel(actor.value.system.classes) + 1,
          walkSpeed: actor.value.system.movement?.walk,
          chosenDamageDefenses: resolveChosenDamageDefenses(
            source.featData,
            wizardState.featDataChoices,
          ),
          chosenAbilities: resolveChosenAbilities(
            source.featData,
            wizardState.featDataChoices,
          ),
        },
      );

      if (grantEffect) {
        declaredEffects.push({
          ...grantEffect,
          id: buildClassEffectId(classDef.key, `grant:${source.sourceKey}`),
          originId: classDef.key,
        });
      }
    }

    if (declaredEffects.length > 0) {
      const before =
        rootUpdates.activeEffects ?? actor.value.activeEffects ?? [];

      const merged = mergeClassEffects(before, declaredEffects);

      if (merged.length !== before.length) {
        rootUpdates.activeEffects = merged;
      }
    }

    // Тёмное зрение из даров уровня: дальность зрения токена поднимается до
    // максимума и не понижается — источник мог быть и другой (вид/черта)
    const featDataDarkvision = levelFeatData.value.reduce(
      (best, block) => Math.max(best, block.darkvision ?? 0),
      0,
    );

    const raisedToken = raiseTokenDarkvision(
      actor.value.token,
      featDataDarkvision,
    );

    if (raisedToken) {
      rootUpdates.token = raisedToken;
    }

    // Особенности — добавляем в общий список features актора
    if (levelFeatures.value.length > 0) {
      const newFeatures = [...(actor.value.features || [])];

      for (const feature of levelFeatures.value) {
        // Пропускаем информационные особенности и ASI/Feat
        if (feature.isInformationalOnly || isAsiFeature(feature)) {
          continue;
        }

        let featureName = feature.name;
        let featureDesc = feature.description;

        // Если у особенности есть выбор, и пользователь его сделал
        if (feature.choices && feature.choices.length > 0) {
          const choiceKey = wizardState.featureChoices[feature.key];

          if (choiceKey) {
            const choice = feature.choices.find(
              (choiceEntry) => choiceEntry.key === choiceKey,
            );

            if (choice) {
              featureName = `${feature.name}: ${choice.name}`;
              featureDesc = choice.description; // Берём описание выбора как основное
            }
          }
        }

        // Защита от дублей: если такая особенность уже добавлена
        const alreadyExists = newFeatures.some(
          (existing) => existing.name === featureName,
        );

        if (!alreadyExists) {
          // grantedBy включает класс (и подкласс): имя класса обязано остаться
          // в строке — по нему удаление класса находит свои умения
          const grantedBy =
            feature.isSubclass && feature.sourceName
              ? `${classDef.name} — ${feature.sourceName}`
              : classDef.name;

          newFeatures.push({
            id: generateId('feature'),
            name: featureName,
            grantedBy,
            description: featureDesc,
            level: feature.level,
            featureType: feature.isSubclass ? 'subclass' : 'class',
          });
        }
      }

      if (newFeatures.length > actor.value.features?.length) {
        rootUpdates.features = newFeatures;
      }
    }

    // Заклинания — добавляем granted-заклинания умений и выбранные заклинания
    // в actor.spells (без дублей). Сопоставляем по названию: при добавлении
    // в лист персонажа заклинанию выдаётся новый id, поэтому id компендиума
    // с ним никогда не совпадает.
    if (
      wizardState.selectedSpells.length > 0
      || resolvedGrantedSpells.length > 0
    ) {
      const existingSpells = appendGrantedSpells(
        actor.value.spells ?? [],
        resolvedGrantedSpells,
      );

      const existingNames = new Set(
        existingSpells.map((spell) => normalizeSpellName(spell.name)),
      );

      for (const spell of wizardState.selectedSpells) {
        const normalizedName = normalizeSpellName(spell.name);

        if (!existingNames.has(normalizedName)) {
          existingSpells.push({
            ...spell,
            prepared: spell.level === 0,
            id: generateId('spell'),
          });

          existingNames.add(normalizedName);
        }
      }

      rootUpdates.spells = existingSpells;
    }

    // Черты, взятые уровнем: выбранные в умениях (боевой стиль), взятая вместо
    // повышения характеристик и выданные без выбора. Применяются тем же кодом,
    // что и черта, перетащенная на лист, — поверх уже собранных обновлений,
    // чтобы владения и эффекты легли на итог уровня. Заклинания черт уже
    // добавлены выше вместе с заклинаниями умений
    if (chosenCompendiumFeats.value.length > 0) {
      let intermediate: DnDActor = {
        ...actor.value,
        ...rootUpdates,
        system: { ...actor.value.system, ...systemUpdates },
      };

      const acquisitionLevel = getTotalLevel(actor.value.system.classes) + 1;

      for (const feat of chosenCompendiumFeats.value) {
        const applied = applyFeatToActor(
          intermediate,
          { ...feat, acquisitionLevel },
          [],
        );

        // Провенанс класса: по нему удаление класса снимет и выданную им черту
        const features = applied.features.map((feature, index) =>
          index === applied.features.length - 1
            ? { ...feature, grantedBy: classDef.name, level: levelGained }
            : feature,
        );

        intermediate = {
          ...intermediate,
          features,
          spells: applied.spells,
          activeEffects: applied.activeEffects,
          system: {
            ...intermediate.system,
            proficiencies: applied.proficiencies,
            classCounters: applied.classCounters,
          },
          ...(applied.token ? { token: applied.token } : {}),
        };
      }

      rootUpdates.features = intermediate.features;
      rootUpdates.activeEffects = intermediate.activeEffects;
      systemUpdates.proficiencies = intermediate.system.proficiencies;
      systemUpdates.classCounters = intermediate.system.classCounters;

      if (intermediate.token !== actor.value.token) {
        rootUpdates.token = intermediate.token;
      }
    }

    return { systemUpdates, rootUpdates };
  }

  return {
    // Контекст
    isFirstClass,
    isMulticlass,
    nextLevel,
    isMaxHitDieLevel,
    averageHitPoints,
    levelFeatures,
    hasSubclassSelection,
    hasAsiAtLevel,
    hasSpellcasting,
    activeSubclass,
    skillChoicesCount,
    availableSkills,
    alreadyProficientSkills,
    featureSkillChoice,
    selectedEquipmentItems,

    // Шаги
    wizardSteps,
    activeStepKey,
    isFirstStep,
    isLastStep,
    currentStepIndex: stepIndex,

    // Состояние
    wizardState,
    canProceed,
    visibleFeatChoices,
    featPickChoices,
    asiFeatChoice,
    featChoiceProficiencyBonus,
    isSpellSelectionComplete,
    spellSelectionLimits,
    grantedSpellSources,

    // Навигация
    nextStep,
    prevStep,

    // Результат
    buildUpdates,
  };
}
