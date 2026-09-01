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
  FeatDamageDefenseChoice,
  FeatData,
} from './featTypes.js';
import type { DamageDefenseEntry } from './speciesTypes.js';

import { CLASS_KEY_OPTIONS, classKeyFromUrl } from './classTypes.js';
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
  isDefensibleDamageType,
} from './damageConstants.js';
import { RITUAL_CASTING_TIME } from './spellTypes.js';
import { WEAPON_MASTERIES, weaponMasteryName } from './weaponMasteries.js';

/** Владения актора — то, что выбор правит. */
type ActorProficiencies = DnDActor['system']['proficiencies'];

/** Владения, разложенные по видам: что дали сделанные выборы. */
export interface FeatChoiceProficiencies {
  skills: SkillType[];
  savingThrows: AbilityType[];
  tools: string[];
  languages: string[];
  weapons: string[];
  /** Оружейные приёмы (2024) — свой список на листе, не подмножество владений */
  weaponMasteries: string[];
  /** Сами приёмы (`cleave`, …) — ещё один список, не пересекающийся с оружием */
  masteryProperties: string[];
  armor: string[];
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
  'weaponMastery',
  'masteryProperty',
  'armor',
  'skillOrTool',
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
  weaponMastery: 'Оружие с приёмом',
  masteryProperty: 'Оружейный приём',
  armor: 'Доспехи',
  skillOrTool: 'Навык или инструмент',
  option: 'Вариант',
  feat: 'Черта',
};

/** Применяет ли лист выбор этого типа сам. */
export function isAppliedChoiceType(type: FeatChoiceType): boolean {
  return APPLIED_CHOICE_TYPES.has(type);
}

/**
 * Выбор черты: пул берётся из компендиума черт, а не из справочника правил,
 * поэтому такой выбор спрашивает свой пикер, а не общие поля выбора.
 *
 * @param choice - выбор черты
 */
export function isFeatPickChoice(
  choice: Pick<FeatChoice, 'type' | 'types'>,
): boolean {
  return resolveFeatChoiceTypes(choice).includes('feat');
}

/**
 * Виды выбора: один или несколько, если выбирают из нескольких справочников
 * сразу. Легаси-значение `skillOrTool` разворачивается здесь — дальше по коду
 * смешанный набор везде выглядит одинаково.
 *
 * @param choice - выбор черты
 * @returns виды в порядке, заданном автором; минимум один
 */
export function resolveFeatChoiceTypes(
  choice: Pick<FeatChoice, 'type' | 'types'>,
): FeatChoiceType[] {
  if (choice.types?.length) {
    return [...choice.types];
  }

  return choice.type === 'skillOrTool' ? ['skill', 'tool'] : [choice.type];
}

/**
 * Какому виду принадлежит выбранное значение. У смешанного набора это решает
 * сам справочник: `sleightOfHand` есть среди навыков, `thieves-tools` — среди
 * инструментов. Не нашлось нигде — берётся первый вид набора: у видов без
 * справочника (оружие, «вариант») значения свои, и разбирать их нечем.
 *
 * @param choice - выбор черты
 * @param value - выбранное значение
 */
