/**
 * Выборы, которые игрок делает при взятии черты.
 *
 * Черта вроде «Умелого» не выдаёт готовый набор владений — она просит выбрать: три
 * навыка, вид оружия, тип урона. Здесь живут правила такого выбора: из чего выбирают
 * ({@link resolveFeatChoicePool}), сколько ({@link resolveFeatChoiceCount}) и что
 * происходит с выбранным ({@link applyFeatChoiceSelections}).
 *
 * Применяется почти всё, но по-разному: владения проставляются здесь
 * ({@link applyFeatChoiceSelections}), а выбранные заклинания уходят в книгу заклинаний
 * тем же путём, что и выданные чертой без выбора (`collectFeatGrantedSpellSources`).
 * Не применяется только «вариант» и выбор списка класса: первый у каждой черты свой,
 * второй лишь сужает пул следующего выбора. Записанный, но не применённый выбор всё
 * равно виден на листе — он показывается в сводке даров черты.
 *
 * @module system/dnd/featChoices
 */

import type { AbilityType, ProficiencyLevel, SkillType } from '@vtt/shared';

import type { DnDActor, Spell } from './dndEntities.js';
import type {
  FeatChoice,
  FeatChoiceOption,
  FeatChoiceSpellFilter,
  FeatChoiceType,
  FeatData,
} from './featTypes.js';

import { CLASS_KEY_OPTIONS, CLASS_KEYS } from './classTypes.js';
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
 * ничего не проставляют: «вариант» у каждой черты свой и общего смысла не имеет, а
 * выбор списка класса только сужает пул следующего выбора.
 *
 * Заклинание и заговор здесь тоже есть, хотя владений они не дают: выбранное заклинание
 * лист кладёт в книгу сам, наравне с выданными чертой без выбора.
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
  'spell',
  'cantrip',
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
    case 'spellList':
      // Список класса, из которого потом выбирают заклинания: «Посвящённый в магию»
      // перечисляет свои три класса сам, но если не перечислил — подойдёт любой
      return CLASS_KEY_OPTIONS.map((option) => ({
        value: option.value,
        name: option.label,
      }));
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

/** Уровень заговора — им же «заговор» отличается от заклинания в фильтре. */
const CANTRIP_LEVEL = 0;

/**
 * Чем пул заклинаний дополняется снаружи: каталогом компендиума и уже сделанными
 * выборами.
 *
 * Заклинания, в отличие от навыков и языков, справочником листа не описаны — их
 * приходится брать из компендиума, а он грузится асинхронно. Поэтому каталог передаётся
 * снаружи: движок остаётся синхронным и проверяемым, а загрузка живёт в окне выбора.
 */
export interface FeatChoicePoolContext {
  /** Заклинания компендиума — из них собирается пул выбора заклинания или заговора */
  spells?: ReadonlyArray<Spell>;
  /**
   * Уже сделанные выборы: из ответа на {@link FeatChoiceSpellFilter.classesFromChoiceKey}
   * берётся класс, которым сужается пул.
   */
  selections?: Record<string, string[]>;
}

/**
 * Ключи классов, которыми ограничен выбор заклинания.
 *
 * Источников два и они складываются: заданные фильтром напрямую и взятые из ответа
 * игрока — «Посвящённый в магию» сперва спрашивает список класса. Пустой результат
 * означает «класс не ограничивает», а не «подходящих нет».
 */
function filterClassKeys(
  filter: FeatChoiceSpellFilter,
  selections: Record<string, string[]> | undefined,
): string[] {
  const keys = [...(filter.classKeys ?? [])];

  for (const ref of filter.classes ?? []) {
    const key = classKeyFromUrl(ref.url);

    if (key) {
      keys.push(key);
    }
  }

  for (const answer of selections?.[filter.classesFromChoiceKey ?? ''] ?? []) {
    const key = classKeyFromUrl(answer);

    if (key) {
      keys.push(key);
    }
  }

  return [...new Set(keys)];
}

/**
 * Канонический ключ класса из ответа или слага страницы: `wizard-phb` → `wizard`.
 * Слаг сайта несёт суффикс источника, а заклинание помечено голым ключом.
 */
function classKeyFromUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return (
    CLASS_KEYS.find(
      (key) => normalized === key || normalized.startsWith(`${key}-`),
    ) ?? null
  );
}

