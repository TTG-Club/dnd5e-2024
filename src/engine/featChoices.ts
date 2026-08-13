/**
 * Выборы, которые игрок делает при взятии черты.
 *
 * Черта вроде «Умелого» не выдаёт готовый набор владений — она просит выбрать: три
 * навыка, вид оружия, тип урона. Здесь живут правила такого выбора: из чего выбирают
 * ({@link resolveFeatChoicePool}), сколько ({@link resolveFeatChoiceCount}) и что
 * происходит с выбранным ({@link applyFeatChoiceSelections}).
 *
 * Применяется НЕ всё: заклинания по выбору («Посвящённый в магию») требуют разбора
 * компендиума и остаются записанными, но не выданными — см. {@link isAppliedChoiceType}.
 * Записанный, но не применённый выбор всё равно виден на листе: он показывается в сводке
 * даров черты, и мастер выдаёт заклинание сам.
 *
 * @module system/dnd/featChoices
 */

import type { AbilityType, ProficiencyLevel, SkillType } from '@vtt/shared';

import type { DnDActor } from './dndEntities.js';
import type {
  FeatChoice,
  FeatChoiceOption,
  FeatChoiceType,
  FeatData,
} from './featTypes.js';

import {
  ABILITY_LABELS,
  isAbilityType,
  isSkillType,
  LANGUAGE_TYPES,
  SKILLS_LIST,
  TOOLS_LIST,
} from './consts.js';
import {
  DAMAGE_TYPE_LABELS,
  DEFENSIBLE_DAMAGE_TYPES,
} from './damageConstants.js';

/** Владения актора — то, что выбор правит. */
type ActorProficiencies = DnDActor['system']['proficiencies'];

/** Владения, разложенные по видам: что дали сделанные выборы. */
export interface FeatChoiceProficiencies {
  skills: SkillType[];
  savingThrows: AbilityType[];
  tools: string[];
  languages: string[];
  weapons: string[];
}

/**
 * Типы выбора, которые лист применяет сам. Остальные записываются и показываются, но
 * ничего не проставляют: заклинание надо искать в компендиуме, а «вариант» у каждой
 * черты свой и общего смысла не имеет.
 */
const APPLIED_CHOICE_TYPES: ReadonlySet<FeatChoiceType> = new Set([
  'skill',
  'savingThrow',
  'tool',
  'language',
  'weapon',
  'damageType',
  'ability',
  'spellcastingAbility',
]);

/** Подписи типов выбора — заголовок шага, когда у выбора нет своей подписи. */
export const FEAT_CHOICE_TYPE_LABELS: Record<FeatChoiceType, string> = {
  ability: 'Характеристика',
  savingThrow: 'Спасбросок',
  skill: 'Навык',
  tool: 'Инструмент',
  language: 'Язык',
  damageType: 'Тип урона',
  spell: 'Заклинание',
  cantrip: 'Заговор',
  spellList: 'Список заклинаний',
  spellcastingAbility: 'Заклинательная характеристика',
  weapon: 'Оружие',
  option: 'Вариант',
};

/** Применяет ли лист выбор этого типа сам. */
export function isAppliedChoiceType(type: FeatChoiceType): boolean {
  return APPLIED_CHOICE_TYPES.has(type);
}

/**
 * Сколько значений выбирают.
 *
 * @param choice - выбор черты
 * @param proficiencyBonus - бонус мастерства персонажа
 */
export function resolveFeatChoiceCount(
  choice: FeatChoice,
  proficiencyBonus: number,
): number {
  if (choice.countEqualsProficiencyBonus) {
    return Math.max(1, proficiencyBonus);
  }

  const count = choice.count;

  return count === undefined || count < 1 ? 1 : Math.round(count);
}

/** Заклинательной характеристикой черты бывают только эти три. */
const SPELLCASTING_ABILITIES: readonly AbilityType[] = [
  'intelligence',
  'wisdom',
  'charisma',
];

/** Полный набор значений типа — когда у выбора не задан свой список. */
function defaultPool(type: FeatChoiceType): FeatChoiceOption[] {
  switch (type) {
    case 'skill':
      return SKILLS_LIST.map((skill) => ({
        value: skill.key,
        name: skill.label,
      }));
    case 'ability':
    case 'savingThrow':
      return Object.entries(ABILITY_LABELS).map(([value, name]) => ({
        value,
        name,
      }));
    case 'spellcastingAbility':
      return SPELLCASTING_ABILITIES.map((value) => ({
        value,
        name: ABILITY_LABELS[value],
      }));
    case 'tool':
      return TOOLS_LIST.map((tool) => ({ value: tool.key, name: tool.label }));
    case 'language':
      return LANGUAGE_TYPES.map((value) => ({ value, name: value }));
    case 'damageType':
      return DEFENSIBLE_DAMAGE_TYPES.map((value) => ({
        value,
        name: DAMAGE_TYPE_LABELS[value],
      }));
    default:
      // Оружие, заклинания и «варианты» перечисляет сама черта: общего справочника,
      // из которого их можно взять, у листа нет
      return [];
  }
}

