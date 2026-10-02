/**
 * Composable для управления пошаговым мастером добавления/повышения класса.
 *
 * Формирует список шагов динамически на основе контекста:
 * - Первый класс (1 уровень): все шаги (ХП, Спасброски, Владения, Навыки, Умения, Заклинания)
 * - Level Up: ХП → Умения → Заклинания → ASI (если нужен)
 * - Мультикласс: ХП → Владения (сокращённые) → Навыки (если есть) → Умения → Заклинания
 */

import type { Ref } from 'vue';

import type { AbilityType, ProficiencyLevel, SkillType } from '@vtt/shared';
import type {
  ActiveEffect,
  ClassCounterDefinition,
  ClassDefinition,
  ClassFeature,
  ClassFeatureChoice,
  ClassFeatureSkillChoice,
  ClassOptionGrant,
  ClassSpellListOffer,
  ClassSpellListRequest,
  DnDActor,
  FeatChoice,
  FeatData,
  FeatSpellListExpansion,
  FormulaContext,
  GrantedSpellSource,
  HitPointMethod,
  ResolvedGrantedSpell,
  SpellGrantKind,
  TakenFeat,
  TakenFeatAnswers,
} from '@vtt/shared/system/dnd.js';

import type { AppliedFeatFeature, CompendiumFeat } from '../../feat/featApply';

import { computed, reactive, ref, watch } from 'vue';

import { generateId } from '@vtt/shared';
import {
  ABILITY_LABELS,
  appendGrantedSpells,
  buildCounterFormulaContext,
  buildFeatGrantEffect,
  buildTakenFeat,
  calculateProficiencyBonus,
  collectClassCounterDefinitions,
  collectClassOptionGrants,
  collectClassSpellListOffers,
  collectFeatChoiceProficiencies,
  collectFeatGrantedClassSpellRequests,
  collectFeatGrantedSpellSources,
  collectGrantedSpellSourcesForClassLevel,
  collectReferenceOptionGrants,
  COUNTER_FORMULA_TOKENS,
  counterAbilityModifierFormula,
  counterDefinitionRest,
  evaluateCounterMaxFormula,
  expandChoiceScaling,
  featChoicePendingCount,
  findScalingParentFeature,
  getAllClassFeatures,
  getClassPreparedValue,
  getMaxSpellSlotLevel,
  getMulticlassProficiencies,
  getTotalLevel,
  getVisibleFeatChoices,
  hasAbilityImprovementAtLevel,
  initialCounterCurrent,
  isAsiFeatureInClass,
  isClassOptionChoiceKey,
  isCounterOfDefinition,
  isFeatPickChoice,
  isForeignSubclassCounter,
  isReferenceClassFeatureChoices,
  isTakenFeatAnswered,
  newClassFeatureChoicesAt,
  openClassFeatureChoices,
  prepareFeatChoices,
  progressionCounterMax,
  raiseTokenDarkvision,
  refreshCounterMaxima,
  refreshFeatCounters,
  resolveChosenAbilities,
  resolveChosenDamageDefenses,
  SKILLS_LIST,
  toFeatureChoiceKeys,
  withCounterMinimum,
  withTakenFeatAnswers,
} from '@vtt/shared/system/dnd.js';