/**
 * Подходит ли заклинание под ограничение выбора.
 *
 * Незаполненное поле фильтра не ограничивает ничего: у «Ритуального заклинателя» задано
 * только время накладывания, у «Адепта стихий» — только школа.
 *
 * @param spell - заклинание компендиума
 * @param filter - ограничение выбора
 * @param classKeys - ключи классов, которыми сужен пул (пусто — не ограничивает)
 */
export function matchesFeatSpellFilter(
  spell: Spell,
  filter: FeatChoiceSpellFilter | undefined,
  classKeys: ReadonlyArray<string> = [],
): boolean {
  // Заданы оба предела — это диапазон кругов: «Тронутый фейри» берёт заклинание
  // 1–2 круга. Один только `level` — точный круг: у «Посвящённого в магию» это ноль,
  // то есть заговор
  if (filter?.level !== undefined) {
    const matchesLevel =
      filter.maxLevel !== undefined
        ? spell.level >= filter.level
        : spell.level === filter.level;

    if (!matchesLevel) {
      return false;
    }
  }

  if (filter?.maxLevel !== undefined && spell.level > filter.maxLevel) {
    return false;
  }

  if (filter?.schools?.length && !filter.schools.includes(spell.school)) {
    return false;
  }

  if (filter?.castingTime) {
    const matchesTime =
      filter.castingTime === 'ritual'
        ? spell.ritual
        : spell.castingTimeUnit === filter.castingTime;

    if (!matchesTime) {
      return false;
    }
  }

  if (classKeys.length > 0) {
    const spellClasses = spell.classKeys ?? [];

    if (!spellClasses.some((key) => classKeys.includes(key))) {
      return false;
    }
  }

  return true;
}

/**
 * Пул выбора заклинания или заговора: заклинания каталога, прошедшие фильтр черты.
 * Значение варианта — id записи компендиума: по нему заклинание и выдаётся.
 */
function spellPool(
  choice: FeatChoice,
  context: FeatChoicePoolContext | undefined,
): FeatChoiceOption[] {
  const catalog = context?.spells ?? [];

  if (catalog.length === 0) {
    return [];
  }

  // «Заговор» — тот же выбор заклинания, но нулевого круга: отдельного признака у
  // заклинания нет, отличает их только уровень
  const filter: FeatChoiceSpellFilter =
    choice.type === 'cantrip'
      ? { ...choice.spellFilter, level: CANTRIP_LEVEL }
      : (choice.spellFilter ?? {});

  const classKeys = filterClassKeys(filter, context?.selections);

  return catalog
    .filter((spell) => matchesFeatSpellFilter(spell, filter, classKeys))
    .map((spell) => ({ value: spell.id, name: spell.name }))
    .sort((first, second) =>
      (first.name ?? '').localeCompare(second.name ?? ''),
    );
}

/**
 * Из чего выбирают: список самой черты, иначе полный набор типа. Флаги «только то, чем
 * (не) владеешь» сужают набор по листу персонажа.
 *
 * @param choice - выбор черты
 * @param actor - лист персонажа
 * @param context - каталог заклинаний и уже сделанные выборы (для выбора заклинания)
 * @returns варианты в порядке показа
 */
export function resolveFeatChoicePool(
  choice: FeatChoice,
  actor: DnDActor,
  context?: FeatChoicePoolContext,
): FeatChoiceOption[] {
  if (choice.type === 'spell' || choice.type === 'cantrip') {
    return spellPool(choice, context);
  }

  const pool =
    choice.options && choice.options.length > 0
      ? withDictionaryLabels(choice.type, choice.options)
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
 * Достаёт подписи вариантов из справочника типа выбора.
 *
 * Черта перечисляет варианты значениями и подпись задаёт не всегда: у «Посвящённого в
 * магию» заклинательная характеристика записана тремя ключами без единого названия. Без
 * подстановки игрок увидел бы на кнопках `intelligence` вместо «Интеллект» — само
 * значение верное, показывать его просто нечем.
 *
 * @param type - тип выбора: он задаёт справочник
 * @param options - варианты, перечисленные чертой
 */
function withDictionaryLabels(
  type: FeatChoiceType,
  options: ReadonlyArray<FeatChoiceOption>,
): FeatChoiceOption[] {
  const labels = new Map(
    defaultPool(type).map((option) => [option.value, option.name]),
  );

  return options.map((option) =>
    option.name
      ? option
      : { value: option.value, name: labels.get(option.value) ?? option.value },
  );
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