/** Владеет ли персонаж этим значением — для флагов «только то, чем (не) владеешь». */
function isProficient(
  actor: DnDActor,
  type: FeatChoiceType,
  value: string,
): boolean {
  const proficiencies = actor.system.proficiencies;

  switch (type) {
    case 'skill': {
      if (!isSkillType(value)) {
        return false;
      }

      const level = proficiencies?.skills?.[value];

      return level === 'proficient' || level === 'expertise';
    }
    case 'savingThrow':
      return (
        isAbilityType(value)
        && Boolean(proficiencies?.savingThrows?.includes(value))
      );
    case 'tool':
      return Boolean(proficiencies?.tools?.includes(value));
    case 'language':
      return Boolean(proficiencies?.languages?.includes(value));
    case 'weapon':
      return Boolean(proficiencies?.weapons?.includes(value));
    default:
      // У остальных типов владения нет, и фильтровать по нему нечего
      return false;
  }
}

/**
 * Из чего выбирают: список самой черты, иначе полный набор типа. Флаги «только то, чем
 * (не) владеешь» сужают набор по листу персонажа.
 *
 * @param choice - выбор черты
 * @param actor - лист персонажа
 * @returns варианты в порядке показа
 */
export function resolveFeatChoicePool(
  choice: FeatChoice,
  actor: DnDActor,
): FeatChoiceOption[] {
  const pool =
    choice.options && choice.options.length > 0
      ? choice.options
      : defaultPool(choice.type);

  if (!choice.onlyIfProficient && !choice.onlyIfNotProficient) {
    return pool;
  }

  return pool.filter((option) => {
    const proficient = isProficient(actor, choice.type, option.value);

    return choice.onlyIfProficient ? proficient : !proficient;
  });
}

/**
 * Уровень владения, который даёт выбор.
 *
 * `grants: 'expertise'` — исход безусловный («Знаток»). Флаг `expertiseIfProficient`
 * описывает замену: владеешь выбранным — получаешь компетентность, не владеешь —
 * обычное владение («Наблюдательный»).
 */
function grantedLevel(
  choice: FeatChoice,
  actor: DnDActor,
  value: string,
): ProficiencyLevel {
  if (choice.grants === 'expertise') {
    return 'expertise';
  }

  if (choice.expertiseIfProficient && isProficient(actor, choice.type, value)) {
    return 'expertise';
  }

  return 'proficient';
}

/** Добавляет значение в список владений, не плодя дублей. */
function addUnique(target: string[] | undefined, value: string): void {
  if (target && !target.includes(value)) {
    target.push(value);
  }
}

/**
 * Проставляет сделанные выборы во владения актора (мутирует переданную копию — так же,
 * как это делают дары черты).
 *
 * Выбор характеристики ({@code ability}/{@code spellcastingAbility}) и типа урона
 * владений не даёт: на них ссылаются повышение характеристик и сопротивление по выбору,
 * и применяются они там.
 *
 * @param proficiencies - копия владений актора
 * @param featData - дары черты с описанием выборов
 * @param selections - что выбрал игрок: ключ выбора → значения
 * @param actor - лист персонажа (для флагов «владеешь / не владеешь»)
 */
export function applyFeatChoiceSelections(
  proficiencies: ActorProficiencies,
  featData: FeatData | null | undefined,
  selections: Record<string, string[]> | undefined,
  actor: DnDActor,
): void {
  if (!featData?.choices || !selections) {
    return;
  }

  for (const choice of featData.choices) {
    for (const value of selections[choice.key] ?? []) {
      switch (choice.type) {
        case 'skill':
          if (isSkillType(value)) {
            proficiencies.skills[value] = grantedLevel(choice, actor, value);
          }

          break;
        case 'savingThrow':
          if (isAbilityType(value)) {
            addUnique(proficiencies.savingThrows, value);
          }

          break;
        case 'tool':
          addUnique(proficiencies.tools, value);

          break;
        case 'language':
          addUnique(proficiencies.languages, value);

          break;
        case 'weapon':
          addUnique(proficiencies.weapons, value);

          break;
        default:
          // Остальное владений не даёт: см. `isAppliedChoiceType`
          break;
      }
    }
  }
}

/**
 * Владения, которые дали сделанные выборы, разложенные по видам.
 *
 * Нужны там, где применение и откат разнесены: предыстория, выдавшая черту, помнит
 * выданные владения списком в своей записи и снимает их при замене — по этому списку,
 * а не по самой черте.
 *
 * @param featData - дары черты с описанием выборов
 * @param selections - что выбрал игрок
 */