import { useFeatChoiceWeapons } from '../../../../composables/useFeatChoiceWeapons';
import { useSystemDataStore } from '../../../../stores/systemDataStore';
import {
  CLASS_EQUIPMENT_NONE_INDEX,
  CLASS_GRANT_EFFECT_PRESENTATION,
  FEATURE_OPTION_SEPARATOR,
  FEATURE_SOURCE_SEPARATOR,
} from '../../constants';
import { applyFeatToActor } from '../../feat/featApply';
import {
  buildClassEffectId,
  collectClassEffects,
  collectClassOptionEffects,
  collectFeatureEffects,
  collectSubclassEffects,
  listFeatureEffectIds,
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
  | 'classSpellList'
  | 'equipment'
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

/** Полное состояние мастера */
export interface WizardState {
  hitPoints: WizardHitPointsState;
  selectedSkills: SkillType[];
  /**
   * Навыки, выбранные самим умением («Эксперт» и подобные): ключ умения →
   * названные навыки. Отдельно от `selectedSkills`: те берут при взятии класса,
   * эти — у своего умения, и применяются они разными путями.
   *
   * По ключу умения, а не общим списком: спрашивают их в карточке своего
   * умения, и общий список смешал бы ответы двух умений одного уровня.
   */
  selectedFeatureSkills: Record<string, SkillType[]>;
  /**
   * Выбранный вариант стартового снаряжения; `null` — не выбран,
   * `CLASS_EQUIPMENT_NONE_INDEX` — выбран явный отказ. Снаряжение берут только
   * при взятии класса на 1 уровне.
   */
  selectedEquipmentIndex: number | null;
  subclassKey: string | null;
  /**
   * Варианты умений, выбранные ПРЯМО СЕЙЧАС: ключ умения → ключи вариантов.
   *
   * Список, а не один ключ: из выбираемого списка берут столько, сколько
   * назначила настройка выбора, и на втором уровне колдун берёт два воззвания
   * сразу. Взятое на прошлых уровнях лежит в записи класса на листе.
   */
  featureChoices: Record<string, string[]>;
  asi: WizardAsiState;
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
  /**
   * Ответы на СОБСТВЕННЫЕ вопросы черт, которые уровень кладёт на лист: ключ
   * ответов черты ({@link WizardTakenFeat.answersKey}) → ответы черты.
   *
   * Отдельно от `featDataChoices`: там ответы дарам класса, а это ответы другой
   * записи — самой черты, — и лягут они на неё же. В одном словаре ключи бы
   * столкнулись: выбор характеристики у двух черт называется одинаково.
   */
  featOwnChoices: TakenFeatAnswers;
  /**
   * Как умение кладёт на лист открывшиеся списки класса: целиком либо только
   * выбранное игроком. Ключ — ключ умения; нет ответа — выбор самому.
   */
  classSpellListModes: Record<string, ClassSpellListMode>;
  /** Заклинания, выбранные из списков класса: ключ умения → id компендиума */
  classSpellListPicks: Record<string, string[]>;
}

/** Как умение кладёт на лист список класса: целиком или только выбранное */
export type ClassSpellListMode = 'all' | 'chosen';

/**
 * Режим списка класса, пока игрок не ответил: выбор самому. Весь список
 * чародея — десятки заклинаний, и класть его без спроса не стоит.
 */
export const CLASS_SPELL_LIST_DEFAULT_MODE: ClassSpellListMode = 'chosen';

/** Умение класса с указанием источника (базовый класс или подкласс) */
export interface WizardFeatureItem extends ClassFeature {
  sourceName?: string;
  isSubclass?: boolean;
}

/**
 * Черта компендиума: живёт рядом с применением черты — пикером её выбирают и
 * мастер класса, и мастер вида.
 */
export type { CompendiumFeat };

/**
 * Выбор вариантов одного умения на этом уровне: что предлагают, сколько берут
 * и что уже взято раньше.
 */
export interface WizardFeatureChoicePick {
  /** Ключ умения, чьи варианты выбирают */
  featureKey: string;
  /** Название умения — им подписаны записи на листе */
  featureName: string;
  /** Подпись выбора: своя у настройки, иначе название умения */
  label: string;
  /** Название класса или подкласса, откуда умение */
  sourceName: string;
  /** Умение подкласса: от этого зависит подпись источника на листе */
  isSubclass: boolean;
  /** Сколько НОВЫХ вариантов берут на этом уровне */
  count: number;
  /** Что предлагают выбрать сейчас */
  options: ClassFeatureChoice[];
  /** Взятые на прошлых уровнях варианты — показываются занятыми */
  taken: ClassFeatureChoice[];
  /** Умение выдаётся прямо сейчас: выбор показывается в его карточке */
  isGainedNow: boolean;
}

/**
 * Вариант справочного списка, чья механика ложится на лист этим уровнем.
 *
 * Из справочного списка не выбирают, поэтому вопроса у такого варианта нет —
 * есть только запись на листе с его дарами и эффектами.
 */
interface WizardReferenceOption {
  /** Дары варианта: по ним собирается его запись на листе */
  grant: ClassOptionGrant;
  /** Название умения — им начинается название записи варианта */
  featureName: string;
  /** Уровень получения умения */
  featureLevel: number;
  /** Описание умения — для строки уровня, если умение получено раньше */
  featureDescription: string;
  /** Название класса или подкласса, откуда умение */
  sourceName: string;
  /** Умение подкласса: от этого зависит подпись источника на листе */
  isSubclass: boolean;
  /** Умение выдаётся прямо сейчас; нет — вариант добирается к полученному */
  isGainedNow: boolean;
}

/** Выбор черты умения уровня вместе с названием умения-источника */
export interface WizardFeatPick {
  choice: FeatChoice;
  sourceName: string;
}

/**
 * Черта, которую уровень кладёт на лист, вместе с её собственными вопросами:
 * взятая вместо повышения характеристик, выбранная в умении или выданная
 * дарами без выбора. Без ответов она легла бы на лист пустой.
 */
export interface WizardTakenFeat extends TakenFeat<CompendiumFeat> {
  /**
   * Строка уровня, в которой черту взяли: там же спрашиваются её вопросы.
   * `null` — черта вместо повышения характеристик, её спрашивает свой шаг.
   */
  rowKey: string | null;
}

/**
 * Строка уровня: карточка умения со всем, что оно спрашивает и даёт.
 *
 * Всё, о чём спрашивает уровень, лежит в строке того, кто спрашивает: игрок
 * читает умение и тут же отвечает на его вопрос. Раньше вопросы стояли
 * порознь — варианты в карточке, дары общим списком внизу, навык умения вовсе
 * отдельным шагом, — и связать вопрос с умением было не по чему.
 */
export interface WizardLevelRow {
  /** Ключ строки: ключ умения либо ключ самой записи класса или подкласса */
  key: string;
  /** Название умения или записи */
  name: string;
  /** Уровень получения умения; у строки записи — берущийся уровень */
  level: number;
  /** Описание умения; у строки записи пусто */
  description: string;
  /** Название класса или подкласса, откуда умение */
  sourceName: string;
  /** Умение подкласса: от этого зависит цвет подписи источника */
  isSubclass: boolean;
  /** Строка не умения, а самой записи: класс и подкласс дают дары и сами */
  isOwnGrants: boolean;
  /**
   * Умение получено раньше, а выбор к нему открылся сейчас: воззвания колдун
   * добирает на 2, 5, 7 и дальше, а само умение получил на первом уровне.
   */
  isReopened: boolean;
  /** Выбор вариантов умения; null — вариантов умение не предлагает */
  pick: WizardFeatureChoicePick | null;
  /**
   * Варианты справочного списка умения — показываются для чтения, без выбора.
   * Пусто — списка нет либо из него выбирают ({@link pick}).
   */
  referenceChoices: ClassFeatureChoice[];
  /**
   * Названия вариантов справочного списка, чья механика ложится на лист этим
   * уровнем: игроку видно, что появится на листе без его выбора.
   */
  referenceGrantNames: string[];
  /** Выборы даров: и свои, и вопросы взятых вариантов */
  choices: FeatChoice[];
  /** Выборы черты: пул из компендиума черт, поэтому пикер у них свой */
  featPicks: FeatChoice[];
  /** Взятые в этой строке черты, которым есть что спросить */
  featQuestions: WizardTakenFeat[];
  /** Навык от самого умения (легаси-поле записи); null — не спрашивает */
  skillChoice: ClassFeatureSkillChoice | null;
}

/**
 * Выбор, открывшийся на этом уровне у полученного раньше: у умения прошлых
 * уровней либо у самой записи класса или подкласса.
 */
interface ReopenedChoiceSource {
  /** Умение-владелец; null — выборы самой записи */
  feature: WizardFeatureItem | null;
  /** Ключ строки уровня, в которой выбор спрашивается */
  rowKey: string;
  /** Название умения или записи */
  name: string;
  /** Название класса или подкласса */
  sourceName: string;
  isSubclass: boolean;
  /** Сами выборы этого уровня */
  choices: FeatChoice[];
}

// ── Константы ─────────────────────────────────────────────────

/** Все шаги с метаданными */
const STEP_DEFINITIONS: Record<WizardStepKey, Omit<WizardStepItem, 'value'>> = {
  hitPoints: { title: 'Очки здоровья' },
  savingThrows: { title: 'Спасброски' },
  proficiencies: { title: 'Владения' },
  skills: { title: 'Навыки' },
  features: { title: 'Умения' },
  classSpellList: { title: 'Заклинания' },
  equipment: { title: 'Снаряжение' },
  asi: { title: 'Характеристики' },
};

/**
 * Приставка ключа строки, за которой стоит сама запись класса или подкласса, а
 * не умение: их ключи лежат в одном пространстве, и запись с ключом умения
 * иначе заняла бы его строку.
 */
const OWN_GRANTS_ROW_PREFIX = 'own:';

/**
 * Откуда уровень берёт черту — начало ключа её ответов. Места разведены:
 * одна и та же черта, взятая в умении и вместо повышения характеристик,
 * отвечает на свои вопросы дважды и по-разному.
 */
const TAKEN_FEAT_PLACE = {
  /** Вместо повышения характеристик */
  asi: 'asi',
  /** Выбором черты в умении: дальше идёт ключ выбора */
  pick: 'pick:',
  /** Дарами записи без выбора: дальше идёт ключ строки уровня */
  grant: 'grant:',
} as const;

/** Разделитель ключа ответов взятой черты: место и сама черта */
const TAKEN_FEAT_KEY_SEPARATOR = '::';

/**
 * Источник записи умения на листе (`grantedBy`): класс, а у умения подкласса —
 * ещё и подкласс. Название класса обязано остаться в строке: по нему удаление
 * класса находит свои умения.
 *
 * @param className - название класса
 * @param isSubclass - умение подкласса
 * @param sourceName - название подкласса-источника
 * @returns подпись источника записи
 */
function featureGrantedBy(
  className: string,
  isSubclass: boolean,
  sourceName?: string,
): string {
  return isSubclass && sourceName
    ? `${className}${FEATURE_SOURCE_SEPARATOR}${sourceName}`
    : className;
}

/**
 * Помечает выдачу уровня выдачей умения класса: колонки таблицы класса
 * считают только её.
 *
 * @param grant - источник или запрос выдачи
 * @returns тот же источник с видом выдачи
 */
function asClassGrant<T extends { grantKind?: SpellGrantKind }>(grant: T): T {
  return { ...grant, grantKind: grant.grantKind ?? 'class' };
}

/**
 * Помечает выдачу черты, взятой уровнем: её заклинания идут сверх колонок
 * таблицы класса.
 *
 * @param grant - источник или запрос выдачи
 * @returns тот же источник с видом выдачи
 */
function asFeatGrant<T extends { grantKind?: SpellGrantKind }>(grant: T): T {
  return { ...grant, grantKind: grant.grantKind ?? 'feat' };
}

/**
 * Блоб даров умения класса без выдачи, которую ведут поля самого умения.
 *
 * Перечень выдаёт `grantedSpells`/`grantedSpellsByLevel` умения по уровню
 * КЛАССА, а в блобе лежит его копия с отметками подготовки: выданная блобом, она
 * открывалась бы по уровню персонажа, и у мультикласса заклинания домена
 * приходили бы раньше срока. Списки классов спрашивает свой шаг мастера — из
 * блоба они легли бы на лист без спроса.
 *
 * @param featData - дары умения
 * @returns дары без перечня и списков классов
 */
function withoutFeatureSpellGrants(featData: FeatData): FeatData {
  const {
    grantedSpells: _grantedSpells,
    grantedClassSpells: _grantedClassSpells,
    ...rest
  } = featData;

  return rest;
}

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

/**
 * Слова формулы максимума из редактора класса прежних лет: тогда её набирали
 * руками и своими словами, а не выбирали источник списком.
 */
const LEGACY_COUNTER_FORMULAS = {
  level: 'level',
  charismaModifier: 'chaMod',
} as const;

/**
 * Токен общего уровня в формуле — целиком, а не куском `@classLevel`.
 *
 * Без границы слова замена съела бы начало уже правильного токена; регистр не
 * важен, потому что формулу пишет автор записи, а не форма.
 */
const LEVEL_TOKEN_PATTERN = new RegExp(
  `${COUNTER_FORMULA_TOKENS.level}\\b`,
  'gi',
);

/**
 * Формула максимума счётчика в диалекте листа (`@prof`, `@classLevel`,
 * `@mod.<abbr>`); пустая строка — максимум задан прогрессией по уровням.
 *
 * Компендиум TTG Club пишет формулу сразу в этом диалекте, а класс, собранный
 * в редакторе системы, — своими словами прежних лет (`level`, `chaMod`,
 * `level * 5`). Перевод здесь один на оба случая: считать формулу дальше умеет
 * только движок листа, и второй его разбор разошёлся бы с первым.
 *
 * Уровень на выходе всегда классовый (`@classLevel`, см.
 * {@link toClassLevelFormula}): формула едет на лист, а там общий `@level`
 * означал бы сумму уровней мультиклассера.
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
    return COUNTER_FORMULA_TOKENS.classLevel;
  }

  if (formula === LEGACY_COUNTER_FORMULAS.charismaModifier) {
    return counterAbilityModifierFormula('charisma');
  }

  const multiplyMatch = /^level\s*\*\s*(\d+)$/.exec(formula);

  const dialect = multiplyMatch
    ? `${COUNTER_FORMULA_TOKENS.classLevel} * ${multiplyMatch[1]}`
    : formula;

  return toClassLevelFormula(dialect);
}

/**
 * Называет уровень классового ресурса своим именем: `@level` → `@classLevel`.
 *
 * У ресурса класса «уровень» всегда классовый — так его и считает мастер, кладя
 * в контекст формул уровень В ЭТОМ классе. Пока формула жила только внутри
 * мастера, разницы не было; теперь она едет на лист, где общий `@level` означал
 * бы сумму уровней мультиклассера, — и очки чародейства чародея 3 / плута 3
 * выросли бы до шести.
 *
 * Записи компендиума TTG Club уже написаны через `@classLevel`; перевод нужен
 * самодельным классам и записям прежних лет.
 *
 * @param formula - формула в диалекте листа
 * @returns та же формула с уровнем своего класса
 */
function toClassLevelFormula(formula: string): string {
  return formula.replace(
    LEVEL_TOKEN_PATTERN,
    COUNTER_FORMULA_TOKENS.classLevel,
  );
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
 * Сливает выбранные сейчас варианты с уже взятыми на прошлых уровнях.
 *
 * Именно сливает, а не заменяет: воззвания добираются уровень за уровнем, и
 * запись, перезаписанная новыми ключами, потеряла бы взятое раньше. Записи
 * старого вида, где ключ лежит строкой, читаются тем же разбором.
 *
 * @param stored - выборы из записи класса на листе
 * @param added - выборы этого уровня
 * @returns выборы умений после уровня
 */
function mergeFeatureChoices(
  stored: Record<string, string[]>,
  added: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};

  for (const [featureKey, keys] of Object.entries(stored ?? {})) {
    merged[featureKey] = toFeatureChoiceKeys(keys);
  }

  for (const [featureKey, keys] of Object.entries(added)) {
    const before = merged[featureKey] ?? [];

    merged[featureKey] = [
      ...before,
      ...keys.filter((key) => !before.includes(key)),
    ];
  }

  return merged;
}

/**
 * Состояние мастера класса: шаги взятия уровня, ответы игрока и применение
 * выбранного на лист.
 *
 * @param classDefinition - взятый класс; `null` — мастеру нечего спрашивать
 * @param actor - персонаж, которому уровень достанется
 * @param isOpen - открыто ли окно мастера: на закрытии состояние сбрасывается
 * @param compendiumFeats - черты компендиума для выборов черты
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
  /** Пак записи класса — ложится на запись актора, см. `ActorClassEntry.packId` */
  packId: Ref<string | undefined> = ref(undefined),
) {
  // ── Контекст ──────────────────────────────────────────────

  /** Виды оружия мира — пул выбора оружия и оружейного приёма */
  const { weaponOptions } = useFeatChoiceWeapons();

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
    selectedFeatureSkills: {},
    selectedEquipmentIndex: null,
    subclassKey: null,
    featureChoices: {},
    asi: {
      mode: 'asi',
      abilityIncreases: {},
      featKey: null,
    },
    toolProficiencies: [],
    featDataChoices: {},
    featOwnChoices: {},
    classSpellListModes: {},
    classSpellListPicks: {},
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

  /**
   * Умения класса и его подклассов одним списком: по ним ступень роста находит
   * своё умение — флаги живут у него, а не у неё. Список пересобирается со
   * сменой класса, а не на каждое умение уровня.
   */
  const allClassFeatures = computed<ClassFeature[]>(() => {
    const classDef = classDefinition.value;

    return classDef ? getAllClassFeatures(classDef) : [];
  });

  /** Умения, доступные на текущем уровне */
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

    // Добавляем умения подкласса, если он выбран
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
   * Умения класса и активного подкласса со своим источником: по ним ищут и
   * выбор вариантов, и варианты справочных списков.
   */
  const featureSources = computed(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const subclassDef = activeSubclass.value;

    return [
      {
        features: classDef.features,
        sourceName: classDef.name,
        isSubclass: false,
      },
      ...(subclassDef
        ? [
            {
              features: subclassDef.features,
              sourceName: subclassDef.name,
              isSubclass: true,
            },
          ]
        : []),
    ];
  });

  /**
   * Выборы вариантов умений на этом уровне: и у умений, которые выдаются
   * сейчас, и у выданных раньше — у колдуна воззвания добираются на 2, 5, 7 и
   * дальше, а само умение он получил на первом уровне.
   *
   * Уже взятые варианты из предложения уходят: второй раз одно и то же
   * воззвание не берут. Остаются только помеченные повторяемыми — их для того
   * и помечают.
   */
  const featureChoicePicks = computed((): WizardFeatureChoicePick[] => {
    const level = nextLevel.value;
    const gainedKeys = new Set(levelFeatures.value.map((entry) => entry.key));
    const picks: WizardFeatureChoicePick[] = [];

    for (const source of featureSources.value) {
      for (const feature of source.features) {
        const takenKeys = new Set(
          toFeatureChoiceKeys(
            currentClassEntry.value?.featureChoices?.[feature.key],
          ),
        );

        const options = (openClassFeatureChoices(feature, level) ?? []).filter(
          (choice) => choice.repeatable || !takenKeys.has(choice.key),
        );

        // Предложить больше, чем осталось в списке, нельзя: иначе шаг требовал
        // бы недостижимого числа и не пускал игрока дальше
        const count = Math.min(
          newClassFeatureChoicesAt(feature, level),
          options.length,
        );

        if (!count) {
          continue;
        }

        picks.push({
          featureKey: feature.key,
          featureName: feature.name,
          label: feature.choiceConfig?.label || feature.name,
          sourceName: source.sourceName,
          isSubclass: source.isSubclass,
          count,
          options,
          taken: (feature.choices ?? []).filter((choice) =>
            takenKeys.has(choice.key),
          ),
          isGainedNow: gainedKeys.has(feature.key),
        });
      }
    }

    return picks;
  });

  /**
   * Выбранные варианты умения по его ключу — в порядке списка вариантов.
   *
   * @param featureKey - ключ умения
   * @returns выбранные прямо сейчас варианты
   */
  function selectedChoicesFor(featureKey: string): ClassFeatureChoice[] {
    const pick = featureChoicePicks.value.find(
      (entry) => entry.featureKey === featureKey,
    );

    if (!pick) {
      return [];
    }

    const selectedKeys = wizardState.featureChoices[featureKey] ?? [];

    return pick.options.filter((choice) => selectedKeys.includes(choice.key));
  }

  /**
   * Дары вариантов, выбранных прямо сейчас: и у умений, которые выдаются на
   * этом уровне, и у добора вариантов к умениям прошлых уровней.
   *
   * Только выбранных: вариант, от которого игрок отказался, листу ничего не
   * даёт, и его вопросы задавать некому — ответ на них так и остался бы пустым.
   * Ключи выборов при этом сужаются до области варианта, иначе два манёвра со
   * своим «выбери навык» слились бы в один вопрос на двоих.
   */
  const selectedOptionGrants = computed<ClassOptionGrant[]>(() =>
    featureChoicePicks.value.flatMap((pick) =>
      // Варианты берутся из самого предложения, а не поиском умения по ключу:
      // ключ умения уникален не всегда — у класса с сайта умение класса и
      // умение подкласса носят один ключ («Таинственные воззвания» повторены на
      // странице покровителя), — и поиск отдавал бы вторую запись, у которой
      // вариантов нет вовсе. Предложение же собрано из того самого умения,
      // которое игрок сейчас и видит
      collectClassOptionGrants(
        { key: pick.featureKey, choices: pick.options },
        selectedChoicesFor(pick.featureKey).map((choice) => choice.key),
      ),
    ),
  );

  /** Дары выбранных вариантов по ключу «умение:вариант» — их ищет сборка записей. */
  const optionGrantByKey = computed(() => {
    const byKey = new Map<string, ClassOptionGrant>();

    for (const grant of selectedOptionGrants.value) {
      byKey.set(`${grant.featureKey}:${grant.optionKey}`, grant);
    }

    return byKey;
  });

  /**
   * Варианты справочных списков, чья механика ложится на лист этим уровнем.
   *
   * Из справочного списка не выбирают, и «выбранных» у него нет — а механика у
   * вариантов бывает: мутации «Трансмутационного метаболизма» включаются за
   * порцию. Владельцу умения она достаётся вся: каждый открытый вариант со
   * своей механикой получает запись на листе, как получил бы выбранный.
   *
   * Берётся всё, чего на листе ещё нет, а не только открывшееся ровно сейчас:
   * так вариант со своим уровнем доступа приходит на своём уровне, а персонаж,
   * собранный до 0.8.192 (тогда из такого списка спрашивали один вариант),
   * добирает остальные на следующем повышении уровня. Запись, которая уже
   * лежит на листе, второй раз не кладётся и своих вопросов не повторяет.
   */
  const referenceOptions = computed<WizardReferenceOption[]>(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const level = nextLevel.value;
    const sheetFeatures = actor.value.features ?? [];

    return featureSources.value.flatMap((source) => {
      const grantedBy = featureGrantedBy(
        classDef.name,
        source.isSubclass,
        source.sourceName,
      );

      return source.features.flatMap((feature) => {
        const isGainedNow = levelFeatures.value.some(
          (entry) =>
            entry.key === feature.key
            && (entry.isSubclass ?? false) === source.isSubclass,
        );

        return collectReferenceOptionGrants(feature, level)
          .filter((grant) => {
            const recordName = `${feature.name}${FEATURE_OPTION_SEPARATOR}${grant.name}`;

            return !sheetFeatures.some(
              (existing) =>
                existing.name === recordName
                && existing.grantedBy === grantedBy,
            );
          })
          .map((grant) => ({
            grant,
            featureName: feature.name,
            featureLevel: feature.level,
            featureDescription: feature.description,
            sourceName: source.sourceName,
            isSubclass: source.isSubclass,
            isGainedNow,
          }));
      });
    });
  });

  /**
   * Дары всех вариантов, которые уровень кладёт на лист: выбранных игроком и
   * вариантов справочных списков. Лист применяет их одним и тем же кодом —
   * отличается только то, спрашивали ли игрока.
   */
  const levelOptionGrants = computed<ClassOptionGrant[]>(() => [
    ...selectedOptionGrants.value,
    ...referenceOptions.value.map((entry) => entry.grant),
  ]);

  /**
   * Справочные списки умений по ключу умения — их строка уровня показывает для
   * чтения. Только у полученных умений: чужой список игроку читать рано.
   */
  const referenceChoicesByFeature = computed(() => {
    const byKey = new Map<string, ClassFeatureChoice[]>();

    for (const source of featureSources.value) {
      for (const feature of source.features) {
        if (
          feature.level <= nextLevel.value
          && isReferenceClassFeatureChoices(feature)
        ) {
          byKey.set(feature.key, feature.choices ?? []);
        }
      }
    }

    return byKey;
  });

  /**
   * Ответы игрока на выборы самого класса, подкласса и их умений — поле записи
   * класса. Ответы вариантов умений сюда не идут: они лежат на записи варианта.
   * По ним эффекты умений читают выбор токеном `@choice.<ключ>` («Гримуар
   * монстров»: умения подкласса смотрят типы, выбранные в базовом классе).
   *
   * @param previous - ответы прошлых уровней
   * @returns поле `choiceAnswers` либо пусто, если ответов нет
   */
  function classChoiceAnswersField(
    previous: Record<string, string[]> | undefined,
  ): { choiceAnswers?: Record<string, string[]> } {
    const answers: Record<string, string[]> = { ...previous };

    for (const [key, values] of Object.entries(wizardState.featDataChoices)) {
      if (!isClassOptionChoiceKey(key) && values.length > 0) {
        answers[key] = [...values];
      }
    }

    return Object.keys(answers).length > 0 ? { choiceAnswers: answers } : {};
  }

  /**
   * Ответы игрока на вопросы одного варианта. Отбираются по области его ключей:
   * на запись варианта ложатся только его собственные ответы — по ним лист
   * считает максимум ресурса и держит выбор рядом с тем, кто его спросил.
   *
   * @param grant - дары выбранного варианта
   * @returns ответы варианта; пусто — вариант ни о чём не спрашивал
   */
  function optionChoiceAnswers(
    grant: ClassOptionGrant,
  ): Record<string, string[]> {
    const answers: Record<string, string[]> = {};

    for (const [key, values] of Object.entries(wizardState.featDataChoices)) {
      if (key.startsWith(grant.scope)) {
        answers[key] = values;
      }
    }

    return answers;
  }

  /**
   * Бонус мастерства персонажа после этого уровня: от него зависит количество у
   * выборов вида «столько, сколько бонус мастерства».
   */
  const featChoiceProficiencyBonus = computed(() =>
    calculateProficiencyBonus(getTotalLevel(actor.value.system.classes) + 1),
  );

  /**
   * Выборы, открывающиеся ровно на этом уровне у того, что получено раньше:
   * у умений прошлых уровней и у самой записи класса или подкласса.
   *
   * Вместе с тем, кто спрашивает: вопрос показывается в карточке своего умения,
   * и без источника его некуда положить.
   */
  const reopenedChoiceSources = computed<ReopenedChoiceSource[]>(() => {
    const classDef = classDefinition.value;
    const level = nextLevel.value;

    if (!classDef) {
      return [];
    }

    const gainedKeys = new Set(levelFeatures.value.map((entry) => entry.key));
    const subclassDef = activeSubclass.value;
    const collected: ReopenedChoiceSource[] = [];

    /**
     * Выборы записи, открывшиеся ровно этим уровнем.
     *
     * @param featData - дары записи
     * @returns выборы этого уровня; пусто — запись на нём ни о чём не спрашивает
     */
    const openedNow = (featData: FeatData | undefined): FeatChoice[] =>
      expandChoiceScaling(featData?.choices).filter(
        (choice) => choice.requiredLevel === level,
      );

    // Выборы самой записи класса и подкласса: на уровне, когда запись берут,
    // они приходят целиком вместе с дарами, а открывшиеся позже спрашиваются
    // здесь — так же, как выборы умений прошлых уровней
    const definitions = [
      ...(level > 1
        ? [
            {
              key: classDef.key,
              name: classDef.name,
              featData: classDef.featData,
              isSubclass: false,
            },
          ]
        : []),
      ...(subclassDef && !wizardState.subclassKey
        ? [
            {
              key: subclassDef.key,
              name: subclassDef.name,
              featData: subclassDef.featData,
              isSubclass: true,
            },
          ]
        : []),
    ];

    for (const definition of definitions) {
      const choices = openedNow(definition.featData);

      if (choices.length) {
        collected.push({
          feature: null,
          rowKey: `${OWN_GRANTS_ROW_PREFIX}${definition.key}`,
          name: definition.name,
          sourceName: definition.name,
          isSubclass: definition.isSubclass,
          choices,
        });
      }
    }

    const features: WizardFeatureItem[] = [
      ...classDef.features.map((feature) => ({
        ...feature,
        sourceName: classDef.name,
        isSubclass: false,
      })),
      ...(subclassDef?.features ?? []).map((feature) => ({
        ...feature,
        sourceName: subclassDef?.name,
        isSubclass: true,
      })),
    ];

    for (const feature of features) {
      if (gainedKeys.has(feature.key) || feature.isInformationalOnly) {
        continue;
      }

      const choices = openedNow(feature.featData);

      if (choices.length) {
        collected.push({
          feature,
          rowKey: feature.key,
          name: feature.name,
          sourceName: feature.sourceName ?? classDef.name,
          isSubclass: feature.isSubclass ?? false,
          choices,
        });
      }
    }

    return collected;
  });

  /**
   * Переоткрытые выборы пустыми дарами — одни выборы: умение уже выдано, и
   * повторить его владения и заклинания значило бы выдать их дважды. С
   * названием умения или записи, которая спрашивает: им подписываются
   * выбранные заклинания.
   */
  const reopenedGrantSources = computed<
    { sourceName: string; featData: FeatData }[]
  >(() =>
    reopenedChoiceSources.value.map((source) => ({
      sourceName: source.name,
      featData: { type: 'feat', choices: source.choices },
    })),
  );

  /** Переоткрытые выборы пустыми дарами — для применения на листе */
  const reopenedFeatData = computed<FeatData[]>(() =>
    reopenedGrantSources.value.map((source) => source.featData),
  );

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

    // Выбор со своим уровнем открытия ждёт своего уровня и здесь: класс даёт
    // заклинание не только умением, и «с 5 уровня» у него значит то же самое
    if (nextLevel.value === 1 && classDef.featData) {
      collected.push(openedFeatData(classDef.featData, nextLevel.value));
    }

    if (wizardState.subclassKey && activeSubclass.value?.featData) {
      collected.push(
        openedFeatData(activeSubclass.value.featData, nextLevel.value),
      );
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

    // Дары вариантов — выбранных и справочных: воззвание выдаёт заклинание,
    // манёвр — владение приёмом. Идут наравне с дарами самих умений — лист
    // применяет их одним и тем же кодом, откуда бы они ни пришли
    for (const grant of levelOptionGrants.value) {
      if (grant.featData) {
        collected.push(openedFeatData(grant.featData, nextLevel.value));
      }
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
          featData: withoutFeatureSpellGrants(
            openedFeatData(feature.featData, nextLevel.value),
          ),
        });
      }
    }

    // Варианты (выбранные и справочные) — своим источником: их эффект даров
    // подписан названием варианта, а ключ несёт и умение, и вариант, чтобы у
    // двух умений с одинаковым вариантом эффекты не слиплись
    for (const grant of levelOptionGrants.value) {
      if (grant.featData) {
        collected.push({
          sourceKey: `${grant.featureKey}:${grant.optionKey}`,
          sourceName: grant.name,
          featData: openedFeatData(grant.featData, nextLevel.value),
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
   * Выборы даров уровня, разложенные по строкам, которые их спрашивают.
   *
   * Разбор у каждой строки свой (`prepareFeatChoices`, порядок как у черты:
   * сперва список класса, потом заклинания из него, потом характеристика). Одним
   * списком на весь уровень его делать нельзя: ключи выборов уникальны внутри
   * записи, а не на уровне, и два умения со своим «выбери заговор» слились бы в
   * один вопрос на двоих.
   */
  const featChoiceGroups = computed<
    Array<{ rowKey: string; choices: FeatChoice[] }>
  >(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const level = nextLevel.value;
    const groups: Array<{ rowKey: string; choices: FeatChoice[] }> = [];

    /**
     * Добавляет выборы записи её строкой.
     *
     * @param rowKey - ключ строки уровня
     * @param choices - выборы записи
     */
    const push = (
      rowKey: string,
      choices: ReadonlyArray<FeatChoice> | undefined,
    ): void => {
      const prepared = prepareFeatChoices(choices);

      if (prepared.length) {
        groups.push({ rowKey, choices: prepared });
      }
    };

    if (level === 1 && classDef.featData) {
      push(
        `${OWN_GRANTS_ROW_PREFIX}${classDef.key}`,
        openedFeatData(classDef.featData, level).choices,
      );
    }

    const subclassDef = activeSubclass.value;

    if (wizardState.subclassKey && subclassDef?.featData) {
      push(
        `${OWN_GRANTS_ROW_PREFIX}${subclassDef.key}`,
        openedFeatData(subclassDef.featData, level).choices,
      );
    }

    for (const feature of levelFeatures.value) {
      if (!feature.isInformationalOnly && feature.featData) {
        push(feature.key, openedFeatData(feature.featData, level).choices);
      }
    }

    for (const source of reopenedChoiceSources.value) {
      push(source.rowKey, source.choices);
    }

    // Вопросы вариантов (выбранных и справочных) — в строке своего умения:
    // вариант отметили там же, и спрошенные где-то ниже они выглядели бы
    // вопросами ниоткуда
    for (const grant of levelOptionGrants.value) {
      if (grant.featData) {
        push(grant.featureKey, openedFeatData(grant.featData, level).choices);
      }
    }

    return groups;
  });

  /** Выборы даров уровня одним списком — в порядке строк, которые их спрашивают */
  const preparedFeatChoices = computed<FeatChoice[]>(() =>
    featChoiceGroups.value.flatMap((group) => group.choices),
  );

  /**
   * Ключи умений уровня с повышением характеристик: их выбор черты
   * спрашивается на шаге характеристик, а не среди даров умений.
   */
  const asiFeatureKeys = computed(
    () =>
      new Set(
        levelFeatures.value
          .filter((feature) =>
            isAsiFeatureInClass(feature, allClassFeatures.value),
          )
          .map((feature) => feature.key),
      ),
  );

  /**
   * Выборы черты по строкам — боевой стиль и подобные: спрашиваются пикером
   * компендиума, а не общими полями выбора, потому что пул у них не из
   * справочника правил.
   *
   * Выбор черты вместо повышения характеристик сюда не идёт: его спрашивает
   * шаг характеристик.
   */
  const featPicksByRow = computed<Record<string, FeatChoice[]>>(() => {
    const byRow: Record<string, FeatChoice[]> = {};

    for (const group of featChoiceGroups.value) {
      if (asiFeatureKeys.value.has(group.rowKey)) {
        continue;
      }

      const picks = group.choices.filter(isFeatPickChoice);

      if (picks.length) {
        byRow[group.rowKey] = [...(byRow[group.rowKey] ?? []), ...picks];
      }
    }

    return byRow;
  });

  /**
   * Лист с уже применённым уровнем, который берут сейчас.
   *
   * Нужен выдаче «весь список класса, не выше доступного круга»: круг такой группы
   * считается по ячейкам, а настоящий лист уровня ещё не получил — по нему список
   * отстал бы ровно на тот уровень, ради которого мастера и открыли. Ячейки —
   * единственное, что здесь считается, поэтому и подменяются только уровень класса и
   * его тип заклинательства.
   */
  const pendingActor = computed((): DnDActor => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return actor.value;
    }

    const spellcasting =
      classDef.spellcasting ?? activeSubclass.value?.spellcasting ?? null;

    const classes = [...(actor.value.system.classes ?? [])];

    const existingIndex = classes.findIndex(
      (entry) => entry.classKey === classDef.key,
    );

    if (existingIndex === -1) {
      classes.push({
        classKey: classDef.key,
        ...(packId.value ? { packId: packId.value } : {}),
        className: classDef.name,
        level: 1,
        subclassKey: wizardState.subclassKey || null,
        hitDie: classDef.hitDie,
        hitDiceUsed: 0,
        hitPointsGained: [],
        chosenSkills: [],
        featureChoices: {},
        ...(spellcasting
          ? {
              spellcastingAbility: spellcasting.ability,
              casterType: spellcasting.type,
            }
          : {}),
      });
    } else {
      classes[existingIndex] = {
        ...classes[existingIndex],
        level: nextLevel.value,
        ...(spellcasting && !classes[existingIndex].casterType
          ? { casterType: spellcasting.type }
          : {}),
      };
    }

    return {
      ...actor.value,
      system: { ...actor.value.system, classes },
    };
  });

  /**
   * Черты, которые дары уровня выдают без выбора, со строкой уровня своего
   * источника: вопросы такой черты спрашиваются в строке того, кто её дал.
   * Строки — те же, что у выборов даров ({@link featChoiceGroups}).
   */
  const grantedFeatsByRow = computed<{ rowKey: string; featId: string }[]>(
    () => {
      const classDef = classDefinition.value;

      if (!classDef) {
        return [];
      }

      const granted: { rowKey: string; featId: string }[] = [];

      /**
       * Добавляет черты, выданные записью, её строкой.
       *
       * @param rowKey - ключ строки уровня
       * @param featData - дары записи
       */
      const push = (rowKey: string, featData: FeatData | undefined): void => {
        for (const feat of featData?.grantedFeats ?? []) {
          granted.push({ rowKey, featId: feat.featId });
        }
      };

      if (nextLevel.value === 1) {
        push(`${OWN_GRANTS_ROW_PREFIX}${classDef.key}`, classDef.featData);
      }

      const subclassDef = activeSubclass.value;

      if (wizardState.subclassKey && subclassDef) {
        push(
          `${OWN_GRANTS_ROW_PREFIX}${subclassDef.key}`,
          subclassDef.featData,
        );
      }

      for (const feature of levelFeatures.value) {
        if (!feature.isInformationalOnly) {
          push(feature.key, feature.featData);
        }
      }

      for (const grant of levelOptionGrants.value) {
        push(grant.featureKey, grant.featData);
      }

      return granted;
    },
  );

  /**
   * Черты, которые уровень кладёт на лист, вместе с их собственными вопросами:
   * выбранные в умениях, взятая вместо повышения характеристик и выданные
   * дарами без выбора. Неизвестные ключи пропускаются — черта могла уехать из
   * компендиума вместе с паком.
   *
   * Вопросы — те же, что задаёт окно выбора при перетаскивании черты на лист,
   * и считаются по листу с уже взятым уровнем: им открываются ступени выборов.
   */
  const takenFeats = computed<WizardTakenFeat[]>(() => {
    const classDef = classDefinition.value;
    const taken: WizardTakenFeat[] = [];

    /**
     * Добавляет взятую черту.
     *
     * @param rowKey - строка уровня; `null` — шаг характеристик
     * @param place - откуда черта взята: часть ключа её ответов
     * @param featId - ключ черты компендиума
     */
    const push = (
      rowKey: string | null,
      place: string,
      featId: string,
    ): void => {
      const feat = compendiumFeats.value.find((entry) => entry.id === featId);

      if (feat) {
        taken.push({
          ...buildTakenFeat(
            `${place}${TAKEN_FEAT_KEY_SEPARATOR}${featId}`,
            feat,
            pendingActor.value,
          ),
          rowKey,
        });
      }
    };

    for (const [rowKey, picks] of Object.entries(featPicksByRow.value)) {
      for (const choice of picks) {
        for (const featId of wizardState.featDataChoices[choice.key] ?? []) {
          push(rowKey, `${TAKEN_FEAT_PLACE.pick}${choice.key}`, featId);
        }
      }
    }

    if (
      classDef
      && hasAbilityImprovementAtLevel(classDef, nextLevel.value)
      && wizardState.asi.mode === 'feat'
      && wizardState.asi.featKey
    ) {
      push(null, TAKEN_FEAT_PLACE.asi, wizardState.asi.featKey);
    }

    for (const granted of grantedFeatsByRow.value) {
      push(
        granted.rowKey,
        `${TAKEN_FEAT_PLACE.grant}${granted.rowKey}`,
        granted.featId,
      );
    }

    return taken;
  });

  /** Черта, взятая вместо повышения характеристик; `null` — не взята */
  const asiTakenFeat = computed<WizardTakenFeat | null>(
    () => takenFeats.value.find((taken) => taken.rowKey === null) ?? null,
  );

  /**
   * Отвечены ли собственные вопросы взятой черты. Каталог заклинаний сюда не
   * идёт: пока он не загружен, пул пуст и требование остаётся полным — так же,
   * как у выборов даров уровня.
   *
   * @param taken - взятая уровнем черта
   */
  function isFeatAnswered(taken: WizardTakenFeat): boolean {
    return isTakenFeatAnswered(
      taken,
      wizardState.featOwnChoices,
      pendingActor.value,
      { weapons: weaponOptions.value },
      featChoiceProficiencyBonus.value,
    );
  }

  /**
   * Выбор черты умения повышения характеристик: им сужается пул на шаге
   * характеристик в режиме «Взять черту». `null` — умение описано одним
   * флагом, и пул берётся по правилу листа.
   */
  const asiFeatChoice = computed<FeatChoice | null>(() => {
    const own = levelFeatDataSources.value
      .filter((source) => asiFeatureKeys.value.has(source.sourceKey))
      .flatMap((source) =>
        (source.featData.choices ?? []).filter(isFeatPickChoice),
      )[0];

    if (own) {
      return own;
    }

    // Ступень роста повышения характеристик приезжает из компендиума без даров
    // родителя: механика умения выдаётся один раз, у самого умения. Категории
    // черт при этом — правило всех его уровней, и без них пикер 8, 12 и 16
    // уровней предлагал бы любую черту вместо названных классом
    return (
      levelFeatures.value
        .filter((feature) => asiFeatureKeys.value.has(feature.key))
        .flatMap((feature) => {
          const parent = findScalingParentFeature(
            feature,
            allClassFeatures.value,
          );

          return (parent?.featData?.choices ?? []).filter(isFeatPickChoice);
        })[0] ?? null
    );
  });

  /**
   * Выборы даров по строкам, спрошенные прямо сейчас: остальные ждут ответа про
   * класс. Выбор черты сюда не входит — у него свой пикер.
   */
  const visibleChoicesByRow = computed<Record<string, FeatChoice[]>>(() => {
    const byRow: Record<string, FeatChoice[]> = {};

    for (const group of featChoiceGroups.value) {
      const visible = getVisibleFeatChoices(
        group.choices,
        wizardState.featDataChoices,
      ).filter((choice) => !isFeatPickChoice(choice));

      if (visible.length) {
        byRow[group.rowKey] = [...(byRow[group.rowKey] ?? []), ...visible];
      }
    }

    return byRow;
  });

  /** Все спрошенные сейчас выборы даров уровня — для проверки готовности шага */
  const visibleFeatChoices = computed<FeatChoice[]>(() =>
    Object.values(visibleChoicesByRow.value).flat(),
  );

  /**
   * Строки уровня: карточка на каждое умение, которое уровень выдаёт или у
   * которого сейчас открылся выбор, и отдельная строка под дары самой записи —
   * класса и подкласса.
   *
   * Всё, о чём строка спрашивает, лежит в ней самой: игрок читает умение и тут
   * же отвечает, а не ищет вопрос где-то под списком.
   */
  const levelRows = computed<WizardLevelRow[]>(() => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const level = nextLevel.value;
    const picks = featureChoicePicks.value;
    const rows: WizardLevelRow[] = [];

    /**
     * Собирает строку и отбрасывает пустую: строка без описания, выборов и
     * дальнейших вопросов ничего игроку не говорит.
     *
     * @param row - заготовка строки без выборов
     */
    const push = (
      row: Omit<
        WizardLevelRow,
        | 'pick'
        | 'referenceChoices'
        | 'referenceGrantNames'
        | 'choices'
        | 'featPicks'
        | 'featQuestions'
      >,
    ): void => {
      const pick = picks.find((entry) => entry.featureKey === row.key) ?? null;

      const referenceChoices =
        referenceChoicesByFeature.value.get(row.key) ?? [];

      const referenceGrantNames = referenceOptions.value
        .filter((entry) => entry.grant.featureKey === row.key)
        .map((entry) => entry.grant.name);

      const choices = visibleChoicesByRow.value[row.key] ?? [];
      const featPicks = featPicksByRow.value[row.key] ?? [];

      // Черта, выданная дарами записи без выбора, тоже спрашивает своё — и
      // спросить её больше негде, кроме строки того, кто её дал
      const featQuestions = takenFeats.value.filter(
        (taken) => taken.rowKey === row.key && taken.ownChoices.length > 0,
      );

      if (
        row.isOwnGrants
        && !choices.length
        && !featPicks.length
        && !featQuestions.length
        && !row.skillChoice
      ) {
        return;
      }

      rows.push({
        ...row,
        pick,
        referenceChoices,
        referenceGrantNames,
        choices,
        featPicks,
        featQuestions,
      });
    };

    for (const feature of levelFeatures.value) {
      push({
        key: feature.key,
        name: feature.name,
        level: feature.level,
        description: feature.description,
        sourceName: feature.sourceName ?? classDef.name,
        isSubclass: feature.isSubclass ?? false,
        isOwnGrants: false,
        isReopened: false,
        skillChoice: feature.skillChoice ?? null,
      });
    }

    // Умения прошлых уровней, у которых выбор открылся сейчас: своей карточкой,
    // а не общим блоком снизу — у колдуна воззвания добираются на 2, 5, 7, и
    // спрашивать их надо там же, где он их получил
    for (const source of reopenedChoiceSources.value) {
      if (!source.feature) {
        continue;
      }

      push({
        key: source.rowKey,
        name: source.name,
        level: source.feature.level,
        description: source.feature.description,
        sourceName: source.sourceName,
        isSubclass: source.isSubclass,
        isOwnGrants: false,
        isReopened: true,
        skillChoice: null,
      });
    }

    // Добор вариантов у умения, которое ни выдаётся сейчас, ни открывает выбор
    // даров: воззвания описаны вариантами умения, а не его дарами
    for (const pick of picks) {
      if (rows.some((row) => row.key === pick.featureKey)) {
        continue;
      }

      const feature = allClassFeatures.value.find(
        (entry) => entry.key === pick.featureKey,
      );

      push({
        key: pick.featureKey,
        name: pick.featureName,
        level: feature?.level ?? level,
        description: feature?.description ?? '',
        sourceName: pick.sourceName,
        isSubclass: pick.isSubclass,
        isOwnGrants: false,
        isReopened: !pick.isGainedNow,
        skillChoice: null,
      });
    }

    // Варианты справочного списка, добираемые к умению прошлых уровней: своей
    // строкой, иначе вопросы их даров спросить было бы негде, а игрок не узнал
    // бы, что на листе прибавилось записей
    for (const entry of referenceOptions.value) {
      if (rows.some((row) => row.key === entry.grant.featureKey)) {
        continue;
      }

      push({
        key: entry.grant.featureKey,
        name: entry.featureName,
        level: entry.featureLevel,
        description: entry.featureDescription,
        sourceName: entry.sourceName,
        isSubclass: entry.isSubclass,
        isOwnGrants: false,
        isReopened: false,
        skillChoice: null,
      });
    }

    // Дары самой записи класса и подкласса — последними: их даёт не умение, и
    // стоять они должны не среди умений, а под ними
    push({
      key: `${OWN_GRANTS_ROW_PREFIX}${classDef.key}`,
      name: classDef.name,
      level,
      description: '',
      sourceName: classDef.name,
      isSubclass: false,
      isOwnGrants: true,
      isReopened: false,
      skillChoice: null,
    });

    const subclassDef = activeSubclass.value;

    if (subclassDef) {
      push({
        key: `${OWN_GRANTS_ROW_PREFIX}${subclassDef.key}`,
        name: subclassDef.name,
        level,
        description: '',
        sourceName: subclassDef.name,
        isSubclass: true,
        isOwnGrants: true,
        isReopened: false,
        skillChoice: null,
      });
    }

    return rows;
  });

  /**
   * Выборы черты уровня со своим умением-источником: их пул грузится из
   * компендиума черт, и мастер сверяет по ним готовность шага.
   */
  const featPickChoices = computed<WizardFeatPick[]>(() =>
    levelRows.value.flatMap((row) =>
      row.featPicks.map((choice) => ({ choice, sourceName: row.sourceName })),
    ),
  );

  /**
   * Все выборы уровня отвечены — без этого шаг умений не пройти.
   *
   * Требуемое число режется по пулу: «выберите три» из двух перечисленных в
   * записи заклинаний иначе запирало бы шаг намертво. Пул, который ещё не
   * загружен (каталог заклинаний в пути), не режет — он пуст, и требование
   * остаётся полным.
   */
  const areFeatChoicesComplete = computed(
    () =>
      visibleFeatChoices.value.every(
        (choice) =>
          featChoicePendingCount(
            choice,
            actor.value,
            {
              selections: wizardState.featDataChoices,
              weapons: weaponOptions.value,
            },
            featChoiceProficiencyBonus.value,
            wizardState.featDataChoices,
          ) === 0,
      )
      && featPickChoices.value.every(
        ({ choice }) =>
          (wizardState.featDataChoices[choice.key] ?? []).length > 0,
      ),
  );

  /**
   * Записи компендиума для взятых уровнем черт — уже с ответами игрока на их
   * собственные вопросы: применяет их тот же код, что и черту, перетащенную на
   * лист, и без ответов «Телекинетик» лёг бы без прибавки и характеристики.
   */
  const chosenCompendiumFeats = computed<CompendiumFeat[]>(() =>
    takenFeats.value.map((taken) =>
      withTakenFeatAnswers(taken, wizardState.featOwnChoices),
    ),
  );

  /**
   * Выборы уровня и собственные выборы взятых им черт одним списком — по нему
   * грузится каталог заклинаний для полей выбора.
   */
  const allPreparedFeatChoices = computed<FeatChoice[]>(() => [
    ...preparedFeatChoices.value,
    ...takenFeats.value.flatMap((taken) => taken.ownChoices),
  ]);

  /** Навыки, названные умениями этого уровня, одним списком */
  const chosenFeatureSkills = computed<SkillType[]>(() =>
    Object.values(wizardState.selectedFeatureSkills).flat(),
  );

  /** У каждого умения набрано столько навыков, сколько оно просит */
  const areFeatureSkillsComplete = computed(() =>
    levelRows.value.every(
      (row) =>
        !row.skillChoice
        || (wizardState.selectedFeatureSkills[row.key] ?? []).length
          >= row.skillChoice.count,
    ),
  );

  /**
   * Выбранный вариант стартового снаряжения. Нет варианта — он не выбран или
   * выбран отказ; тогда мастер не трогает ни инвентарь, ни кошелёк.
   */
  const selectedEquipmentOption = computed(() => {
    const index = wizardState.selectedEquipmentIndex;

    if (index === null || index === CLASS_EQUIPMENT_NONE_INDEX) {
      return undefined;
    }

    return classDefinition.value?.startingEquipment?.[index];
  });

  /** Позиции выбранного варианта; пусто — класть в инвентарь нечего */
  const selectedEquipmentItems = computed(
    () => selectedEquipmentOption.value?.items ?? [],
  );

  /** Золото выбранного варианта: «150 зм» вместо снаряжения или сдача к нему */
  const selectedEquipmentCoins = computed(
    () => selectedEquipmentOption.value?.coins ?? 0,
  );

  /**
   * Заклинания, автоматически предоставляемые умениями на получаемом уровне:
   * `grantedSpells` умений этого уровня плюс `grantedSpellsByLevel` ранее
   * полученных умений (поуровневые списки доменов/клятв/покровителей).
   * Подготовка и её исключения определяются источником выдачи.
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
      // Заклинания из блоков даров уровня — класса, подкласса, умений и
      // выбранных вариантов: и выданные без выбора, и названные самим игроком
      // («Договор Гримуара» даёт выбрать три заговора). Тем же кодом, что у
      // черты: набор даров у них общий, и второй разбор разошёлся бы с первым.
      // Повтор с заклинаниями умения выше не страшен — лист отсеивает их по
      // названию.
      // Вместе с ними — выборы прошлых умений и самой записи класса,
      // открывшиеся этим уровнем: «ещё два заклинания в книгу» волшебника
      // спрашивается именно так. Без них мастер показывал вопрос, а ответ на
      // лист не доходил — игрок добирал заклинания вручную.
      // Уровень доступа сверяется по листу С НОВЫМ уровнем: выбор, открытый
      // ровно этим уровнем, по старому листу считался бы ещё закрытым
      ...[...levelFeatDataSources.value, ...reopenedGrantSources.value].flatMap(
        (source) =>
          collectFeatGrantedSpellSources(
            {
              name: source.sourceName,
              featData: source.featData,
              choices: wizardState.featDataChoices,
            },
            pendingActor.value,
          ).map(asClassGrant),
      ),
      ...chosenCompendiumFeats.value.flatMap((feat) =>
        collectFeatGrantedSpellSources(feat, pendingActor.value).map(
          asFeatGrant,
        ),
      ),
    ].map((source) => ({
      ...source,
      // Копия заклинания — из пака самой записи класса, если источник не
      // назвал свой: одноимённые копии из соседних компендиумов остаются за бортом
      packId: source.packId ?? packId.value,
    }));
  });

  /**
   * Запросы «выдать весь список класса» от записей этого уровня: класса, подкласса,
   * умений и выбранных вариантов, а также взятых уровнем черт.
   *
   * Заклинаний они не называют — их подбирает резолвер по загруженному компендиуму.
   */
  const grantedClassSpellRequests = computed((): ClassSpellListRequest[] =>
    [
      ...levelFeatDataSources.value.flatMap((source) =>
        collectFeatGrantedClassSpellRequests(
          {
            name: source.sourceName,
            featData: source.featData,
            choices: wizardState.featDataChoices,
          },
          pendingActor.value,
        ).map(asClassGrant),
      ),
      ...chosenCompendiumFeats.value.flatMap((feat) =>
        collectFeatGrantedClassSpellRequests(feat, pendingActor.value).map(
          asFeatGrant,
        ),
      ),
    ].map((request) => ({
      ...request,
      // Список класса собирается из пака самой записи класса: при повторе
      // заклинания побеждает его копия, а не первая по порядку паков
      preferredPackId: request.preferredPackId ?? packId.value,
    })),
  );

  /**
   * Списки классов, которые умения открывают этим уровнем: мастер спрашивает по
   * каждому умению, класть список целиком или выбрать из него самому.
   *
   * Круг «по ячейкам» сравнивается до и после уровня: новый круг ячеек снова
   * открывает такой список, хотя его умение получено давно.
   */
  const classSpellListOffers = computed((): ClassSpellListOffer[] => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return [];
    }

    const offers = collectClassSpellListOffers(
      [...classDef.features, ...(activeSubclass.value?.features ?? [])],
      nextLevel.value,
      {
        before: getMaxSpellSlotLevel(actor.value),
        after: getMaxSpellSlotLevel(pendingActor.value),
      },
    );

    // Список класса собирается из пака самой записи класса — как и остальная
    // выдача мастера
    return offers.map((offer) => ({
      ...offer,
      requests: offer.requests.map((request) => ({
        ...request,
        preferredPackId: request.preferredPackId ?? packId.value,
      })),
    }));
  });

  /**
   * Сколько заклинаний этот класс готовит на получаемом уровне по своей
   * таблице — подсказка к выбору из списка класса. null — колонки нет.
   */
  const preparedSpellsAtLevel = computed((): number | null => {
    const classDef = classDefinition.value;

    if (!classDef) {
      return null;
    }

    return getClassPreparedValue(
      (pendingActor.value.system.classes ?? []).filter(
        (entry) => entry.classKey === classDef.key,
      ),
      () => classDef,
      'spells',
    );
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
      // Первый класс: Спасброски → Владения → Навыки → Умения → Заклинания
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

    // Умения — если уровень выдаёт умение, спрашивает подкласс либо открывает
    // выбор у чего-то полученного раньше: у колдуна на 5 уровне новых умений
    // нет вовсе, а воззваний становится пять вместо трёх, и без шага мастер
    // молча уводил игрока с уровня без двух положенных воззваний
    if (levelRows.value.length > 0 || hasSubclassSelection.value) {
      steps.push({ value: 'features', ...STEP_DEFINITIONS.features });
    }

    // Списки класса — после умений: подкласс, выбранный там, сам может открыть
    // свой список
    if (classSpellListOffers.value.length > 0) {
      steps.push({
        value: 'classSpellList',
        ...STEP_DEFINITIONS.classSpellList,
      });
    }

    // Стартовое снаряжение берут один раз — при взятии класса на 1 уровне
    if (isFirstClass.value && (classDef.startingEquipment?.length ?? 0) > 0) {
      steps.push({ value: 'equipment', ...STEP_DEFINITIONS.equipment });
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
      case 'features': {
        if (hasSubclassSelection.value && !wizardState.subclassKey) {
          return false;
        }

        // У каждого выбора вариантов набрано ровно столько, сколько берут на
        // этом уровне: недобор увёл бы игрока с уровня без положенного
        const variantsChosen = featureChoicePicks.value.every(
          (pick) => selectedChoicesFor(pick.featureKey).length === pick.count,
        );

        // Дары уровня спрашивают своё: без ответа игрок ушёл бы с уровня, не
        // получив того, что умение выдаёт
        return (
          variantsChosen
          && areFeatChoicesComplete.value
          && areFeatureSkillsComplete.value
          // Черта, взятая в умении, спрашивает своё здесь же
          && takenFeats.value
            .filter((taken) => taken.rowKey !== null)
            .every(isFeatAnswered)
        );
      }
      case 'asi': {
        if (wizardState.asi.mode === 'feat') {
          // Черта выбрана и на её собственные вопросы отвечено: окно выбора
          // у перетащенной черты обязательно, и здесь правило то же
          return (
            asiTakenFeat.value !== null && isFeatAnswered(asiTakenFeat.value)
          );
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
    wizardState.selectedFeatureSkills = {};
    wizardState.selectedEquipmentIndex = null;
    wizardState.subclassKey = null;
    wizardState.featureChoices = {};
    wizardState.featDataChoices = {};
    wizardState.featOwnChoices = {};
    wizardState.asi = { mode: 'asi', abilityIncreases: {}, featKey: null };
    wizardState.toolProficiencies = [];
    wizardState.classSpellListModes = {};
    wizardState.classSpellListPicks = {};
  }

  // Класс приходит и ПОСЛЕ открытия: мастер открывается со скелетоном, пока
  // грузится список классов. Начальные хиты берутся из кости хитов, поэтому
  // состояние пересобирается и на смену класса, а не только на открытие
  watch([isOpen, classDefinition], ([opened]) => {
    if (opened) {
      resetState();
    }
  });

  // ── Сбор результатов ──────────────────────────────────────

  /**
   * Формирует объект обновлений для записи в актора
   *
   * @param resolvedGrantedSpells - granted-заклинания умений текущего уровня,
   * сопоставленные с данными компендиума и правилами подготовки источника
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
        featureChoices: mergeFeatureChoices(
          classes[existingIndex].featureChoices,
          wizardState.featureChoices,
        ),
        ...classChoiceAnswersField(classes[existingIndex].choiceAnswers),
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
        ...(packId.value ? { packId: packId.value } : {}),
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
        ...classChoiceAnswersField(undefined),
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
    // Ресурсы класса и ТОЛЬКО выбранного подкласса: в выгрузке ресурсы всех
    // подклассов лежат в общем списке класса, и список целиком выдавал воину
    // кости превосходства вместе с костями психической энергии
    const counterDefinitions: ClassCounterDefinition[] =
      collectClassCounterDefinitions(classDef, chosenSubclassKey);

    // Ресурсы чужих подклассов этого класса снимаются: они могли попасть на
    // лист только той же ошибкой, и повышение уровня — момент прибраться
    const existingCounters = (actor.value.system.classCounters ?? []).filter(
      (counter) =>
        !isForeignSubclassCounter(counter, classDef.key, chosenSubclassKey),
    );

    if (counterDefinitions.length > 0) {
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
        // Тот же уровень своим именем: формула компендиума, написанная через
        // `@classLevel`, обязана считать по классу не потому, что здесь
        // подменён общий `@level`, а потому, что так сказано в ней самой
        classLevel,
      };

      for (const counterDef of counterDefinitions) {
        // Проверяем, что уровень персонажа достаточен для этого счётчика
        if (classLevel < counterDef.startLevel) {
          continue;
        }

        // Счётчик уже заведён (мастер переоткрыли или это повышение уровня):
        // сверка и по подклассу, иначе ресурс подкласса с ключом ресурса
        // класса сошёл бы за уже выданный
        const existingCounter = existingCounters.find((existing) =>
          isCounterOfDefinition(existing, classDef.key, counterDef),
        );

        if (existingCounter) {
          // Обновляем max при level-up
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

          // Раздельные правила отдыха появились у определения позже: счётчик,
          // заведённый до них и не настроенный игроком, получает их здесь.
          // Свои правила игрока не трогаем
          if (!existingCounter.shortRest && !existingCounter.longRest) {
            const { shortRest, longRest } = counterDefinitionRest(counterDef);

            if (shortRest) {
              existingCounter.shortRest = shortRest;
            }

            if (longRest) {
              existingCounter.longRest = longRest;
            }
          }

          // Нижняя граница появилась у счётчика позже: у записей, добавленных
          // до неё, её нет вовсе
          existingCounter.min ??= counterDef.min;

          // Формула тоже появилась у классового ресурса позже: записи,
          // заведённые до неё, получают её здесь — на первом же повышении
          // уровня. Своё число игрока при этом не трогаем: оно лежит той же
          // формулой, и она уже стоит. Пустую не пишем вовсе — у ресурса со
          // ступенями по уровням формулы нет, и поле осталось бы пустышкой
          const backfilledFormula = counterMaxFormulaOf(counterDef);

          if (!existingCounter.maxFormula && backfilledFormula) {
            existingCounter.maxFormula = backfilledFormula;
          }

          continue;
        }

        // Создаём новый счётчик
        const maxValue = computeCounterMax(
          counterDef,
          classLevel,
          counterContext,
        );

        const maxFormula = counterMaxFormulaOf(counterDef);

        existingCounters.push({
          counterKey: counterDef.key,
          classKey: classDef.key,
          subclassKey: counterDef.subclassKey ?? undefined,
          // Сразу сохраняем название/восстановление из определения на актора,
          // чтобы имя на русском отображалось всегда, даже если компендиум
          // недоступен или сопоставление по ключу не сработает.
          name: counterDef.name,
          shortName: counterDef.shortName,
          // Отдых — словом и раздельными правилами записи: ресурсу, которому
          // отдых ничего не возвращает, слова для этого нет
          ...counterDefinitionRest(counterDef),
          // Нижняя граница живёт на счётчике: её читают и панель ресурсов, и
          // отдых
          ...(counterDef.min ? { min: counterDef.min } : {}),
          // Формула едет на лист вместе с числом: с ней ресурс растёт сам —
          // за модификатором характеристики и бонусом мастерства, — а не
          // только на повышении уровня. Раньше её приходилось оставлять в
          // мастере: её `@level` означал уровень в классе, а лист прочитал бы
          // сумму уровней мультиклассера. Теперь уровень назван своим именем
          // (`@classLevel`), и лист считает его по классу счётчика сам
          ...(maxFormula ? { maxFormula } : {}),
          // Полный, а у ресурса «появляется пустым» — ноль
          current: initialCounterCurrent(counterDef, maxValue),
          max: maxValue,
        });
      }
    }

    systemUpdates.classCounters = existingCounters;

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
    if (chosenFeatureSkills.value.length > 0) {
      const existingProf = actor.value.system.proficiencies;

      const skills = {
        ...(systemUpdates.proficiencies?.skills ?? existingProf?.skills ?? {}),
      };

      for (const skill of chosenFeatureSkills.value) {
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
      // Эффекты вариантов: выбранного — только пока он выбран, справочного
      // списка — у каждого открытого варианта, выбирать из него нечего
      ...collectClassOptionEffects(classDef, levelOptionGrants.value),
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

    // Умения — добавляем в общий список features актора. Добор вариантов
    // прошлых уровней приходит сюда же: само умение уже на листе, а взятые
    // сейчас воззвания — новые записи
    const reopenedPicks = featureChoicePicks.value.filter(
      (pick) => !pick.isGainedNow,
    );

    if (
      levelFeatures.value.length > 0
      || reopenedPicks.length > 0
      || referenceOptions.value.length > 0
    ) {
      const newFeatures = [...(actor.value.features || [])];
      // Название класса берётся до вложенной функции: внутри неё TypeScript
      // уже не помнит, что запись класса проверена на существование
      const className = classDef.name;
      const classKey = classDef.key;

      /**
       * Добавляет запись умения на лист, если такой там ещё нет.
       *
       * Уровень входит в сравнение только внутри одного источника — там же,
       * где живёт рост по уровням: ступень носит имя своего умения
       * («Бардовское вдохновение» на 5 уровне), и по одному имени лист
       * принимал её за повтор и терял. От чужого класса с тем же умением и от
       * переоткрытого мастера защищает прежнее правило: имя совпало — второй
       * записи не будет.
       *
       * @param name - название записи на листе
       * @param description - описание записи
       * @param level - уровень, на котором запись получена
       * @param isSubclass - умение подкласса
       * @param sourceName - название подкласса-источника
       * @param grant - дары выбранного варианта; запись варианта несёт их сама
       * @param spellList - расширение списка заклинаний самого умения
       * @param featureEffects - эффекты самого умения: запись помнит их id
       */
      function pushFeature(
        name: string,
        description: string,
        level: number,
        isSubclass: boolean,
        sourceName?: string,
        grant?: ClassOptionGrant,
        spellList?: FeatSpellListExpansion,
        featureEffects?: ActiveEffect[],
      ): void {
        const grantedBy = featureGrantedBy(className, isSubclass, sourceName);

        const alreadyExists = newFeatures.some(
          (existing) =>
            existing.name === name
            && (existing.grantedBy !== grantedBy || existing.level === level),
        );

        if (alreadyExists) {
          return;
        }

        // Дары варианта живут на его собственной записи: по ней лист считает
        // ресурс варианта и его заклинания на следующих уровнях, в сводке
        // видно, что именно дало владение, а снятие класса забирает дары
        // вместе с записью. У самого умения дары остаются в записи класса — там
        // они выведены её полями, и копия на листе выдала бы то же дважды.
        // Исключение — расширение списка заклинаний умения: оно ничего не
        // выдаёт, а по записи лист показывает заклинания сверх списка класса и
        // открывает новые ступени на следующих уровнях
        const answers = grant ? optionChoiceAnswers(grant) : {};

        let featData: FeatData | undefined;

        if (grant?.featData) {
          featData = {
            ...grant.featData,
            ...(spellList && !grant.featData.spellList ? { spellList } : {}),
          };
        } else if (spellList) {
          featData = { type: 'feat', spellList };
        }

        // Эффекты умения лежат в общем списке листа; ссылка на них даёт строке
        // особенности включать свой эффект (с панели быстрого доступа)
        const effectIds = [
          ...listFeatureEffectIds(classKey, featureEffects),
          ...(grant
            ? listFeatureEffectIds(classKey, grant.activeEffects, grant)
            : []),
        ];

        const record: AppliedFeatFeature = {
          id: generateId('feature'),
          name,
          grantedBy,
          description,
          level,
          featureType: isSubclass ? 'subclass' : 'class',
          ...(featData ? { featData } : {}),
          ...(effectIds.length > 0 ? { effectIds } : {}),
          ...(Object.keys(answers).length > 0 ? { choices: answers } : {}),
          ...(grant?.activeEffects.length
            ? { activeEffects: grant.activeEffects }
            : {}),
        };

        newFeatures.push(record);
      }

      for (const feature of levelFeatures.value) {
        // Пропускаем информационные умения и ASI/Feat. Ступень роста ASI —
        // тоже уровень повышения: своей записи на листе у неё нет, прибавку
        // игрок получает шагом характеристик
        if (
          feature.isInformationalOnly
          || isAsiFeatureInClass(feature, allClassFeatures.value)
        ) {
          continue;
        }

        // Выбранный вариант заменяет собой запись умения: на листе «Боевой
        // стиль: Оборона» полезнее самого умения, а его описание — это и есть
        // описание варианта. Вариантов бывает несколько — тогда и записей
        // столько же
        const selected = selectedChoicesFor(feature.key);

        if (selected.length === 0) {
          pushFeature(
            feature.name,
            feature.description,
            feature.level,
            feature.isSubclass ?? false,
            feature.sourceName,
            undefined,
            feature.featData?.spellList,
            feature.activeEffects,
          );

          continue;
        }

        for (const choice of selected) {
          pushFeature(
            `${feature.name}${FEATURE_OPTION_SEPARATOR}${choice.name}`,
            choice.description,
            feature.level,
            feature.isSubclass ?? false,
            feature.sourceName,
            optionGrantByKey.value.get(`${feature.key}:${choice.key}`),
            feature.featData?.spellList,
            feature.activeEffects,
          );
        }
      }

      // Добор вариантов у умений прошлых уровней: запись получает уровень, на
      // котором вариант взят, — по нему на листе и видно, когда он появился
      for (const pick of reopenedPicks) {
        for (const choice of selectedChoicesFor(pick.featureKey)) {
          pushFeature(
            `${pick.featureName}${FEATURE_OPTION_SEPARATOR}${choice.name}`,
            choice.description,
            nextLevel.value,
            pick.isSubclass,
            pick.sourceName,
            optionGrantByKey.value.get(`${pick.featureKey}:${choice.key}`),
          );
        }
      }

      // Варианты справочных списков: выбирать их не нужно, а механика у
      // варианта своя — запись варианта несёт её так же, как запись выбранного.
      // Само умение при этом остаётся на листе своей записью (выше): вариант
      // его не заменяет, он к нему прилагается
      for (const entry of referenceOptions.value) {
        pushFeature(
          `${entry.featureName}${FEATURE_OPTION_SEPARATOR}${entry.grant.name}`,
          entry.grant.description,
          entry.isGainedNow ? entry.featureLevel : nextLevel.value,
          entry.isSubclass,
          entry.sourceName,
          entry.grant,
        );
      }

      if (newFeatures.length > actor.value.features?.length) {
        rootUpdates.features = newFeatures;

        // Ресурсы выбранных вариантов: у варианта они лежат ВНУТРИ его даров —
        // ни уровня появления, ни ряда по уровню класса у них нет, — и завести
        // их может только запись самого варианта. Пересборка идёт от уже
        // обновлённого листа: формулы `@prof` и `@level` обязаны видеть новый
        // уровень, иначе ресурс застрял бы на значении прошлого
        systemUpdates.classCounters = refreshFeatCounters(
          {
            ...actor.value,
            ...rootUpdates,
            system: { ...actor.value.system, ...systemUpdates },
          },
          systemUpdates.classCounters ?? actor.value.system.classCounters ?? [],
        );
      }
    }

    // Заклинания уровня — только то, что выдали сами записи: и без выбора, и
    // названное игроком в их вопросах. Свободного набора заклинаний мастер не
    // ведёт — таблица класса числами не спрашивает, а показывает норму на листе
    if (resolvedGrantedSpells.length > 0) {
      rootUpdates.spells = appendGrantedSpells(
        actor.value.spells ?? [],
        resolvedGrantedSpells,
      );
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
    hasSubclassSelection,
    skillChoicesCount,
    availableSkills,
    alreadyProficientSkills,
    selectedEquipmentItems,
    selectedEquipmentCoins,
    levelRows,

    // Шаги
    wizardSteps,
    activeStepKey,
    isFirstStep,
    isLastStep,
    currentStepIndex: stepIndex,

    // Состояние
    wizardState,
    canProceed,
    preparedFeatChoices: allPreparedFeatChoices,
    featPickChoices,
    asiFeatChoice,
    asiTakenFeat,
    featChoiceProficiencyBonus,
    grantedSpellSources,
    grantedClassSpellRequests,
    classSpellListOffers,
    preparedSpellsAtLevel,

    // Навигация
    nextStep,
    prevStep,

    // Результат
    buildUpdates,
  };
}