export function resolveFeatChoiceValueType(
  choice: Pick<FeatChoice, 'type' | 'types'>,
  value: string,
): FeatChoiceType {
  const types = resolveFeatChoiceTypes(choice);

  if (types.length === 1) {
    return types[0];
  }

  const owner = types.find((type) =>
    getFeatChoiceDefaultPool(type).some((option) => option.value === value),
  );

  return owner ?? types[0];
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

/**
 * Категории доспехов — тот же набор, которым владение записано на листе
 * (`proficiencies.armor`) и в требованиях черты.
 */
const ARMOR_CATEGORY_OPTIONS: FeatChoiceOption[] = [
  { value: 'light', name: 'Лёгкие доспехи' },
  { value: 'medium', name: 'Средние доспехи' },
  { value: 'heavy', name: 'Тяжёлые доспехи' },
  { value: 'shield', name: 'Щиты' },
];

/** Чем подпись оружия отделена от названия его приёма. */
const WEAPON_MASTERY_NAME_SEPARATOR = ' — ';

/** Заклинательной характеристикой черты бывают только эти три. */
const SPELLCASTING_ABILITIES: readonly AbilityType[] = [
  'intelligence',
  'wisdom',
  'charisma',
];

/**
 * Полный набор значений типа — когда у выбора не задан свой список.
 *
 * Экспортируется ради редактора черты: там из этого же набора отмечают, чем
 * ограничить выбор. Свои списки в окне завели бы вторую копию справочников, и
 * пул выбора разошёлся бы с тем, что потом покажет лист.
 *
 * @param type - тип выбора черты
 * @param weapons - виды оружия мира: справочника оружия у движка нет, и без
 * него выбор оружия и оружейного приёма остаётся без вариантов
 * @returns варианты в порядке показа; пусто у типов без общего справочника
 */
export function getFeatChoiceDefaultPool(
  type: FeatChoiceType,
  weapons: ReadonlyArray<FeatChoiceOption> = [],
): FeatChoiceOption[] {
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
    case 'armor':
      return [...ARMOR_CATEGORY_OPTIONS];
    case 'damageType':
      return DEFENSIBLE_DAMAGE_TYPES.map((value) => ({
        value,
        name: DAMAGE_TYPE_LABELS[value],
      }));
    case 'masteryProperty':
      // Приёмов ровно восемь, и это правило, а не данные мира: в отличие от
      // оружия, их справочник у движка свой
      return WEAPON_MASTERIES.map((mastery) => ({
        value: mastery.key,
        name: mastery.name.ru,
      }));
    case 'weapon':
      return [...weapons];
    case 'weaponMastery':
      // Приём есть не у всякого оружия: дубину выбирать незачем. Подпись
      // приёмом — чтобы игрок видел, что именно достаётся вместе с оружием
      return weapons.flatMap((weapon) => {
        const mastery = weaponMasteryName(weapon.value);

        return mastery
          ? [
              {
                value: weapon.value,
                name: `${weapon.name ?? weapon.value}${WEAPON_MASTERY_NAME_SEPARATOR}${mastery}`,
              },
            ]
          : [];
      });
    default:
      // Заклинания, черты и «варианты» перечисляет сама черта либо компендиум:
      // общего справочника, из которого их можно взять, у движка нет
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
    case 'weaponMastery':
      return Boolean(proficiencies?.weaponMasteries?.includes(value));
    case 'masteryProperty':
      return Boolean(proficiencies?.masteryProperties?.includes(value));
    case 'armor':
      return Boolean(proficiencies?.armor?.includes(value));
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
  /**
   * Классы, названные источником черты: предыстория «Мудрец» выдаёт «Посвящённого в
   * магию (Волшебник)» — класс назван ею самой, и спрашивать его у игрока незачем.
   * Пусто — источник класса не называет.
   */
  namedClassKeys?: ReadonlyArray<string>;
  /**
   * Виды оружия мира — из них собирается пул выбора оружия и оружейного приёма.
   * Справочника оружия у движка нет: виды живут в данных мира, а не в правилах,
   * поэтому список приходит снаружи. Пусто — выбирать нечего.
   */
  weapons?: ReadonlyArray<FeatChoiceOption>;
}

/**
 * Классы, перечисленные самим фильтром: заданные ключами и ссылками на страницы.
 *
 * @param filter - ограничение выбора заклинания
 */
function listedClassKeys(filter: FeatChoiceSpellFilter): string[] {
  const keys = [...(filter.classKeys ?? [])];

  for (const ref of filter.classes ?? []) {
    const key = classKeyFromUrl(ref.url);

    if (key) {
      keys.push(key);
    }
  }

  return [...new Set(keys)];
}

/**
 * Ключи классов, которыми ограничен выбор заклинания.
 *
 * Список ОДИН, а не объединение перечисленных: «Посвящённый в магию» называет жреца,
 * друида и волшебника, но берут заклинания из списка одного из них. Поэтому названный
 * класс вытесняет перечисленные, а не добавляется к ним. Назвать его могут двумя путями:
 * ответом игрока на выбор списка ({@link FeatChoiceSpellFilter.classesFromChoiceKey}) и
 * источником черты — предыстория «Мудрец» выдаёт «Посвящённого в магию (Волшебник)» и
 * уже ответила за игрока.
 *
 * Класс источника сужает пул и тогда, когда черта классов не перечисляет вовсе: она и
 * определяет, чей это список. А вот перечисленных им не подменить — иначе черта дала бы
 * список, которого в ней нет.
 *
 * Пустой результат означает «класс не ограничивает», а не «подходящих нет».
 */
function filterClassKeys(
  filter: FeatChoiceSpellFilter,
  context: FeatChoicePoolContext | undefined,
): string[] {
  const answered = (
    context?.selections?.[filter.classesFromChoiceKey ?? ''] ?? []
  ).flatMap((answer) => {
    const key = classKeyFromUrl(answer);

    return key ? [key] : [];
  });

  if (answered.length > 0) {
    return [...new Set(answered)];
  }

  const listed = listedClassKeys(filter);

  const named = (context?.namedClassKeys ?? []).filter(
    (key) => listed.length === 0 || listed.includes(key),
  );

  return named.length > 0 ? [...new Set(named)] : listed;
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
      filter.castingTime === RITUAL_CASTING_TIME
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

  // Черта перечислила заклинания сама — они и есть пул: фильтр каталога тут ни
  // при чём. Так устроены ступени расширенного списка («возьмите два из пяти»),
  // и без этой ветки игроку показали бы весь компендиум
  if (choice.options?.length) {
    const names = new Map(catalog.map((spell) => [spell.id, spell.name]));

    return choice.options
      .map((option) => ({
        value: option.value,
        // Название из каталога свежее: в записи лежит снимок на момент сохранения
        name: names.get(option.value) ?? option.name,
      }))
      .sort((first, second) =>
        (first.name ?? '').localeCompare(second.name ?? ''),
      );
  }

  if (catalog.length === 0) {
    return [];
  }

  // «Заговор» — тот же выбор заклинания, но нулевого круга: отдельного признака у
  // заклинания нет, отличает их только уровень
  const filter: FeatChoiceSpellFilter =
    choice.type === 'cantrip'
      ? { ...choice.spellFilter, level: CANTRIP_LEVEL }
      : (choice.spellFilter ?? {});

  const classKeys = filterClassKeys(filter, context);

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

  const types = resolveFeatChoiceTypes(choice);

  // Набор из нескольких справочников склеивается: «Умелый» выбирает три штуки
  // вперемешку из навыков и инструментов, и порядок здесь — заданный автором
  const pool =
    choice.options && choice.options.length > 0
      ? withDictionaryLabels(choice, choice.options, context?.weapons)
      : dedupeOptions(
          types.flatMap((type) =>
            getFeatChoiceDefaultPool(type, context?.weapons),
          ),
        );

  if (!choice.onlyIfProficient && !choice.onlyIfNotProficient) {
    return pool;
  }

  return pool.filter((option) => {
    const proficient = isProficient(
      actor,
      resolveFeatChoiceValueType(choice, option.value),
      option.value,
    );

    return choice.onlyIfProficient ? proficient : !proficient;
  });
}

/**
 * Отвечать на выбор нечем: пул пуст. Требовать ответа в таком случае — значит запереть
 * шаг мастера: игрок видит подпись «вариантов нет» и неактивную кнопку, а сделать ничего
 * не может. Пустым пул бывает законно: «Знаток» просит навык, которым персонаж ещё не
 * владеет, а тот владеет уже всеми.
 *
 * Выбор заклинания сюда НЕ идёт: его пул собирается из каталога компендиума, который
 * приходит контекстом, и пустым он бывает просто потому, что каталог ещё не загрузился.
 * Считать такой выбор безответным значило бы пропустить шаг, ничего не спросив.
 *
 * @param choice - выбор черты
 * @param actor - лист персонажа
 * @param context - каталоги и уже сделанные выборы, из которых собирается пул
 */
export function hasNoFeatChoiceOptions(
  choice: FeatChoice,
  actor: DnDActor,
  context?: FeatChoicePoolContext,
): boolean {
  if (choice.type === 'spell' || choice.type === 'cantrip') {
    return false;
  }

  return resolveFeatChoicePool(choice, actor, context).length === 0;
}

/**
 * Ключ выбора списка класса, который лист заводит сам записям без него. Ключ выдуманный,
 * в самой черте его нет: он живёт ровно столько, сколько игрок отвечает на выборы.
 */
export const FEAT_SPELL_CLASS_CHOICE_KEY = 'spellClassList#auto';

/**
 * Порядок выборов заклинаний: сперва класс, потом заклинания из его списка, потом
 * характеристика, от которой они считаются. Иначе игрок выбирал бы заклинания раньше,
 * чем известно, чей это список.
 */
const SPELL_CHOICE_ORDER: Partial<Record<FeatChoiceType, number>> = {
  spellList: 0,
  spell: 1,
  cantrip: 1,
  spellcastingAbility: 2,
};

/** Выбирают ли этим выбором само заклинание (а не список класса и не характеристику). */
function isSpellPickChoice(choice: FeatChoice): boolean {
  return choice.type === 'spell' || choice.type === 'cantrip';
}

/**
 * Выбор списка класса, на который ссылается выбор заклинания; `undefined` — выбор ни на
 * какой список не ссылается либо названного списка в черте нет.
 *
 * @param choice - выбор заклинания
 * @param choices - все выборы черты
 */
function findSpellClassChoice(
  choice: FeatChoice,
  choices: ReadonlyArray<FeatChoice>,
): FeatChoice | undefined {
  const key = choice.spellFilter?.classesFromChoiceKey;

  if (!key) {
    return undefined;
  }

  return choices.find(
    (candidate) => candidate.type === 'spellList' && candidate.key === key,
  );
}

/**
 * Выборы черты вместе с вопросом про класс — для записей, где его нет.
 *
 * Выбор заклинания перечисляет несколько классов («Посвящённый в магию» назвал жреца,
 * друида и волшебника), но по правилам список ОДИН, а не объединение трёх. Черты,
 * сохранённые до того, как форма стала заводить вопрос сама, такого выбора не содержат —
 * и пул у них собирался из всех классов разом. Вопрос заводится на лету: сама запись не
 * меняется, пересохранять черту незачем.
 *
 * @param choices - выборы черты
 * @returns выборы вместе с вопросом про класс; без нескольких классов — как есть
 */
function withSpellClassChoice(
  choices: ReadonlyArray<FeatChoice>,
): FeatChoice[] {
  // Вопрос уже есть — второй не нужен: на него и ссылаются выборы заклинаний
  if (choices.some((choice) => choice.type === 'spellList')) {
    return [...choices];
  }

  const unlinked = choices.filter(
    (choice) =>
      isSpellPickChoice(choice)
      && !choice.spellFilter?.classesFromChoiceKey
      && listedClassKeys(choice.spellFilter ?? {}).length > 1,
  );

  const [first] = unlinked;

  if (!first) {
    return [...choices];
  }

  const listed = new Set(listedClassKeys(first.spellFilter ?? {}));

  const classChoice: FeatChoice = {
    key: FEAT_SPELL_CLASS_CHOICE_KEY,
    type: 'spellList',
    count: 1,
    options: getFeatChoiceDefaultPool('spellList').filter((option) =>
      listed.has(option.value),
    ),
  };

  const linked = new Set(unlinked);

  const prepared = choices.map((choice) =>
    linked.has(choice)
      ? {
          ...choice,
          spellFilter: {
            ...choice.spellFilter,
            classesFromChoiceKey: FEAT_SPELL_CLASS_CHOICE_KEY,
          },
        }
      : choice,
  );

  // Вопрос встаёт перед первым же выбором заклинания, а не в начало списка:
  // выборы, заданные автором раньше (навык, повышение характеристики), к списку
  // класса отношения не имеют и вперёд него не просятся
  prepared.splice(choices.indexOf(first), 0, classChoice);

  return prepared;
}

/**
 * Выборы заклинаний в порядке показа. Переставляются только они: остальные остаются на
 * своих местах, потому что их порядок задал автор черты и смысла в нём не меньше.
 *
 * @param choices - выборы черты
 */
function orderSpellChoices(choices: ReadonlyArray<FeatChoice>): FeatChoice[] {
  const positions = choices.flatMap((choice, index) =>
    SPELL_CHOICE_ORDER[choice.type] === undefined ? [] : [index],
  );

  if (positions.length < 2) {
    return [...choices];
  }

  // Сортировка устойчива, поэтому выборы одного ранга сохраняют порядок автора:
  // «два заговора, потом одно заклинание первого круга» так и остаётся
  const ordered = positions
    .map((index) => choices[index])
    .sort(
      (first, second) =>
        (SPELL_CHOICE_ORDER[first.type] ?? 0)
        - (SPELL_CHOICE_ORDER[second.type] ?? 0),
    );

  const result = [...choices];

  positions.forEach((index, slot) => {
    result[index] = ordered[slot];
  });

  return result;
}

/**
 * Выборы черты в том виде, в каком их задают игроку: с вопросом про класс у старых
 * записей и в правильном порядке (класс → заклинания → характеристика).
 *
 * Через неё проходят все окна, где черту берут: и выдача черты, и мастер предыстории, и
 * пересмотр выборов на отдыхе — иначе одна и та же черта спрашивала бы разное.
 *
 * @param choices - выборы из механики черты
 * @returns выборы для показа игроку
 */
export function prepareFeatChoices(
  choices: ReadonlyArray<FeatChoice> | undefined,
): FeatChoice[] {
  return orderSpellChoices(withSpellClassChoice(choices ?? []));
}

/**
 * Выбор со ступенями роста — по одному выбору на ступень, с ПРИБАВКОЙ вместо итога.
 *
 * Ступень называет, сколько всего выбрано к её уровню, а спрашивать нужно разницу с
 * предыдущей: оружейных приёмов у воина три с 1 уровня и четыре с 4, то есть на четвёртом
 * игрок выбирает один новый, а не четыре заново. Уровень ступени становится уровнем
 * открытия выбора, и дальше его отбирают те же правила, что и выбор, заданный уровнем
 * вручную.
 *
 * Выбор без ступеней возвращается как есть.
 *
 * @param choices - выборы механики
 * @returns выборы, разложенные по ступеням
 */
export function expandChoiceScaling(
  choices: ReadonlyArray<FeatChoice> | undefined,
): FeatChoice[] {
  return (choices ?? []).flatMap((choice) => {
    const steps = Object.entries(choice.scaling ?? {})
      .map(([level, count]) => ({ level: Number(level), count }))
      .filter((step) => Number.isFinite(step.level) && step.count > 0)
      .sort((first, second) => first.level - second.level);

    if (steps.length === 0) {
      return [choice];
    }

    const expanded: FeatChoice[] = [];

    let previous = 0;

    for (const step of steps) {
      const added = step.count - previous;

      previous = step.count;

      // Ступень, не добавившая ничего, вопросом не становится: выбирать на ней
      // нечего, и шаг мастера повышения уровня был бы пустым
      if (added > 0) {
        expanded.push({
          ...choice,
          count: added,
          requiredLevel: step.level,
          scaling: undefined,
        });
      }
    }

    return expanded;
  });
}

/**
 * Выборы, которые показываются игроку прямо сейчас.
 *
 * Выбор заклинания ждёт ответа про класс: пока список не назван, пул собран не из того
 * справочника, и игрок выбирал бы заклинания, которых черта не даёт.
 *
 * @param choices - выборы черты (уже прошедшие {@link prepareFeatChoices})
 * @param selections - ответы игрока: ключ выбора → значения
 * @returns выборы, которые спрашиваются сейчас
 */
export function getVisibleFeatChoices(
  choices: ReadonlyArray<FeatChoice>,
  selections: Record<string, string[]> | undefined,
): FeatChoice[] {
  return choices.filter((choice) => {
    if (!isSpellPickChoice(choice)) {
      return true;
    }

    const source = findSpellClassChoice(choice, choices);

    return !source || (selections?.[source.key]?.length ?? 0) > 0;
  });
}

/**
 * Ответы, из которых убраны заклинания, выбранные из прежнего списка класса.
 *
 * Смена списка меняет пул: заклинания жреца в списке друида не найдутся, и оставленный
 * ответ выдал бы персонажу заклинание, которого черта уже не даёт.
 *
 * @param choices - выборы черты (уже прошедшие {@link prepareFeatChoices})
 * @param selections - ответы игрока: ключ выбора → значения
 * @param classChoiceKey - ключ выбора списка, который игрок только что переназвал
 * @returns ответы без заклинаний, выбранных из прежнего списка
 */
export function clearSpellChoicesOfClass(
  choices: ReadonlyArray<FeatChoice>,
  selections: Record<string, string[]>,
  classChoiceKey: string,
): Record<string, string[]> {
  const stale = new Set(
    choices
      .filter(
        (choice) =>
          isSpellPickChoice(choice)
          && choice.spellFilter?.classesFromChoiceKey === classChoiceKey,
      )
      .map((choice) => choice.key),
  );

  return Object.fromEntries(
    Object.entries(selections).filter(([key]) => !stale.has(key)),
  );
}

/**
 * Достаёт подписи вариантов из справочника типа выбора.
 *
 * Черта перечисляет варианты значениями и подпись задаёт не всегда: у «Посвящённого в
 * магию» заклинательная характеристика записана тремя ключами без единого названия. Без
 * подстановки игрок увидел бы на кнопках `intelligence` вместо «Интеллект» — само
 * значение верное, показывать его просто нечем.
 *
 * @param choice - выбор черты: его виды задают справочники подписей
 * @param options - варианты, перечисленные чертой
 * @param weapons - виды оружия мира: у оружия справочник подписей тоже свой
 */
function withDictionaryLabels(
  choice: Pick<FeatChoice, 'type' | 'types'>,
  options: ReadonlyArray<FeatChoiceOption>,
  weapons: ReadonlyArray<FeatChoiceOption> = [],
): FeatChoiceOption[] {
  const labels = new Map(
    resolveFeatChoiceTypes(choice)
      .flatMap((type) => getFeatChoiceDefaultPool(type, weapons))
      .map((option) => [option.value, option.name]),
  );

  return options.map((option) =>
    option.name
      ? option
      : { value: option.value, name: labels.get(option.value) ?? option.value },
  );
}

/** Склеенный набор без повторов: справочники видов могут пересекаться. */
function dedupeOptions(
  options: ReadonlyArray<FeatChoiceOption>,
): FeatChoiceOption[] {
  const seen = new Set<string>();
  const result: FeatChoiceOption[] = [];

  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }

    seen.add(option.value);
    result.push(option);
  }

  return result;
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

  if (
    choice.expertiseIfProficient
    && isProficient(actor, resolveFeatChoiceValueType(choice, value), value)
  ) {
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
      // Вид берётся у самого значения: у смешанного набора («навык или
      // инструмент») тип выбора один на всю строку, а лечь значения должны в
      // разные списки владений
      switch (resolveFeatChoiceValueType(choice, value)) {
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
        case 'weaponMastery':
          addUnique(proficiencies.weaponMasteries, value);

          break;
        case 'masteryProperty':
          addUnique((proficiencies.masteryProperties ??= []), value);

          break;
        case 'armor':
          addUnique(proficiencies.armor, value);

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
    weaponMasteries: [],
    masteryProperties: [],
    armor: [],
  };

  if (!featData?.choices || !selections) {
    return result;
  }

  for (const choice of featData.choices) {
    for (const value of selections[choice.key] ?? []) {
      switch (resolveFeatChoiceValueType(choice, value)) {
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
        case 'weaponMastery':
          result.weaponMasteries.push(value);

          break;
        case 'masteryProperty':
          result.masteryProperties.push(value);

          break;
        case 'armor':
          result.armor.push(value);

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
      switch (resolveFeatChoiceValueType(choice, value)) {
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
        case 'weaponMastery':
          removeValue(proficiencies.weaponMasteries, value);

          break;
        case 'masteryProperty':
          removeValue(proficiencies.masteryProperties ?? [], value);

          break;
        case 'armor':
          removeValue(proficiencies.armor, value);

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
 * Защиты по выбору игрока, записанные чертой: список ссылок, а у записей до его
 * появления — развёрнутое легаси-поле.
 *
 * Читается что-то одно: список сильнее, потому что редактор пишет легаси-поле по
 * нему же, и разойтись они могут только в записи от другого потребителя.
 *
 * Единственное место, где легаси-поле разворачивается: и выдача даров, и сводка
 * черты, и её редактор читают защиту по выбору отсюда — иначе у одной и той же
 * старой записи вид зависел бы от того, кто её читает.
 *
 * @param featData - дары черты
 * @returns ссылки «ключ выбора → вид защиты»
 */
export function listFeatDamageDefenseChoices(
  featData: FeatData | null | undefined,
): FeatDamageDefenseChoice[] {
  const listed = (featData?.damageDefenseChoices ?? []).filter((choice) =>
    choice.choiceKey.trim(),
  );

  if (listed.length > 0) {
    return listed;
  }

  const legacy = featData?.modifiers?.resistanceFromChoiceKey?.trim();

  return legacy ? [{ choiceKey: legacy, kind: 'resistance' }] : [];
}

/**
 * Защиты от урона, которые дал ответ игрока: «Отмеченный драконом» выбирает один
 * тип из пяти и получает к нему сопротивление, «Закалённая кожа» — дробящий или
 * рубящий.
 *
 * Ответ приходит строкой из записи листа, поэтому сверяется гвардом: незнакомый
 * тип урона дал бы защиту, которой движок не понимает. Один и тот же тип
 * возвращается один раз — стойким и уязвимым разом он не бывает, и при
 * противоречивой записи побеждает первая ссылка.
 *
 * @param featData - дары черты
 * @param selections - что выбрал игрок
 * @returns защиты по выбранным типам; пусто — черта защиты по выбору не даёт
 */
export function resolveChosenDamageDefenses(
  featData: FeatData | null | undefined,
  selections: Record<string, string[]> | undefined,
): DamageDefenseEntry[] {
  if (!selections) {
    return [];
  }

  const entries: DamageDefenseEntry[] = [];
  const seen = new Set<string>();

  for (const choice of listFeatDamageDefenseChoices(featData)) {
    for (const value of selections[choice.choiceKey.trim()] ?? []) {
      if (!isDefensibleDamageType(value) || seen.has(value)) {
        continue;
      }

      seen.add(value);
      entries.push({ damageType: value, kind: choice.kind });
    }
  }

  return entries;
}

/**
 * Ключ выбора, который лист заводит сам под повышение характеристики.
 *
 * Нужен, когда повышение «на выбор» ни к какому выбору не привязано: в записи
 * компендиума у большинства черт 2024 стоит один `abilityScoreIncrease.choice`
 * без {@code fromChoiceKey} — «+1 к Силе или Телосложению» и есть весь выбор,
 * отдельной строкой его никто не описывает. Само по себе такое повышение
 * движок не применяет, поэтому лист спрашивает характеристику под этим ключом
 * и по нему же её и поднимает.
 */
export const ABILITY_INCREASE_CHOICE_KEY = 'abilityScoreIncrease#';

/**
 * Характеристики, выбранные для повышения. «Устойчивый» поднимает ту характеристику,
 * спасбросками которой персонаж овладел, — повышение ссылается на выбор через
 * {@code fromChoiceKey}. Привязки нет — ответ ищется под собственным ключом листа
 * ({@link ABILITY_INCREASE_CHOICE_KEY}).
 *
 * @param featData - дары черты
 * @param selections - что выбрал игрок
 * @returns выбранные характеристики
 */
export function resolveChosenAbilities(
  featData: FeatData | null | undefined,
  selections: Record<string, string[]> | undefined,
): AbilityType[] {
  const increase = featData?.abilityScoreIncrease;

  if (!increase?.choice && !increase?.fromChoiceKey) {
    return [];
  }

  const key = increase.fromChoiceKey ?? ABILITY_INCREASE_CHOICE_KEY;

  if (!selections) {
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