export function collectFeatChoiceProficiencies(
  featData: FeatData | null | undefined,
  selections: Record<string, string[]> | undefined,
): FeatChoiceProficiencies {
  const result: FeatChoiceProficiencies = {
    skills: [],
    savingThrows: [],
    tools: [],
    languages: [],
    weapons: [],
  };

  if (!featData?.choices || !selections) {
    return result;
  }

  for (const choice of featData.choices) {
    for (const value of selections[choice.key] ?? []) {
      switch (choice.type) {
        case 'skill':
          if (isSkillType(value)) {
            result.skills.push(value);
          }

          break;
        case 'savingThrow':
          if (isAbilityType(value)) {
            result.savingThrows.push(value);
          }

          break;
        case 'tool':
          result.tools.push(value);

          break;
        case 'language':
          result.languages.push(value);

          break;
        case 'weapon':
          result.weapons.push(value);

          break;
        default:
          // Владений не даёт — см. `applyFeatChoiceSelections`
          break;
      }
    }
  }

  return result;
}

/**
 * Снимает сделанные выборы с владений актора — зеркало
 * {@link applyFeatChoiceSelections} для отката черты.
 *
 * @param proficiencies - копия владений актора
 * @param featData - дары черты с описанием выборов
 * @param selections - что было выбрано
 */
export function removeFeatChoiceSelections(
  proficiencies: ActorProficiencies,
  featData: FeatData | null | undefined,
  selections: Record<string, string[]> | undefined,
): void {
  if (!featData?.choices || !selections) {
    return;
  }

  for (const choice of featData.choices) {
    for (const value of selections[choice.key] ?? []) {
      switch (choice.type) {
        case 'skill':
          Reflect.deleteProperty(proficiencies.skills, value);

          break;
        case 'savingThrow':
          removeValue(proficiencies.savingThrows, value);

          break;
        case 'tool':
          removeValue(proficiencies.tools, value);

          break;
        case 'language':
          removeValue(proficiencies.languages, value);

          break;
        case 'weapon':
          removeValue(proficiencies.weapons, value);

          break;
        default:
          break;
      }
    }
  }
}

/** Убирает значение из списка владений. */
function removeValue(target: string[] | undefined, value: string): void {
  if (!target) {
    return;
  }

  const index = target.indexOf(value);

  if (index !== -1) {
    target.splice(index, 1);
  }
}

/**
 * Тип урона, выбранный для сопротивления. «Отмеченный драконом» выбирает один тип из
 * пяти, и сопротивление даётся именно ему — через
 * {@code modifiers.damage.resistanceFromChoiceKey}.
 *
 * @param featData - дары черты
 * @param selections - что выбрал игрок
 * @returns выбранные типы урона; пусто — черта такого сопротивления не даёт
 */
export function resolveChosenResistances(
  featData: FeatData | null | undefined,
  selections: Record<string, string[]> | undefined,
): string[] {
  const key = featData?.modifiers?.resistanceFromChoiceKey;

  if (!key || !selections) {
    return [];
  }

  return selections[key] ?? [];
}

/**
 * Характеристики, выбранные для повышения. «Устойчивый» поднимает ту характеристику,
 * спасбросками которой персонаж овладел, — повышение ссылается на выбор через
 * {@code fromChoiceKey}.
 *
 * @param featData - дары черты
 * @param selections - что выбрал игрок
 * @returns выбранные характеристики
 */
export function resolveChosenAbilities(
  featData: FeatData | null | undefined,
  selections: Record<string, string[]> | undefined,
): AbilityType[] {
  const key = featData?.abilityScoreIncrease?.fromChoiceKey;

  if (!key || !selections) {
    return [];
  }

  return (selections[key] ?? []).filter(isAbilityType);
}

/**
 * Черты листа, чьи выборы пересматриваются на продолжительном отдыхе («Мастер оружия»
 * меняет вид оружия, «Дар устойчивости к энергиям» — типы урона).
 *
 * @param actor - лист персонажа
 * @returns id особенности и её пересматриваемые выборы
 */
export function collectRechoosableFeats(
  actor: DnDActor,
): Array<{ featureId: string; featureName: string; choices: FeatChoice[] }> {
  const result: Array<{
    featureId: string;
    featureName: string;
    choices: FeatChoice[];
  }> = [];

  for (const feature of actor.features ?? []) {
    const featData = (feature as { featData?: FeatData }).featData;

    const choices = (featData?.choices ?? []).filter(
      (choice) => choice.rechooseOnLongRest,
    );

    if (choices.length > 0) {
      result.push({
        featureId: feature.id,
        featureName: feature.name,
        choices,
      });
    }
  }

  return result;
}
