/**
 * Локальные типы редактирования черты (форма «Создать/Редактировать черту»).
 *
 * Форма держит механику черты СТРОКАМИ — по одной на то, что черта реально
 * даёт, — а при сохранении собирает их в блоб {@link FeatData}
 * (`buildFeatData`); при открытии блоб разворачивается обратно
 * (`featDataToGrants`). Строки вместо плоских полей потому, что у черты почти
 * всё необязательно: раскладка полями рисовала два десятка всегда пустых
 * инпутов, а половина механики (выборы) жила отдельно от того же самого,
 * заданного списком.
 *
 * Одно и то же в двух видах здесь не хранится: владение и выбор владения —
 * одна строка с режимом, требование к характеристике всегда «одна из»,
 * повышение характеристики по выбору всегда привязано к строке-выбору.
 */

import type { AbilityType, DefensibleDamageType } from '@vtt/shared';
import type {
  ConditionKey,
  DamageDefenseKind,
  FeatAbilityScoreIncrease,
  FeatChoice,
  FeatChoiceOption,
  FeatChoiceSpellFilter,
  FeatChoiceType,
  FeatClassFeatureRequirement,
  FeatCounterDefinition,
  FeatDamageDefenseChoice,
  FeatData,
  FeatGrantedClassSpells,
  FeatModifiers,
  FeatPrerequisite,
  FeatPrerequisiteRef,
  FeatSenseKind,
  FeatSpellListExpansion,
  FeatSpellListGroup,
  GrantedSpellRef,
} from '@vtt/shared/system/dnd.js';

import type { EditableResourceCounter } from '../counterEditorTypes';

import { generateId, typedObjectEntries } from '@vtt/shared';
import {
  CANTRIP_SPELL_LEVEL,
  CLASS_FEATURE_NAMES,
  classKeyFromUrl,
  FEAT_CHOICE_TYPE_LABELS,
  getFeatChoiceDefaultPool,
  isAbilityType,
  isDefensibleDamageType,
  isSkillType,
  listFeatDamageDefenseChoices,
  resolveFeatChoiceTypes,
  resolveFeatChoiceValueType,
  SPELL_LEVEL_OPTIONS,
} from '@vtt/shared/system/dnd.js';

import {
  FEAT_GRANTS_LABELS,
  MODIFIER_ROW_LABELS,
  SPELL_CHOICE_LABELS,
  SPELL_LIST_LABELS,
} from '../constants';
import {
  entriesToProgression,
  progressionToEntries,
} from '../counterEditorTypes';

/** Характеристики в порядке вывода. */
export const ABILITY_KEYS: readonly AbilityType[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

// ── Строка дара (вкладка «Владения») ──────────────────────────

/**
 * Что раздаёт строка дара. Заклинания сюда не входят — у них своя вкладка со
 * своим фильтром.
 */
export type GrantRowKind = Extract<
  FeatChoiceType,
  | 'skill'
  | 'savingThrow'
  | 'armor'
  | 'weapon'
  | 'weaponMastery'
  | 'masteryProperty'
  | 'tool'
  | 'language'
  | 'ability'
  | 'damageType'
  | 'option'
  | 'feat'
>;

/** Виды дара в порядке показа — они же множество для проверки строки. */
const GRANT_ROW_KINDS: readonly GrantRowKind[] = [
  'skill',
  'savingThrow',
  'tool',
  'language',
  'armor',
  'weapon',
  'weaponMastery',
  'masteryProperty',
  'ability',
  'damageType',
  'option',
  'feat',
];

const GRANT_ROW_KIND_SET: ReadonlySet<string> = new Set(GRANT_ROW_KINDS);

/**
 * Годится ли тип выбора в строку дара. Заклинания и списки классов живут на
 * своей вкладке, а легаси-`skillOrTool` движок разворачивает в два вида — здесь
 * его быть уже не может.
 *
 * @param type - тип выбора черты
 */
export function isGrantRowKind(type: FeatChoiceType): type is GrantRowKind {
  return GRANT_ROW_KIND_SET.has(type);
}

/**
 * Виды, которые можно смешать в одной строке. Их значения описаны
 * справочниками правил, поэтому выбранное раскладывается по принадлежности:
 * `sleightOfHand` — навык, `thieves-tools` — инструмент.
 *
 * Оружие, приёмы, черта и «вариант» сюда не входят: их значения приходят из
 * данных мира, компендиума и самой черты, и разобрать их по справочнику нечем.
 */
const MIXABLE_KINDS: ReadonlySet<GrantRowKind> = new Set([
  'skill',
  'savingThrow',
  'tool',
  'language',
  'ability',
  'damageType',
]);

/** Можно ли смешать этот вид с другими в одной строке. */
export function isMixableKind(kind: GrantRowKind): boolean {
  return MIXABLE_KINDS.has(kind);
}

/** Основной вид строки: он же единственный, когда вид один. */
export function primaryKind(row: { kinds: GrantRowKind[] }): GrantRowKind {
  return row.kinds[0] ?? 'skill';
}

/** Есть ли этот вид среди видов строки. */
export function hasKind(
  row: { kinds: GrantRowKind[] },
  kind: GrantRowKind,
): boolean {
  return row.kinds.includes(kind);
}

/**
 * Как раздаётся: всё перечисленное сразу или игрок выбирает из набора.
 * Это единственное отличие «владений» от «выборов» — механика одна.
 */
export type GrantRowMode = 'all' | 'choice';

/** Строка дара: что черта выдаёт или из чего даёт выбрать. */
export interface EditableGrantRow {
  /** Ключ строки списка — живёт только в форме */
  uid: string;
  /**
   * Виды дара строки. Обычно один; несколько — когда выбирают из нескольких
   * справочников сразу («Умелый»: навык или инструмент). Смешивать можно только
   * виды со справочником правил ({@link isMixableKind}).
   */
  kinds: GrantRowKind[];
  mode: GrantRowMode;
  /** `all` — что выдаётся; `choice` — набор для выбора (пусто = весь справочник) */
  options: FeatChoiceOption[];
  /**
   * Категории черт, из которых выбирают, — только у вида «Черта» в режиме
   * выбора. Пусто — категория не ограничена. Складывается с набором: перечень
   * черт сужает пул внутри названных категорий.
   */
  featCategories: string[];
  /** Машинный ключ выбора: по нему лист хранит ответ игрока */
  key: string;
  /** Подпись для игрока */
  label: string;
  /** Сколько значений выбирают */
  count: number;
  /** Количество равно бонусу мастерства и растёт вместе с ним */
  countEqualsProficiencyBonus: boolean;
  /** Что даёт выбор: владение или компетентность */
  grants: 'proficiency' | 'expertise';
  onlyIfNotProficient: boolean;
  onlyIfProficient: boolean;
  expertiseIfProficient: boolean;
  /** Выбор пересматривается на продолжительном отдыхе («Мастер оружия») */
  rechooseOnLongRest: boolean;
  /**
   * Прибавка к характеристике. Больше нуля — строка поднимает характеристику:
   * в режиме «все» перечисленные, в режиме выбора — ту, что выбрал игрок
   * («Устойчивый» поднимает характеристику своего спасброска).
   */
  abilityAmount: number;
  /** Предел повышения: 20 у обычных черт, 30 у эпических даров (0 — не задан) */
  abilityUpto: number;
  /** Уровень, с которого выбор спрашивают; 0 — сразу */
  requiredLevel: number;
  /**
   * Ступени количества по уровням: сколько ВСЕГО выбирают к каждому уровню.
   * Пусто — количество не растёт и задано {@link count}.
   */
  scaling: EditableChoiceScaling[];
  /** Показывать количество колонкой таблицы прогрессии класса */
  showInTable: boolean;
  /** Краткая подпись колонки таблицы; пусто — берётся подпись выбора */
  shortName: string;
}

/** Ступень количества выбора в форме: уровень и сколько всего выбрано к нему. */
export interface EditableChoiceScaling {
  uid: string;
  level: number;
  count: number;
}

// ── Выбор заклинаний (вкладка «Заклинания») ───────────────────

/** Типы выбора, живущие на вкладке заклинаний. */
export const SPELL_CHOICE_TYPES: readonly FeatChoiceType[] = [
  'spell',
  'cantrip',
  'spellList',
  'spellcastingAbility',
];

/** Как задан круг порции заклинаний. */
export type SpellLevelMode = 'any' | 'exact' | 'upTo';

/** Откуда порция заклинаний берёт пул. */
export type SpellPickSource = 'filter' | 'list';

/**
 * Порция заклинаний, которую игрок берёт при взятии черты: «два заговора»,
 * «одно заклинание первого круга».
 *
 * Порций бывает несколько, а список классов у них общий: «Посвящённый в магию»
 * спрашивает класс один раз и берёт из него и заговоры, и заклинание первого
 * круга. Поэтому классы живут в блоке ({@link EditableSpellChoiceBlock}), а не
 * в порции.
 */
export interface EditableSpellPickRow {
  uid: string;
  /** Машинный ключ выбора: по нему лист помнит ответ игрока. Автору не виден */
  key: string;
  mode: SpellLevelMode;
  /** Круг: точный при `exact`, наибольший при `upTo`; у `any` не задан */
  level: number | undefined;
  count: number;
  countEqualsProficiencyBonus: boolean;
  label: string;
  /** Школы магии, любой из которых достаточно; пусто — любая */
  schools: string[];
  /** Время накладывания (`ritual`, `action`, …); пусто — любое */
  castingTime: string;
  /**
   * Откуда пул порции: `filter` — поиском по компендиуму по кругу и спискам
   * классов блока, `list` — ровно из перечисленных заклинаний. У перечисленных
   * круг и класс свои, и порция их не спрашивает.
   */
  source: SpellPickSource;
  /**
   * Перечисленные заклинания — пул порции при `source: 'list'`; иначе пусто.
   * В записи лежат набором значений выбора (`options`: id записи и снимок
   * названия), а правятся тем же редактором, что и выданные заклинания.
   */
  listedSpells: GrantedSpellRef[];
  /** Выбор пересматривается на отдыхе. Приходит из записи, формой не правится */
  rechooseOnLongRest: boolean;
  /**
   * Уровень персонажа, с которого порцию спрашивают; 0 — сразу. Приходит из
   * записи и формой не правится, но и не теряется при пересохранении: без него
   * «Таинственный арканум» спросил бы все круги разом.
   */
  requiredLevel: number;
}

/**
 * Выбор заклинаний черты целиком.
 *
 * Блок, а не список строк: класс и заклинательная характеристика общие для всех
 * порций, и спрашивать их у каждой порции значило бы спрашивать дважды.
 * Служебный выбор класса и ссылку на него форма пишет сама — автору о них знать
 * незачем.
 */
export interface EditableSpellChoiceBlock {
  /**
   * Классы, из чьих списков берутся заклинания. Больше одного — игрок сначала
   * выбирает один из них, и пул сужается до него: по правилам список один, а не
   * объединение перечисленных.
   */
  classKeys: string[];
  /**
   * Ссылки на страницы классов из компендиума. Форма их не правит — отбор идёт
   * по {@link classKeys}, — но и не теряет: снятый автором класс уходит вместе
   * со своей ссылкой.
   */
  classes: FeatPrerequisiteRef[];
  /** Машинный ключ служебного выбора класса */
  classChoiceKey: string;
  picks: EditableSpellPickRow[];
  /**
   * Характеристики, от которых считаются заклинания черты — и выданные, и
   * выбранные. Пусто — характеристика берётся от класса; одна — задана жёстко;
   * несколько — игрок выбирает одну из них.
   */
  abilityOptions: AbilityType[];
  /** Машинный ключ выбора характеристики */
  abilityChoiceKey: string;
}

/** Приставка ключа выбора типа урона у строки защиты. */
const DAMAGE_DEFENSE_CHOICE_KEY_PREFIX = 'damageType';

/** Ключ служебного выбора класса по умолчанию. */
const SPELL_LIST_CHOICE_KEY = 'spellList';

/** Ключ выбора заклинательной характеристики по умолчанию. */
const SPELLCASTING_ABILITY_CHOICE_KEY = 'spellcastingAbility';

/** Приставка ключа порции заклинаний. */
const SPELL_PICK_KEY_PREFIX = 'spell';

/** Приставка ключа порции заговоров: так ключ читается без заглядывания в круг. */
const CANTRIP_PICK_KEY_PREFIX = 'cantrip';

/** Значение селекта «любой круг»: в фильтр не пишется — там его задаёт пустота. */
const SPELL_LEVEL_ANY_VALUE = 'any';

/** Приставка значения селекта для точного круга. */
const SPELL_LEVEL_EXACT_PREFIX = 'exact:';

/** Приставка значения селекта для потолка круга. */
const SPELL_LEVEL_UP_TO_PREFIX = 'upTo:';

// ── Строка модификатора (вкладка «Автоматизация») ─────────────

/** Что меняет строка модификатора на листе. */
export type ModifierRowKind =
  | 'hitPointsFlat'
  | 'hitPointsPerAcquisitionLevel'
  | 'hitPointsPerLevelAfterAcquisition'
  | 'speedWalk'
  | 'speedFly'
  | 'speedClimb'
  | 'speedSwim'
  | 'armorClass'
  | 'initiative'
  | 'initiativeProficiencyBonus'
  | 'darkvision'
  | 'senseBlindsight'
  | 'senseTruesight'
  | 'senseTremorsense'
  | 'telepathy'
  | 'damageDefense'
  | 'conditionImmunity';

/** Как задан тип урона у строки защиты. */
export type DamageDefenseSource = 'fixed' | 'choice';

/** Строка модификатора: одна правка листа. */
export interface EditableModifierRow {
  uid: string;
  kind: ModifierRowKind;
  /** Числовое значение: футы, хиты, прибавка */
  value: number;
  /** Вид движения равен скорости ходьбы (число тогда не нужно) */
  equalsWalk: boolean;
  /** Только у защиты от урона: тип назвал автор или называет игрок */
  source: DamageDefenseSource;
  /** Тип урона, заданный автором; только у режима «фиксированный» */
  damageType: DefensibleDamageType;
  /**
   * Набор, из которого игрок называет тип урона; только у режима «на выбор».
   * Пусто — любой тип: перечислять весь справочник незачем, лист подставит его
   * сам.
   */
  damageTypes: DefensibleDamageType[];
  /**
   * Машинный ключ выбора: по нему защита ссылается на ответ игрока. Автору не
   * показан — форма выделяет его сама, как и у выбора класса заклинаний.
   */
  key: string;
  /** Подпись пикера на листе; пусто — лист подпишет его сам */
  label: string;
  /** Сколько типов урона называет игрок */
  count: number;
  /** Что выбранный (или заданный) тип урона получает */
  defenseKind: DamageDefenseKind;
  /** Только у иммунитета к состоянию */
  condition: ConditionKey;
}

/** Строка защиты, тип урона у которой называет игрок. */
export function isDamageDefenseChoiceRow(row: EditableModifierRow): boolean {
  return row.kind === 'damageDefense' && row.source === 'choice';
}

/** Строка защиты с типом урона, заданным автором. */
export function isFixedDamageDefenseRow(row: EditableModifierRow): boolean {
  return row.kind === 'damageDefense' && row.source === 'fixed';
}

/** Виды движения, у которых есть спутник «равна скорости ходьбы». */
const EQUALS_WALK_KINDS: ReadonlySet<ModifierRowKind> = new Set([
  'speedFly',
  'speedClimb',
  'speedSwim',
]);

/** Есть ли у модификатора галочка «равна скорости ходьбы». */
export function modifierSupportsEqualsWalk(kind: ModifierRowKind): boolean {
  return EQUALS_WALK_KINDS.has(kind);
}

/** Модификаторы без числового значения — сам факт и есть значение. */
const FLAG_MODIFIER_KINDS: ReadonlySet<ModifierRowKind> = new Set([
  'initiativeProficiencyBonus',
  'damageDefense',
  'conditionImmunity',
]);

/** Нужно ли модификатору числовое поле. */
export function modifierHasValue(kind: ModifierRowKind): boolean {
  return !FLAG_MODIFIER_KINDS.has(kind);
}

/** Чувства-модификаторы и их вид в блобе черты. */
const SENSE_MODIFIER_KINDS: Partial<Record<ModifierRowKind, FeatSenseKind>> = {
  senseBlindsight: 'blindsight',
  senseTruesight: 'truesight',
  senseTremorsense: 'tremorsense',
};

// ── Строка требования (вкладка «Требования») ──────────────────

/** Что требует строка. */
export type PrerequisiteRowKind =
  | 'ability'
  | 'level'
  | 'spellcasting'
  | 'classFeature'
  | 'armorProficiency'
  | 'feat'
  | 'class'
  | 'species'
  | 'background'
  | 'campaign'
  | 'anyDragonmark'
  | 'text';

/**
 * Строка требования. Внутри строки значения соединяются по «ИЛИ» (одна
 * характеристика читается как «Сила 13+», несколько — как «Сила или Ловкость
 * 13+»), сами строки — по «И».
 */
export interface EditablePrerequisiteRow {
  uid: string;
  kind: PrerequisiteRowKind;
  /** Характеристики строки «одна из» */
  abilities: AbilityType[];
  /** Минимум характеристики либо минимальный уровень */
  minValue: number;
  classFeatures: FeatClassFeatureRequirement[];
  armor: string[];
  /** Требуемые записи справочника (черты/классы/виды/предыстории) */
  refs: FeatPrerequisiteRef[];
  /** Сеттинг кампании либо произвольный текст */
  text: string;
}

/** Требования-ссылки и поле блоба, в которое они складываются. */
const REF_PREREQUISITE_FIELDS = {
  feat: 'feats',
  class: 'classes',
  species: 'species',
  background: 'backgrounds',
} as const;

/** Вид требования-ссылки (у таких строк редактируется список записей). */
export type RefPrerequisiteKind = keyof typeof REF_PREREQUISITE_FIELDS;

/** Требование-ссылка ли это. */
export function isRefPrerequisite(
  kind: PrerequisiteRowKind,
): kind is RefPrerequisiteKind {
  return kind in REF_PREREQUISITE_FIELDS;
}

// ── Ресурс черты (вкладка «Автоматизация») ────────────────────

/** Строка ресурса черты. */
// ── Список заклинаний класса (вкладка «Заклинания») ───────────

/**
 * Ступень таблицы «Заклинания метки»: заклинания, которые черта добавляет в
 * список класса с определённого уровня.
 *
 * Ступенями, а не одним списком, потому что таблица открывается частями:
 * заклинания метки дракона приходят на 1, 3, 5, 7 и 9 уровнях, и «весь список
 * сразу» сделал бы черту сильнее книжной.
 */
export interface EditableSpellListGroup {
  uid: string;
  /** Уровень персонажа, с которого ступень открывается; пусто — сразу */
  requiredLevel?: number;
  /**
   * Заклинания ступени — целиком: расширение не спрашивает «сколько взять», оно
   * лишь открывает заклинания для подготовки. «Выбрать N из перечисленных» —
   * это порция выбора заклинаний с перечисленным пулом
   * ({@link EditableSpellPickRow.listedSpells}).
   */
  spells: GrantedSpellRef[];
}

/** Расширение списка заклинаний класса целиком. */
export interface EditableSpellListExpansion {
  /**
   * Расширять список, только если персонаж умеет творить заклинания. Так у всех
   * черт метки дракона: без «Использования заклинаний» расширять нечего.
   */
  requiresSpellcasting: boolean;
  /** Ступени таблицы в порядке показа */
  groups: EditableSpellListGroup[];
}

/** Заводит пустую ступень таблицы. */
export function createSpellListGroup(): EditableSpellListGroup {
  return {
    uid: generateId('spell-list'),
    requiredLevel: undefined,
    spells: [],
  };
}

/**
 * Заголовок ступени: с какого уровня открывается.
 *
 * @param group - ступень таблицы
 */
export function spellListGroupTitle(group: EditableSpellListGroup): string {
  return group.requiredLevel && group.requiredLevel > 1
    ? `${SPELL_LIST_LABELS.fromLevelPrefix} ${group.requiredLevel} ${SPELL_LIST_LABELS.fromLevelSuffix}`
    : SPELL_LIST_LABELS.fromStart;
}

// ── Модель формы целиком ──────────────────────────────────────

/** Редактируемая механика черты. */
export interface EditableFeatGrants {
  /** Владения, повышения характеристик, защиты по выбору, варианты */
  grantRows: EditableGrantRow[];
  /** Заклинания, которые игрок выбирает сам при взятии черты */
  spellChoice: EditableSpellChoiceBlock;
  /** Постоянные правки листа */
  modifiers: EditableModifierRow[];
  /** Требования черты */
  prerequisites: EditablePrerequisiteRow[];
  /** Ресурсы со своим счётчиком */
  counters: EditableResourceCounter[];
  /** Заклинания, которые черта добавляет в список заклинаний класса */
  spellList: EditableSpellListExpansion;
  /** Выдача заклинаний группами: перечисленные и списки классов целиком */
  grantedSpellGroups: EditableGrantedSpellGroup[];
  /** Выданные чертой заклинания не нужно готовить */
  grantedSpellsAlwaysPrepared: boolean;
}

/**
 * Группа выдачи заклинаний: своя ступень уровня и свой источник.
 *
 * Группами, а не одним списком: заклинания приходят ступенями — у домена жреца
 * первая пачка на третьем уровне, следующая на пятом, — и у каждой ступени свой
 * уровень открытия. Группа либо перечисляет заклинания, либо выдаёт весь список
 * класса: перечень — снимок на момент сохранения, и заклинание, заведённое в
 * компендиуме позже, в него не попадёт, а список собирается при выдаче.
 *
 * Одна модель на все записи, но раскладывается она по-разному. У черты,
 * предыстории, класса и варианта умения группы уезжают в блоб даров
 * (`featData.grantedSpells` с уровнем у каждой ссылки и
 * `featData.grantedClassSpells`). У умения класса перечисления ложатся в поля
 * самой записи (`grantedSpells` и `grantedSpellsByLevel`): там гейт по уровню
 * КЛАССА, а не персонажа, и для умения это правильнее.
 */
export interface EditableGrantedSpellGroup {
  /** Ключ строки для `v-for`: группы удаляют из середины списка */
  uid: string;
  /** Что выдаётся: перечисленные заклинания либо весь список класса */
  source: GrantedSpellGroupSource;
  /** Уровень, с которого группа выдаётся; пусто — сразу при взятии записи */
  requiredLevel?: number;
  /** Перечисленные заклинания — при `source: 'list'`; иначе пусто */
  spells: GrantedSpellRef[];
  /** Ключи классов, чьи списки выдаются — при `source: 'classList'`; иначе пусто */
  classKeys: string[];
  /** Названия классов на момент выбора — подпись, когда записи класса в паках нет */
  classNames: string[];
  /** Пак, из которого выбран класс: подсказка, на сбор заклинаний не влияет */
  classPackId?: string;
  /** Паки, из которых брать заклинания; пусто — из всех доступных */
  spellPackIds: string[];
  /** Как ограничен круг списка класса; у перечисленных круг свой у каждой записи */
  levelMode: ClassSpellsLevelMode;
  /** Круг: точный при `exact`, наибольший при `upTo`; иначе не задан */
  level?: number;
  /**
   * Характеристика, от которой считаются заклинания группы; пусто — берётся выше:
   * ответом игрока, характеристикой записи, характеристикой класса.
   */
  spellcastingAbility?: AbilityType;
  /** Заклинания группы не занимают подготовку */
  alwaysPrepared: boolean;
}

/** Откуда группа берёт заклинания. */
export type GrantedSpellGroupSource = 'list' | 'classList';

/** Как ограничен круг у группы «весь список класса». */
export type ClassSpellsLevelMode = 'any' | 'exact' | 'upTo' | 'slots';

/** Что выдаётся группой — варианты селекта строки. */
export const GRANTED_SPELL_GROUP_SOURCE_OPTIONS: {
  value: GrantedSpellGroupSource;
  label: string;
}[] = [
  { value: 'list', label: 'Перечисленные' },
  { value: 'classList', label: 'Весь список класса' },
];

/**
 * Круг группы «весь список класса» одним списком.
 *
 * «Не выше доступного круга» есть только здесь, а не у порции выбора: выбирает игрок
 * сам и видит круг в списке, а выдача сыплется на лист молча — и «все заклинания
 * друида» без границы дали бы девятый круг на первом уровне.
 */
export const CLASS_SPELLS_LEVEL_OPTIONS: {
  value: string;
  label: string;
}[] = [
  { value: 'any', label: 'Любой круг' },
  { value: 'slots', label: 'Не выше доступного круга' },
  ...Array.from({ length: 10 }, (_unused, level) => ({
    value: `exact:${level}`,
    label: level === 0 ? 'Заговор' : `${level} круг`,
  })),
  ...Array.from({ length: 9 }, (_unused, index) => ({
    value: `upTo:${index + 1}`,
    label: `Не выше ${index + 1} круга`,
  })),
];

/**
 * Значение селекта круга по группе.
 *
 * @param group - группа выдачи
 */
export function classSpellsLevelValue(
  group: EditableGrantedSpellGroup,
): string {
  if (group.levelMode === 'any' || group.levelMode === 'slots') {
    return group.levelMode;
  }

  return `${group.levelMode}:${group.level ?? 0}`;
}

/**
 * Круг группы по значению селекта. Незнакомое значение читается как «любой круг».
 *
 * @param value - значение селекта
 */
export function parseClassSpellsLevelValue(value: string): {
  levelMode: ClassSpellsLevelMode;
  level?: number;
} {
  if (value === 'slots') {
    return { levelMode: 'slots' };
  }

  const [mode, rawLevel] = value.split(':');
  const level = Number.parseInt(rawLevel ?? '', 10);

  if ((mode === 'exact' || mode === 'upTo') && !Number.isNaN(level)) {
    return { levelMode: mode, level };
  }

  return { levelMode: 'any' };
}

/**
 * Новая группа выдачи. По умолчанию перечисление: список класса заводят реже, и
 * автору проще переключить источник, чем каждый раз возвращать его обратно.
 */
export function createGrantedSpellGroup(): EditableGrantedSpellGroup {
  return {
    uid: generateId('granted-spells'),
    source: 'list',
    spells: [],
    classKeys: [],
    classNames: [],
    spellPackIds: [],
    levelMode: 'slots',
    alwaysPrepared: false,
  };
}

/**
 * Заголовок группы: что выдаётся и с какого уровня. По нему автор находит нужную
 * ступень, не разворачивая её.
 *
 * @param group - группа выдачи
 */
export function grantedSpellGroupTitle(
  group: EditableGrantedSpellGroup,
): string {
  const level = group.requiredLevel
    ? `с ${group.requiredLevel} уровня`
    : 'сразу';

  if (group.source === 'list') {
    return `Перечисленные — ${level}`;
  }

  const classes = group.classNames.length
    ? group.classNames.join(', ')
    : group.classKeys.join(', ') || 'класс не выбран';

  return `${classes} — ${level}`;
}

/**
 * Группа перечисленных заклинаний с готовым содержимым — для разбора уже
 * сохранённых записей.
 *
 * @param spells - заклинания группы
 * @param requiredLevel - уровень, с которого группа выдаётся
 */
export function listGrantedSpellGroup(
  spells: GrantedSpellRef[],
  requiredLevel?: number,
): EditableGrantedSpellGroup {
  return {
    ...createGrantedSpellGroup(),
    requiredLevel,
    spells,
  };
}

/** Пустая механика черты. */
export function createEmptyFeatGrants(): EditableFeatGrants {
  return {
    grantRows: [],
    spellChoice: createSpellChoiceBlock(),
    modifiers: [],
    prerequisites: [],
    counters: [],
    spellList: { requiresSpellcasting: false, groups: [] },
    grantedSpellGroups: [],
    grantedSpellsAlwaysPrepared: false,
  };
}

// ── Справочники для селектов формы ────────────────────────────

/** Виды даров в порядке показа с подписями. */
export const GRANT_ROW_KIND_OPTIONS: {
  value: GrantRowKind;
  label: string;
}[] = [
  { value: 'skill', label: FEAT_CHOICE_TYPE_LABELS.skill },
  { value: 'savingThrow', label: FEAT_CHOICE_TYPE_LABELS.savingThrow },
  { value: 'tool', label: FEAT_CHOICE_TYPE_LABELS.tool },
  { value: 'language', label: FEAT_CHOICE_TYPE_LABELS.language },
  { value: 'armor', label: FEAT_GRANTS_LABELS.kindArmor },
  { value: 'weapon', label: FEAT_CHOICE_TYPE_LABELS.weapon },
  { value: 'weaponMastery', label: FEAT_CHOICE_TYPE_LABELS.weaponMastery },
  {
    value: 'masteryProperty',
    label: FEAT_CHOICE_TYPE_LABELS.masteryProperty,
  },
  { value: 'ability', label: FEAT_CHOICE_TYPE_LABELS.ability },
  { value: 'damageType', label: FEAT_CHOICE_TYPE_LABELS.damageType },
  { value: 'option', label: FEAT_CHOICE_TYPE_LABELS.option },
  { value: 'feat', label: FEAT_CHOICE_TYPE_LABELS.feat },
];

/**
 * Круг порции заклинаний одним списком: «любой круг», точный круг и потолок.
 * Двумя полями то же самое задавалось противоречиво — автор ставил и круг, и
 * потолок, а значило это уже третье.
 */
export const SPELL_PICK_LEVEL_OPTIONS: {
  value: string;
  label: string;
}[] = [
  { value: SPELL_LEVEL_ANY_VALUE, label: SPELL_CHOICE_LABELS.anyLevel },
  ...SPELL_LEVEL_OPTIONS.map((option) => ({
    value: `${SPELL_LEVEL_EXACT_PREFIX}${option.value}`,
    label: option.label,
  })),
  ...SPELL_LEVEL_OPTIONS.filter(
    (option) => option.value !== CANTRIP_SPELL_LEVEL,
  ).map((option) => ({
    value: `${SPELL_LEVEL_UP_TO_PREFIX}${option.value}`,
    label: `${SPELL_CHOICE_LABELS.upToLevelPrefix}${option.value}${SPELL_CHOICE_LABELS.upToLevelSuffix}`,
  })),
];

/**
 * Значение селекта круга по порции.
 *
 * @param row - порция заклинаний
 */
export function getSpellPickLevelValue(row: EditableSpellPickRow): string {
  if (row.mode === 'any' || row.level === undefined) {
    return SPELL_LEVEL_ANY_VALUE;
  }

  return row.mode === 'upTo'
    ? `${SPELL_LEVEL_UP_TO_PREFIX}${row.level}`
    : `${SPELL_LEVEL_EXACT_PREFIX}${row.level}`;
}

/**
 * Круг порции по значению селекта. Незнакомое значение читается как «любой
 * круг» — так же читается и пустой фильтр.
 *
 * @param value - значение селекта
 */
export function parseSpellPickLevelValue(value: string): {
  mode: SpellLevelMode;
  level: number | undefined;
} {
  const prefixes: [string, SpellLevelMode][] = [
    [SPELL_LEVEL_EXACT_PREFIX, 'exact'],
    [SPELL_LEVEL_UP_TO_PREFIX, 'upTo'],
  ];

  for (const [prefix, mode] of prefixes) {
    if (value.startsWith(prefix)) {
      const level = Number.parseInt(value.slice(prefix.length), 10);

      if (!Number.isNaN(level)) {
        return { mode, level };
      }
    }
  }

  return { mode: 'any', level: undefined };
}

/** Виды модификаторов в порядке меню «Добавить». */
export const MODIFIER_ROW_KIND_OPTIONS: {
  value: ModifierRowKind;
  label: string;
}[] = typedObjectEntries(MODIFIER_ROW_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Виды требований в порядке меню «Добавить». */
export const PREREQUISITE_ROW_KIND_OPTIONS: {
  value: PrerequisiteRowKind;
  label: string;
}[] = [
  { value: 'ability', label: FEAT_GRANTS_LABELS.prerequisiteAnyOfTitle },
  { value: 'level', label: FEAT_GRANTS_LABELS.prerequisiteMinLevel },
  { value: 'spellcasting', label: FEAT_GRANTS_LABELS.prerequisiteSpellcasting },
  {
    value: 'classFeature',
    label: FEAT_GRANTS_LABELS.prerequisiteClassFeatures,
  },
  {
    value: 'armorProficiency',
    label: FEAT_GRANTS_LABELS.prerequisiteArmorProficiency,
  },
  { value: 'feat', label: FEAT_GRANTS_LABELS.prerequisiteFeats },
  { value: 'class', label: FEAT_GRANTS_LABELS.prerequisiteClasses },
  { value: 'species', label: FEAT_GRANTS_LABELS.prerequisiteSpecies },
  { value: 'background', label: FEAT_GRANTS_LABELS.prerequisiteBackgrounds },
  { value: 'campaign', label: FEAT_GRANTS_LABELS.prerequisiteCampaign },
  {
    value: 'anyDragonmark',
    label: FEAT_GRANTS_LABELS.prerequisiteAnyDragonmark,
  },
  { value: 'text', label: FEAT_GRANTS_LABELS.prerequisiteText },
];

/** Варианты классового умения-требования. */
export const CLASS_FEATURE_REQUIREMENT_OPTIONS: {
  value: FeatClassFeatureRequirement;
  label: string;
}[] = typedObjectEntries(CLASS_FEATURE_NAMES).map(([value, label]) => ({
  value,
  label,
}));

// ── Фабрики строк ─────────────────────────────────────────────

/**
 * Свободный ключ выбора: подпись у выбора русская, а машинный ключ должен
 * оставаться латиницей, поэтому он строится из вида дара и номера.
 *
 * @param prefix - вид дара или выбора
 * @param taken - уже занятые ключи черты
 */
function freeKey(prefix: string, taken: ReadonlySet<string>): string {
  let index = 1;

  while (taken.has(`${prefix}-${index}`)) {
    index += 1;
  }

  return `${prefix}-${index}`;
}

/**
 * Проставляет строке ключ, если его нет. Ключ машинный и в окне не показан —
 * задать его руками нельзя, поэтому пустой чинится молча, а не роняет выбор.
 * Занятые ключи копятся в переданном множестве.
 *
 * @param row - строка выбора
 * @param row.key - машинный ключ строки; проставляется на месте
 * @param prefix - вид дара или тип выбора (основа ключа)
 * @param taken - занятые ключи черты; пополняется на месте
 */
function ensureKey(
  row: { key: string },
  prefix: string,
  taken: Set<string>,
): void {
  if (row.key.trim()) {
    return;
  }

  row.key = freeKey(prefix, taken);
  taken.add(row.key);
}

/** Все ключи выборов черты — по ним генерится свободный. */
export function usedChoiceKeys(grants: EditableFeatGrants): Set<string> {
  return new Set(
    [
      ...grants.grantRows.map((row) => row.key),
      // Строки защиты по выбору тоже адресуют ответ игрока — их ключи заняты
      // наравне с ключами даров
      ...grants.modifiers.map((row) => row.key),
      ...grants.spellChoice.picks.map((row) => row.key),
      grants.spellChoice.classChoiceKey,
      grants.spellChoice.abilityChoiceKey,
    ].filter((key) => !!key.trim()),
  );
}

/** Заводит строку дара. */
export function createGrantRow(
  kind: GrantRowKind,
  taken: ReadonlySet<string>,
): EditableGrantRow {
  return {
    uid: generateId('grant'),
    kinds: [kind],
    // Черту без выбора выдают редко, а вот «дать выбрать боевой стиль» — это
    // и есть обычный случай: строке черты выбор ставится сразу
    mode: kind === 'feat' ? 'choice' : 'all',
    options: [],
    featCategories: [],
    key: freeKey(kind, taken),
    label: '',
    count: 1,
    countEqualsProficiencyBonus: false,
    grants: 'proficiency',
    onlyIfNotProficient: false,
    onlyIfProficient: false,
    expertiseIfProficient: false,
    rechooseOnLongRest: false,
    abilityAmount: kind === 'ability' ? 1 : 0,
    abilityUpto: kind === 'ability' ? 20 : 0,
    requiredLevel: 0,
    scaling: [],
    showInTable: false,
    shortName: '',
  };
}

/**
 * Заводит порцию заклинаний. Круг по умолчанию — заговор: с него начинаются
 * почти все черты, дающие заклинания.
 *
 * @param taken - ключи выборов, занятые в черте
 */
export function createSpellPickRow(
  taken: ReadonlySet<string>,
): EditableSpellPickRow {
  return {
    uid: generateId('spellpick'),
    key: freeKey(CANTRIP_PICK_KEY_PREFIX, taken),
    mode: 'exact',
    level: CANTRIP_SPELL_LEVEL,
    count: 1,
    countEqualsProficiencyBonus: false,
    label: '',
    schools: [],
    castingTime: '',
    source: 'filter',
    listedSpells: [],
    rechooseOnLongRest: false,
    requiredLevel: 0,
  };
}

/** Пустой выбор заклинаний: черта заклинаний не спрашивает. */
export function createSpellChoiceBlock(): EditableSpellChoiceBlock {
  return {
    classKeys: [],
    classes: [],
    classChoiceKey: SPELL_LIST_CHOICE_KEY,
    picks: [],
    abilityOptions: [],
    abilityChoiceKey: SPELLCASTING_ABILITY_CHOICE_KEY,
  };
}

/** Заводит строку модификатора. */
export function createModifierRow(kind: ModifierRowKind): EditableModifierRow {
  return {
    uid: generateId('mod'),
    kind,
    value: 0,
    equalsWalk: false,
    source: 'fixed',
    damageType: 'fire',
    damageTypes: [],
    key: '',
    label: '',
    count: 1,
    defenseKind: 'resistance',
    condition: 'poisoned',
  };
}

/** Заводит строку требования. */
export function createPrerequisiteRow(
  kind: PrerequisiteRowKind,
): EditablePrerequisiteRow {
  return {
    uid: generateId('req'),
    kind,
    abilities: [],
    minValue: kind === 'level' ? 4 : 13,
    classFeatures: [],
    armor: [],
    refs: [],
    text: '',
  };
}

/** Заводит строку ресурса. */
// ── Блоб → форма ──────────────────────────────────────────────

/** Копия списка ссылок справочника — форма правит их независимо от блоба. */
function cloneRefs(
  refs: FeatPrerequisiteRef[] | undefined,
): FeatPrerequisiteRef[] {
  return (refs ?? []).map((ref) => ({ url: ref.url, name: ref.name }));
}

/** Строка дара из перечисленных значений (режим «выдать все»). */
function fixedGrantRow(
  kind: GrantRowKind,
  values: readonly string[],
  taken: Set<string>,
): EditableGrantRow {
  const row = createGrantRow(kind, taken);

  taken.add(row.key);
  row.options = values.map((value) => ({ value }));

  return row;
}

/** Строка дара из выбора черты (режим «выбрать из»). */
function choiceGrantRow(choice: FeatChoice): EditableGrantRow {
  return {
    uid: generateId('grant'),
    // Смешанный набор разворачивает движок: он же знает про легаси-значение
    // `skillOrTool`, которое здесь превращается в «навык + инструмент»
    kinds: resolveFeatChoiceTypes(choice).filter(isGrantRowKind),
    mode: 'choice',
    options: (choice.options ?? []).map((option) => ({ ...option })),
    featCategories: [...(choice.featCategories ?? [])],
    key: choice.key,
    label: choice.label ?? '',
    count: choice.count && choice.count > 0 ? choice.count : 1,
    countEqualsProficiencyBonus: choice.countEqualsProficiencyBonus ?? false,
    grants: choice.grants ?? 'proficiency',
    onlyIfNotProficient: choice.onlyIfNotProficient ?? false,
    onlyIfProficient: choice.onlyIfProficient ?? false,
    expertiseIfProficient: choice.expertiseIfProficient ?? false,
    rechooseOnLongRest: choice.rechooseOnLongRest ?? false,
    abilityAmount: 0,
    abilityUpto: 0,
    requiredLevel: choice.requiredLevel ?? 0,
    scaling: Object.entries(choice.scaling ?? {})
      .map(([level, count]) => ({
        uid: generateId('choice-step'),
        level: Number(level),
        count,
      }))
      .sort((first, second) => first.level - second.level),
    showInTable: choice.showInTable ?? false,
    shortName: choice.shortName ?? '',
  };
}

/**
 * Канонические ключи классов без повторов: в записи класс лежит то ключом
 * (`wizard`), то слагом страницы (`wizard-phb`), а форма правит только ключи.
 */
function uniqueClassKeys(values: ReadonlyArray<string>): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        const key = classKeyFromUrl(value);

        return key ? [key] : [];
      }),
    ),
  ];
}

/**
 * Порция заклинаний из выбора черты.
 *
 * Круг задан либо точно, либо потолком: фильтр разрешает оба поля разом, но
 * значит это то же самое, что один точный круг, — так его читает и лист. Поэтому
 * точный круг сильнее потолка.
 */
function spellPickRow(choice: FeatChoice): EditableSpellPickRow {
  const filter = choice.spellFilter;

  // Тип «заговор» задаёт круг сам: у такого выбора фильтра круга может не быть
  // вовсе, и без этого он прочитался бы как заклинание любого круга
  const exactLevel =
    filter?.level
    ?? (choice.type === 'cantrip' ? CANTRIP_SPELL_LEVEL : undefined);

  let mode: SpellLevelMode = 'any';

  if (exactLevel !== undefined) {
    mode = 'exact';
  } else if (filter?.maxLevel !== undefined) {
    mode = 'upTo';
  }

  return {
    uid: generateId('spellpick'),
    key: choice.key,
    mode,
    level: exactLevel ?? filter?.maxLevel,
    count: choice.count && choice.count > 0 ? choice.count : 1,
    countEqualsProficiencyBonus: choice.countEqualsProficiencyBonus ?? false,
    label: choice.label ?? '',
    schools: [...(filter?.schools ?? [])],
    castingTime: filter?.castingTime ?? '',
    // Перечисленные заклинания лежат набором значений выбора: значение — id
    // записи компендиума, имя — снимок названия
    source: choice.options?.length ? 'list' : 'filter',
    listedSpells: (choice.options ?? []).map((option) => ({
      spellId: option.value,
      name: option.name ?? option.value,
    })),
    rechooseOnLongRest: choice.rechooseOnLongRest ?? false,
    requiredLevel: choice.requiredLevel ?? 0,
  };
}

/**
 * Выбор заклинаний блоком из выборов черты.
 *
 * Классы берутся из служебного выбора класса, а если его нет — из фильтра первой
 * порции: так читается и черта с одним списком, у которой спрашивать нечего.
 * Заклинательная характеристика — из выбора, а без него из жёстко заданной.
 */
function spellChoiceBlock(featData: FeatData): EditableSpellChoiceBlock {
  const block = createSpellChoiceBlock();
  const choices = featData.choices ?? [];

  const classChoice = choices.find((choice) => choice.type === 'spellList');

  const abilityChoice = choices.find(
    (choice) => choice.type === 'spellcastingAbility',
  );

  const picks = choices.filter(
    (choice) => choice.type === 'spell' || choice.type === 'cantrip',
  );

  if (classChoice) {
    block.classChoiceKey = classChoice.key || block.classChoiceKey;

    block.classKeys = uniqueClassKeys(
      (classChoice.options ?? []).map((option) => option.value),
    );
  } else {
    const listed = picks.find(
      (choice) =>
        (choice.spellFilter?.classes?.length ?? 0) > 0
        || (choice.spellFilter?.classKeys?.length ?? 0) > 0,
    );

    block.classKeys = uniqueClassKeys([
      ...(listed?.spellFilter?.classKeys ?? []),
      ...(listed?.spellFilter?.classes ?? []).map((ref) => ref.url),
    ]);
  }

  // Ссылки на страницы классов — снимок из записи: форма их не правит, но и не
  // теряет, поэтому берутся из первой же порции, где они есть
  const withRefs = picks.find((choice) => choice.spellFilter?.classes?.length);

  block.classes = cloneRefs(withRefs?.spellFilter?.classes);

  if (abilityChoice) {
    block.abilityChoiceKey = abilityChoice.key || block.abilityChoiceKey;

    block.abilityOptions = (abilityChoice.options ?? [])
      .map((option) => option.value)
      .filter((value): value is AbilityType => isAbilityType(value));
  } else if (featData.spellcastingAbility) {
    block.abilityOptions = [featData.spellcastingAbility];
  }

  block.picks = picks.map(spellPickRow);

  return block;
}

/**
 * Строки модификаторов из постоянных правок листа.
 *
 * Защита по выбору игрока описана в механике двумя записями — ссылкой в
 * модификаторах и самим выбором в `choices`, — а в форме это одна строка: автор
 * настраивает защиту целиком в одном месте. Поэтому разбору нужны и выборы, а не
 * одни модификаторы.
 *
 * @param featData - блоб даров черты
 * @returns строки модификаторов и ключи выборов, уехавших в строки защиты
 */
function modifierRows(featData: FeatData): {
  rows: EditableModifierRow[];
  defenseChoiceKeys: Set<string>;
} {
  const rows: EditableModifierRow[] = [];
  const defenseChoiceKeys = new Set<string>();

  const push = (
    kind: ModifierRowKind,
    patch: Partial<EditableModifierRow> = {},
  ): void => {
    rows.push({ ...createModifierRow(kind), ...patch });
  };

  const modifiers = featData.modifiers;
  const hitPoints = modifiers?.hitPoints;

  if (hitPoints?.flat) {
    push('hitPointsFlat', { value: hitPoints.flat });
  }

  if (hitPoints?.perAcquisitionLevel) {
    push('hitPointsPerAcquisitionLevel', {
      value: hitPoints.perAcquisitionLevel,
    });
  }

  if (hitPoints?.perLevelAfterAcquisition) {
    push('hitPointsPerLevelAfterAcquisition', {
      value: hitPoints.perLevelAfterAcquisition,
    });
  }

  const speed = modifiers?.speed;

  if (speed?.walkBonus) {
    push('speedWalk', { value: speed.walkBonus });
  }

  if (speed?.fly || speed?.flyEqualsWalk) {
    push('speedFly', {
      value: speed.fly ?? 0,
      equalsWalk: speed.flyEqualsWalk ?? false,
    });
  }

  if (speed?.climb || speed?.climbEqualsWalk) {
    push('speedClimb', {
      value: speed.climb ?? 0,
      equalsWalk: speed.climbEqualsWalk ?? false,
    });
  }

  if (speed?.swim || speed?.swimEqualsWalk) {
    push('speedSwim', {
      value: speed.swim ?? 0,
      equalsWalk: speed.swimEqualsWalk ?? false,
    });
  }

  if (modifiers?.armorClassBonus) {
    push('armorClass', { value: modifiers.armorClassBonus });
  }

  if (modifiers?.initiativeBonus) {
    push('initiative', { value: modifiers.initiativeBonus });
  }

  if (modifiers?.initiativeProficiencyBonus) {
    push('initiativeProficiencyBonus');
  }

  if (featData.darkvision) {
    push('darkvision', { value: featData.darkvision });
  }

  for (const sense of modifiers?.senses ?? []) {
    const kind = typedObjectEntries(SENSE_MODIFIER_KINDS).find(
      ([, type]) => type === sense.type,
    )?.[0];

    if (kind) {
      push(kind, { value: sense.range });
    }
  }

  if (modifiers?.telepathyRange) {
    push('telepathy', { value: modifiers.telepathyRange });
  }

  for (const defense of featData.damageDefenses ?? []) {
    push('damageDefense', {
      damageType: defense.damageType,
      defenseKind: defense.kind,
    });
  }

  const seenChoiceKeys = new Set<string>();

  for (const defenseChoice of listFeatDamageDefenseChoices(featData)) {
    const choiceKey = defenseChoice.choiceKey.trim();

    // Два исхода у одного ответа — противоречие: тип урона не бывает разом и
    // стойким, и уязвимым. Лишняя ссылка отбрасывается, иначе выбор уехал бы в
    // механику дважды под одним ключом
    if (seenChoiceKeys.has(choiceKey)) {
      continue;
    }

    seenChoiceKeys.add(choiceKey);

    const choice = (featData.choices ?? []).find(
      (entry) => entry.key === choiceKey,
    );

    // Строкой защиты показывается только чистый выбор типа урона: смешанный
    // («навык ИЛИ тип урона») она обрезала бы до одного вида. Такой выбор
    // остаётся строкой дара, а ссылка на него — непривязанной
    if (
      !choice
      || choice.type !== 'damageType'
      || (choice.types?.length ?? 0) > 1
    ) {
      continue;
    }

    defenseChoiceKeys.add(choiceKey);

    push('damageDefense', {
      source: 'choice',
      defenseKind: defenseChoice.kind,
      damageTypes: (choice.options ?? [])
        .map((option) => option.value)
        .filter((value): value is DefensibleDamageType =>
          isDefensibleDamageType(value),
        ),
      key: choiceKey,
      label: choice.label ?? '',
      count: choice.count && choice.count > 0 ? choice.count : 1,
    });
  }

  for (const condition of featData.conditionImmunities ?? []) {
    push('conditionImmunity', { condition });
  }

  return { rows, defenseChoiceKeys };
}

/** Строки требований из разобранного предусловия. */
function prerequisiteRows(
  prerequisite: FeatPrerequisite | undefined,
): EditablePrerequisiteRow[] {
  if (!prerequisite) {
    return [];
  }

  const rows: EditablePrerequisiteRow[] = [];

  const push = (
    kind: PrerequisiteRowKind,
    patch: Partial<EditablePrerequisiteRow> = {},
  ): void => {
    rows.push({ ...createPrerequisiteRow(kind), ...patch });
  };

  // Старая карта «все сразу» разворачивается в отдельные строки: форма пишет
  // только `abilityRequirements`, и две формы одного требования не нужны
  for (const [ability, minValue] of typedObjectEntries(
    prerequisite.abilities ?? {},
  )) {
    if (minValue && minValue > 0) {
      push('ability', { abilities: [ability], minValue });
    }
  }

  for (const requirement of prerequisite.abilityRequirements ?? []) {
    push('ability', {
      abilities: [...requirement.anyOf],
      minValue: requirement.minValue,
    });
  }

  if (prerequisite.minLevel) {
    push('level', { minValue: prerequisite.minLevel });
  }

  if (prerequisite.spellcasting) {
    push('spellcasting');
  }

  if (prerequisite.classFeatures?.length) {
    push('classFeature', { classFeatures: [...prerequisite.classFeatures] });
  }

  if (prerequisite.armorProficiency?.length) {
    push('armorProficiency', { armor: [...prerequisite.armorProficiency] });
  }

  for (const [kind, field] of typedObjectEntries(REF_PREREQUISITE_FIELDS)) {
    const refs = prerequisite[field];

    if (refs && refs.length > 0) {
      push(kind, { refs: cloneRefs(refs) });
    }
  }

  if (prerequisite.campaign) {
    push('campaign', { text: prerequisite.campaign });
  }

  if (prerequisite.anyDragonmark) {
    push('anyDragonmark');
  }

  if (prerequisite.text) {
    push('text', { text: prerequisite.text });
  }

  return rows;
}

/** Разворачивает блоб {@link FeatData} в редактируемую механику. */
export function featDataToGrants(
  featData: FeatData | null | undefined,
): EditableFeatGrants {
  const grants = createEmptyFeatGrants();

  if (!featData) {
    return grants;
  }

  const taken = new Set((featData.choices ?? []).map((choice) => choice.key));

  const fixed: [GrantRowKind, readonly string[] | undefined][] = [
    ['skill', featData.skillProficiencies],
    ['savingThrow', featData.savingThrowProficiencies],
    ['armor', featData.armorProficiencies],
    ['weapon', featData.weaponProficiencies],
    ['weaponMastery', featData.weaponMasteries],
    ['masteryProperty', featData.masteryProperties],
    ['tool', featData.toolProficiencies],
    ['language', featData.languages],
  ];

  for (const [kind, values] of fixed) {
    if (values?.length) {
      grants.grantRows.push(fixedGrantRow(kind, values, taken));
    }
  }

  // Черта, выданная без выбора, — та же строка дара в режиме «выдать все»:
  // снимок названия держится за `id`, потому что записи может не оказаться в
  // паках, а показать выданное надо всё равно
  if (featData.grantedFeats?.length) {
    const row = createGrantRow('feat', taken);

    taken.add(row.key);
    row.mode = 'all';

    row.options = featData.grantedFeats.map((granted) => ({
      value: granted.featId,
      name: granted.name,
    }));

    grants.grantRows.push(row);
  }

  const increase = featData.abilityScoreIncrease;
  const fixedAbilities = typedObjectEntries(increase?.fixed ?? {});

  if (fixedAbilities.length > 0) {
    const row = fixedGrantRow(
      'ability',
      fixedAbilities.map(([ability]) => ability),
      taken,
    );

    row.abilityAmount = fixedAbilities[0]?.[1] ?? 1;
    row.abilityUpto = increase?.upto ?? 0;
    grants.grantRows.push(row);
  }

  // Повышение по выбору без привязки к выбору лист не применял — заводим ему
  // строку-выбор, чтобы механика заработала
  if (increase?.choice && !increase.fromChoiceKey) {
    const row = createGrantRow('ability', taken);

    taken.add(row.key);
    row.mode = 'choice';
    row.count = increase.choice.count;
    row.abilityAmount = increase.choice.amount;
    row.abilityUpto = increase.upto ?? 0;

    row.options = (increase.choice.from ?? []).map((ability) => ({
      value: ability,
    }));

    grants.grantRows.push(row);
  }

  grants.spellChoice = spellChoiceBlock(featData);

  // Разбор идёт с модификаторов, а не с даров: выбор, на который ссылается
  // защита, уезжает в её строку целиком, и дублирующей строки дара не остаётся
  const { rows: modifierRowList, defenseChoiceKeys } = modifierRows(featData);

  grants.modifiers = modifierRowList;

  for (const choice of featData.choices ?? []) {
    if (
      SPELL_CHOICE_TYPES.includes(choice.type)
      || defenseChoiceKeys.has(choice.key)
    ) {
      continue;
    }

    const row = choiceGrantRow(choice);

    if (increase?.fromChoiceKey === choice.key) {
      row.abilityAmount = increase.choice?.amount ?? 1;
      row.abilityUpto = increase.upto ?? 0;
    }

    grants.grantRows.push(row);
  }

  grants.prerequisites = prerequisiteRows(featData.prerequisite);

  grants.counters = (featData.counters ?? []).map((counter) => ({
    uid: generateId('counter'),
    key: counter.key,
    name: counter.name,
    shortName: counter.shortName ?? '',
    max: counter.max,
    min: counter.min ?? 0,
    recovery: counter.recovery,
    progression: progressionToEntries(counter.progression),
    // Своего ряда уровней у ресурса записи нет: он появляется вместе с ней
    startLevel: 1,
    showInTable: false,
  }));

  grants.spellList = {
    requiresSpellcasting: featData.spellList?.requiresSpellcasting ?? false,
    // Прежнее «сколько берут» ступени читается и молча отбрасывается:
    // расширение — доступность, а не выбор
    groups: (featData.spellList?.groups ?? []).map((group) => ({
      uid: generateId('spell-list'),
      requiredLevel: group.requiredLevel,
      spells: (group.spells ?? []).map((spell) => ({ ...spell })),
    })),
  };

  grants.grantedSpellGroups = [
    ...groupGrantedSpellRefs(
      featData.grantedSpells ?? [],
      featData.grantedSpellsAlwaysPrepared ?? false,
    ),
    ...(featData.grantedClassSpells ?? []).map((group) => ({
      ...createGrantedSpellGroup(),
      source: 'classList' as const,
      classKeys: [...(group.classKeys ?? [])],
      classNames: [...(group.classNames ?? [])],
      classPackId: group.classPackId,
      spellPackIds: [...(group.spellPackIds ?? [])],
      levelMode: classSpellsLevelMode(group),
      level: group.level ?? group.maxLevel,
      requiredLevel: group.requiredLevel,
      spellcastingAbility: group.spellcastingAbility,
      alwaysPrepared:
        group.alwaysPrepared ?? featData.grantedSpellsAlwaysPrepared ?? false,
    })),
  ];

  grants.grantedSpellsAlwaysPrepared =
    featData.grantedSpellsAlwaysPrepared ?? false;

  return grants;
}

/**
 * Перечисленные ссылки — группами по уровню открытия.
 *
 * В блобе они лежат плоским списком, а группа — это и есть ступень «что приходит
 * на этом уровне». Порядок ступеней — порядок первого появления уровня в списке,
 * чтобы правка не перетасовывала форму.
 *
 * @param refs - выдаваемые заклинания из блоба
 * @param fallbackAlwaysPrepared - отметка «подготовлено» у записи целиком:
 *   её наследуют ссылки, у которых своей отметки нет
 * @returns группы по уровню открытия, в порядке первого появления уровня
 */
function groupGrantedSpellRefs(
  refs: ReadonlyArray<GrantedSpellRef>,
  fallbackAlwaysPrepared = false,
): EditableGrantedSpellGroup[] {
  const byKey = new Map<string, EditableGrantedSpellGroup>();
  const groups: EditableGrantedSpellGroup[] = [];

  for (const ref of refs) {
    // Ключ карты — уровень числом: «сразу» и «с первого» — одно и то же, и
    // двумя ступенями они выглядели бы как разные. Характеристика и подготовка
    // входят в ключ: заклинания, которые считаются от разных характеристик, —
    // разные группы, иначе настройка одного стёрла бы настройку другого
    const level =
      ref.requiredLevel && ref.requiredLevel > 1 ? ref.requiredLevel : 1;

    const prepared = ref.alwaysPrepared ?? fallbackAlwaysPrepared;
    const key = `${level}:${ref.spellcastingAbility ?? ''}:${prepared}`;

    let group = byKey.get(key);

    if (!group) {
      group = listGrantedSpellGroup([], level > 1 ? level : undefined);
      group.spellcastingAbility = ref.spellcastingAbility;
      group.alwaysPrepared = prepared;
      byKey.set(key, group);
      groups.push(group);
    }

    group.spells.push({
      ...ref,
      requiredLevel: undefined,
      spellcastingAbility: undefined,
      alwaysPrepared: undefined,
    });
  }

  return groups;
}

/**
 * Как задан круг у сохранённой группы. Три границы разом записать нельзя, поэтому
 * порядок разбора и есть их старшинство: отметка «по ячейкам» сильнее числа.
 *
 * @param group - группа выдачи списка класса из блоба
 */
function classSpellsLevelMode(
  group: FeatGrantedClassSpells,
): ClassSpellsLevelMode {
  if (group.fromSlots) {
    return 'slots';
  }

  if (group.level !== undefined) {
    return 'exact';
  }

  return group.maxLevel === undefined ? 'any' : 'upTo';
}

// ── Форма → блоб ──────────────────────────────────────────────

/** Значения строки без пустых, с обрезкой. */
function rowValues(row: EditableGrantRow): string[] {
  return row.options
    .map((option) => option.value.trim())
    .filter((value) => value.length > 0);
}

/** Варианты выбора к сохранению: пустые значения отбрасываются. */
function buildOptions(options: FeatChoiceOption[]): FeatChoiceOption[] {
  return options
    .filter((option) => option.value.trim().length > 0)
    .map((option) => {
      const built: FeatChoiceOption = { value: option.value.trim() };
      const name = option.name?.trim();

      if (name) {
        built.name = name;
      }

      return built;
    });
}

/** Общие поля выбора: количество, подпись, набор, пересмотр на отдыхе. */
function baseChoice(row: {
  key: string;
  type: FeatChoiceType;
  label: string;
  count: number;
  countEqualsProficiencyBonus: boolean;
  options: FeatChoiceOption[];
  rechooseOnLongRest: boolean;
}): FeatChoice {
  const built: FeatChoice = { key: row.key.trim(), type: row.type };
  const label = row.label.trim();

  if (label) {
    built.label = label;
  }

  if (row.countEqualsProficiencyBonus) {
    built.countEqualsProficiencyBonus = true;
  } else if (row.count > 1) {
    // Единица — умолчание движка, писать её незачем
    built.count = row.count;
  }

  const options = buildOptions(row.options);

  if (options.length > 0) {
    built.options = options;
  }

  if (row.rechooseOnLongRest) {
    built.rechooseOnLongRest = true;
  }

  return built;
}

/** Строка дара как выбор черты. */
function grantRowToChoice(row: EditableGrantRow): FeatChoice {
  const built = baseChoice({ ...row, type: primaryKind(row) });

  // Полный набор пишется только когда видов правда несколько: одиночный
  // дублировал бы `type` и расходился бы с ним при правке
  if (row.kinds.length > 1) {
    built.types = [...row.kinds];
  }

  if (row.grants === 'expertise') {
    built.grants = 'expertise';
  }

  if (row.onlyIfNotProficient) {
    built.onlyIfNotProficient = true;
  }

  if (row.onlyIfProficient) {
    built.onlyIfProficient = true;
  }

  if (row.expertiseIfProficient) {
    built.expertiseIfProficient = true;
  }

  if (row.requiredLevel > 0) {
    built.requiredLevel = row.requiredLevel;
  }

  // Категории сужают пул черт наравне с перечнем: без них мастер предложит
  // любую черту, кроме тех, что лист исключает своим правилом
  if (hasKind(row, 'feat') && row.featCategories.length > 0) {
    built.featCategories = [...row.featCategories];
  }

  // Ступень без уровня или без количества ничего не описывает: у потребителя она
  // превратилась бы в выбор ни из чего
  const scaling = row.scaling
    .filter((step) => step.level > 0 && step.count > 0)
    .sort((first, second) => first.level - second.level);

  if (scaling.length > 0) {
    built.scaling = Object.fromEntries(
      scaling.map((step) => [String(step.level), step.count]),
    );

    // Колонка выводится из ступеней: без них показывать в таблице нечего
    if (row.showInTable) {
      built.showInTable = true;
    }

    if (row.shortName.trim()) {
      built.shortName = row.shortName.trim();
    }
  }

  return built;
}

/**
 * Выборы типа урона из строк защиты и ссылки на них.
 *
 * Защита по выбору живёт в форме одной строкой, а в механике — двумя записями:
 * сам выбор в `choices` и ссылка на него в списке защит. Ключ автору не показан,
 * поэтому свободный выделяется здесь же; занятые ключи пополняются на месте,
 * чтобы вторая такая строка не села на тот же ключ.
 *
 * @param rows - строки модификаторов
 * @param takenKeys - занятые ключи выборов черты; пополняется на месте
 * @param choices - выборы черты, собранные до сих пор; пополняется на месте
 * @returns ссылки «ключ выбора → вид защиты»
 */
function buildDamageDefenseChoices(
  rows: EditableModifierRow[],
  takenKeys: Set<string>,
  choices: FeatChoice[],
): FeatDamageDefenseChoice[] {
  const defenseChoices: FeatDamageDefenseChoice[] = [];

  for (const row of rows) {
    if (!isDamageDefenseChoiceRow(row)) {
      continue;
    }

    ensureKey(row, DAMAGE_DEFENSE_CHOICE_KEY_PREFIX, takenKeys);

    const choice: FeatChoice = { key: row.key, type: 'damageType' };

    if (row.label.trim()) {
      choice.label = row.label.trim();
    }

    if (row.count > 1) {
      choice.count = row.count;
    }

    // Пустой набор — любой тип урона: перечислять весь справочник в каждой
    // такой черте незачем, лист подставит его сам
    if (row.damageTypes.length > 0) {
      choice.options = row.damageTypes.map((value) => ({ value }));
    }

    choices.push(choice);
    defenseChoices.push({ choiceKey: row.key, kind: row.defenseKind });
  }

  return defenseChoices;
}

/**
 * Ограничение выбора одной порции заклинаний.
 *
 * Классы задаются блоком, а не порцией: список у всех порций общий. Ссылка на
 * служебный выбор класса пишется только когда классов больше одного — с
 * единственным списком спрашивать нечего, пул задан фильтром напрямую.
 *
 * @param row - порция заклинаний
 * @param block - выбор заклинаний целиком (из него берутся классы)
 * @param classChoiceKey - ключ служебного выбора класса; пусто — выбора нет
 */
function buildSpellFilter(
  row: EditableSpellPickRow,
  block: EditableSpellChoiceBlock,
  classChoiceKey: string,
): FeatChoiceSpellFilter | undefined {
  const built: FeatChoiceSpellFilter = {};

  if (row.mode === 'exact' && row.level !== undefined) {
    built.level = row.level;
  }

  if (row.mode === 'upTo' && row.level !== undefined) {
    built.maxLevel = row.level;
  }

  if (row.schools.length > 0) {
    built.schools = [...row.schools];
  }

  if (row.castingTime.trim()) {
    built.castingTime = row.castingTime.trim();
  }

  const classKeys = uniqueClassKeys(block.classKeys);

  if (classKeys.length > 0) {
    built.classKeys = classKeys;

    // Ссылки на страницы переносятся только у оставшихся классов: снятый автором
    // класс должен уйти вместе со своей ссылкой, иначе пул сузился бы по ней
    const refs = block.classes.filter((ref) => {
      const key = classKeyFromUrl(ref.url);

      return !!key && classKeys.includes(key);
    });

    if (refs.length > 0) {
      built.classes = cloneRefs(refs);
    }
  }

  if (classChoiceKey) {
    built.classesFromChoiceKey = classChoiceKey;
  }

  return Object.keys(built).length > 0 ? built : undefined;
}

/**
 * Выборы механики из блока выбора заклинаний.
 *
 * Служебный выбор класса заводится, только когда классов больше одного и есть
 * что из них выбирать: иначе игроку пришлось бы отвечать впустую. Порция
 * заговоров пишется типом `cantrip` — так её читает лист, не заглядывая в фильтр.
 *
 * Порядок выборов — тот, в каком их задаёт игроку лист: сперва класс, потом
 * заклинания, потом характеристика.
 *
 * @param block - выбор заклинаний целиком
 * @param takenKeys - занятые ключи выборов черты; пополняется на месте
 * @param occupiedKeys - ключи выборов, уже собранных с других вкладок
 */
function buildSpellChoices(
  block: EditableSpellChoiceBlock,
  takenKeys: Set<string>,
  occupiedKeys: ReadonlySet<string>,
): FeatChoice[] {
  const classKeys = uniqueClassKeys(block.classKeys);

  // Свой ключ выбор сохраняет за собой: меняйся он при каждом сохранении черты,
  // ответы, записанные на уже выданных чертах, повисли бы в пустоте. Занятыми
  // считаются только ключи выборов, уже собранных с других вкладок
  const foreignKeys = new Set(occupiedKeys);

  /**
   * Ключ выбора, не совпавший с уже занятым. Записи бывают битые: у
   * «Посвящённого в магию» порция заговоров лежит под ключом заклинательной
   * характеристики, и без проверки два выбора схлопнулись бы в один — ответ на
   * второй пропал бы вместе с ним.
   */
  const takeKey = (key: string, preferred: string): string => {
    const trimmed = key.trim();

    const free =
      trimmed && !foreignKeys.has(trimmed)
        ? trimmed
        : freeKey(preferred, takenKeys);

    foreignKeys.add(free);
    takenKeys.add(free);

    return free;
  };

  // Служебный выбор класса нужен только порциям с поиском по списку класса:
  // перечисленные заклинания списка не читают
  const hasFilterPicks = block.picks.some((row) => row.source === 'filter');

  const classChoiceKey =
    classKeys.length > 1 && hasFilterPicks
      ? takeKey(block.classChoiceKey, SPELL_LIST_CHOICE_KEY)
      : '';

  const abilityChoiceKey =
    block.abilityOptions.length > 1
      ? takeKey(block.abilityChoiceKey, SPELLCASTING_ABILITY_CHOICE_KEY)
      : '';

  const choices: FeatChoice[] = [];

  if (classChoiceKey) {
    const labels = new Map(
      getFeatChoiceDefaultPool('spellList').map((option) => [
        option.value,
        option.name,
      ]),
    );

    choices.push({
      key: classChoiceKey,
      type: 'spellList',
      count: 1,
      options: classKeys.map((key) => ({
        value: key,
        ...(labels.get(key) ? { name: labels.get(key) } : {}),
      })),
    });
  }

  for (const row of block.picks) {
    const isList = row.source === 'list';

    // У перечисленных заклинаний круг свой у каждой записи, поэтому порция
    // пишется общим типом `spell`, даже если в ней одни заговоры
    const isCantrip =
      !isList && row.mode === 'exact' && row.level === CANTRIP_SPELL_LEVEL;

    const built: FeatChoice = {
      key: takeKey(
        row.key,
        isCantrip ? CANTRIP_PICK_KEY_PREFIX : SPELL_PICK_KEY_PREFIX,
      ),
      type: isCantrip ? 'cantrip' : 'spell',
    };

    if (row.label.trim()) {
      built.label = row.label.trim();
    }

    if (row.countEqualsProficiencyBonus) {
      built.countEqualsProficiencyBonus = true;
    } else if (row.count > 1) {
      built.count = row.count;
    }

    if (row.rechooseOnLongRest) {
      built.rechooseOnLongRest = true;
    }

    if (row.requiredLevel > 0) {
      built.requiredLevel = row.requiredLevel;
    }

    if (isList) {
      // Перечисленные заклинания — набором значений выбора: значение — id
      // записи, имя — снимок названия для подписи. Фильтра у такого пула нет
      const options: FeatChoiceOption[] = row.listedSpells
        .filter((spell) => Boolean(spell.spellId))
        .map((spell) => ({
          value: spell.spellId ?? '',
          ...(spell.name.trim() ? { name: spell.name.trim() } : {}),
        }));

      if (options.length > 0) {
        built.options = options;
      }
    } else {
      const filter = buildSpellFilter(row, block, classChoiceKey);

      if (filter) {
        built.spellFilter = filter;
      }
    }

    choices.push(built);
  }

  // Характеристика спрашивается последней: она относится ко всем заклинаниям
  // черты сразу, а не к какой-то одной порции
  if (abilityChoiceKey) {
    choices.push({
      key: abilityChoiceKey,
      type: 'spellcastingAbility',
      count: 1,
      options: block.abilityOptions.map((ability) => ({ value: ability })),
    });
  }

  return choices;
}

/** Собранные из строк постоянные правки листа. */
interface BuiltModifiers {
  modifiers: FeatModifiers;
  darkvision: number;
  damageDefenses: NonNullable<FeatData['damageDefenses']>;
  conditionImmunities: ConditionKey[];
}

/**
 * Постоянные правки листа из строк модификаторов.
 *
 * @param rows - строки модификаторов
 */
function buildModifiers(rows: EditableModifierRow[]): BuiltModifiers {
  const modifiers: FeatModifiers = {};
  const hitPoints: NonNullable<FeatModifiers['hitPoints']> = {};
  const speed: NonNullable<FeatModifiers['speed']> = {};
  const senses: NonNullable<FeatModifiers['senses']> = [];
  const damageDefenses: BuiltModifiers['damageDefenses'] = [];
  const conditionImmunities: ConditionKey[] = [];

  let darkvision = 0;

  for (const row of rows) {
    switch (row.kind) {
      case 'hitPointsFlat':
        hitPoints.flat = row.value;

        break;
      case 'hitPointsPerAcquisitionLevel':
        hitPoints.perAcquisitionLevel = row.value;

        break;
      case 'hitPointsPerLevelAfterAcquisition':
        hitPoints.perLevelAfterAcquisition = row.value;

        break;
      case 'speedWalk':
        speed.walkBonus = row.value;

        break;
      case 'speedFly':
        if (row.equalsWalk) {
          speed.flyEqualsWalk = true;
        } else {
          speed.fly = row.value;
        }

        break;
      case 'speedClimb':
        if (row.equalsWalk) {
          speed.climbEqualsWalk = true;
        } else {
          speed.climb = row.value;
        }

        break;
      case 'speedSwim':
        if (row.equalsWalk) {
          speed.swimEqualsWalk = true;
        } else {
          speed.swim = row.value;
        }

        break;
      case 'armorClass':
        modifiers.armorClassBonus = row.value;

        break;
      case 'initiative':
        modifiers.initiativeBonus = row.value;

        break;
      case 'initiativeProficiencyBonus':
        modifiers.initiativeProficiencyBonus = true;

        break;
      case 'darkvision':
        darkvision = row.value;

        break;
      case 'telepathy':
        modifiers.telepathyRange = row.value;

        break;
      case 'damageDefense':
        // Тип урона называет игрок — фиксированной защиты у строки нет: она
        // уедет ссылкой на выбор (`buildDamageDefenseChoices`)
        if (isDamageDefenseChoiceRow(row)) {
          break;
        }

        damageDefenses.push({
          damageType: row.damageType,
          kind: row.defenseKind,
        });

        break;
      case 'conditionImmunity':
        conditionImmunities.push(row.condition);

        break;
      default: {
        const senseType = SENSE_MODIFIER_KINDS[row.kind];

        if (senseType && row.value > 0) {
          senses.push({ type: senseType, range: row.value });
        }

        break;
      }
    }
  }

  if (Object.keys(hitPoints).length > 0) {
    modifiers.hitPoints = hitPoints;
  }

  if (Object.keys(speed).length > 0) {
    modifiers.speed = speed;
  }

  if (senses.length > 0) {
    modifiers.senses = senses;
  }

  return { modifiers, darkvision, damageDefenses, conditionImmunities };
}

/** Разобранное предусловие из строк требований. */
function buildPrerequisite(
  rows: EditablePrerequisiteRow[],
): FeatPrerequisite | undefined {
  const result: FeatPrerequisite = {};

  const abilityRequirements: NonNullable<
    FeatPrerequisite['abilityRequirements']
  > = [];

  for (const row of rows) {
    switch (row.kind) {
      case 'ability':
        if (row.abilities.length > 0 && row.minValue > 0) {
          abilityRequirements.push({
            anyOf: [...row.abilities],
            minValue: row.minValue,
          });
        }

        break;
      case 'level':
        if (row.minValue > 0) {
          result.minLevel = row.minValue;
        }

        break;
      case 'spellcasting':
        result.spellcasting = true;

        break;
      case 'classFeature':
        if (row.classFeatures.length > 0) {
          result.classFeatures = [...row.classFeatures];
        }

        break;
      case 'armorProficiency':
        if (row.armor.length > 0) {
          result.armorProficiency = [...row.armor];
        }

        break;
      case 'campaign':
        if (row.text.trim()) {
          result.campaign = row.text.trim();
        }

        break;
      case 'anyDragonmark':
        result.anyDragonmark = true;

        break;
      case 'text':
        if (row.text.trim()) {
          result.text = row.text.trim();
        }

        break;
      default: {
        if (!isRefPrerequisite(row.kind)) {
          break;
        }

        const refs = row.refs
          .filter((ref) => ref.name.trim().length > 0)
          .map((ref) => ({ url: ref.url.trim(), name: ref.name.trim() }));

        if (refs.length > 0) {
          result[REF_PREREQUISITE_FIELDS[row.kind]] = refs;
        }

        break;
      }
    }
  }

  if (abilityRequirements.length > 0) {
    result.abilityRequirements = abilityRequirements;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Повышение характеристик из строк даров.
 *
 * Повышение по выбору всегда привязано к самому выбору (`fromChoiceKey`): без
 * привязки лист его не применял, а спрашивать характеристику второй раз незачем.
 * Привязка одна на черту — берётся первая подходящая строка.
 *
 * @param rows - строки даров
 */
function buildAbilityScoreIncrease(
  rows: EditableGrantRow[],
): FeatAbilityScoreIncrease | undefined {
  const result: FeatAbilityScoreIncrease = {};
  const fixed: Partial<Record<AbilityType, number>> = {};

  let upto = 0;

  for (const row of rows) {
    if (row.abilityAmount === 0) {
      continue;
    }

    upto = Math.max(upto, row.abilityUpto);

    if (row.mode === 'all') {
      if (!hasKind(row, 'ability')) {
        continue;
      }

      for (const value of rowValues(row)) {
        if (isAbilityType(value)) {
          fixed[value] = row.abilityAmount;
        }
      }

      continue;
    }

    if (!result.fromChoiceKey && row.key.trim()) {
      result.fromChoiceKey = row.key.trim();

      result.choice = {
        amount: row.abilityAmount,
        count: row.countEqualsProficiencyBonus ? 1 : row.count,
      };

      // Набор дублируется в повышение ради сводки даров: она печатает
      // «+1 к Силе / Ловкости» именно отсюда, а пул выбора живёт в самом выборе
      const from = rowValues(row).filter(isAbilityType);

      if (hasKind(row, 'ability') && from.length > 0) {
        result.choice.from = from;
      }
    }
  }

  if (Object.keys(fixed).length > 0) {
    result.fixed = fixed;
  }

  if (upto > 0 && (result.fixed || result.fromChoiceKey)) {
    result.upto = upto;
  }

  return result.fixed || result.fromChoiceKey ? result : undefined;
}

/** Поле блоба, в которое ложатся фиксированные значения строки дара. */
const FIXED_GRANT_FIELDS = {
  armor: 'armorProficiencies',
  weapon: 'weaponProficiencies',
  weaponMastery: 'weaponMasteries',
  masteryProperty: 'masteryProperties',
  tool: 'toolProficiencies',
  language: 'languages',
} as const;

/** Виды даров, чьи значения ложатся в блоб как есть, без разбора. */
type PlainGrantKind = keyof typeof FIXED_GRANT_FIELDS;

/** Ложатся ли значения этого вида в блоб как есть. */
function isPlainGrantKind(kind: FeatChoiceType): kind is PlainGrantKind {
  return kind in FIXED_GRANT_FIELDS;
}

/**
 * Раскладывает фиксированные дары строки по полям блоба. Смешанный вид
 * («навык или инструмент») раскладывается по принадлежности значения: поля
 * «навык-или-инструмент» на листе нет.
 *
 * @param data - собираемый блоб
 * @param row - строка дара в режиме «выдать все»
 */
function applyFixedGrantRow(data: FeatData, row: EditableGrantRow): void {
  const values = rowValues(row);

  if (values.length === 0) {
    return;
  }

  // Вид берётся у самого значения: у смешанной строки виды разные, а лечь
  // значения должны в разные списки. Разбирает их движок — тем же правилом,
  // которым потом разложит ответ игрока
  const pseudoChoice = { type: primaryKind(row), types: [...row.kinds] };

  for (const value of values) {
    const kind = resolveFeatChoiceValueType(pseudoChoice, value);

    if (isPlainGrantKind(kind)) {
      (data[FIXED_GRANT_FIELDS[kind]] ??= []).push(value);

      continue;
    }

    if (kind === 'savingThrow' && isAbilityType(value)) {
      (data.savingThrowProficiencies ??= []).push(value);

      continue;
    }

    if (kind === 'skill' && isSkillType(value)) {
      (data.skillProficiencies ??= []).push(value);
    }
  }
}

/**
 * Кладёт черты строки в список выданных без выбора. Своё поле, а не общий
 * разбор: черта — запись компендиума, и рядом с `id` нужен снимок названия,
 * иначе выданное нечем показать, когда пака в мире нет.
 *
 * @param data - собираемый блоб
 * @param row - строка дара вида «Черта» в режиме «выдать все»
 */
function applyGrantedFeatRow(data: FeatData, row: EditableGrantRow): void {
  const granted = row.options
    .filter((option) => option.value.trim().length > 0)
    .map((option) => ({
      featId: option.value.trim(),
      name: option.name?.trim() ?? '',
    }));

  if (granted.length > 0) {
    (data.grantedFeats ??= []).push(...granted);
  }
}

/**
 * Ссылка на заклинание к сохранению: пустые поля не пишутся, уровень доступа —
 * только когда он что-то значит (единица = «сразу», умолчание движка).
 *
 * @param spell - строка заклинания из формы
 */
function buildGrantedSpellRef(spell: GrantedSpellRef): GrantedSpellRef {
  return {
    name: spell.name.trim(),
    ...(spell.spellId ? { spellId: spell.spellId } : {}),
    ...(spell.packId ? { packId: spell.packId } : {}),
    ...(spell.requiredLevel && spell.requiredLevel > 1
      ? { requiredLevel: spell.requiredLevel }
      : {}),
  };
}

/**
 * Расширение списка заклинаний класса к сохранению. Ступень без заклинаний
 * отбрасывается: пустая ступень читалась бы как «на этом уровне не открывается
 * ничего», а это не то же самое, что её отсутствие.
 *
 * @param expansion - таблица из формы
 * @returns блок для блоба либо `undefined`, если сохранять нечего
 */
function buildSpellListExpansion(
  expansion: EditableSpellListExpansion,
): FeatSpellListExpansion | undefined {
  const groups: FeatSpellListGroup[] = expansion.groups
    .map((group) => {
      const spells = group.spells
        .filter((spell) => spell.name.trim().length > 0)
        .map(buildGrantedSpellRef);

      const built: FeatSpellListGroup = { spells };

      if (group.requiredLevel && group.requiredLevel > 1) {
        built.requiredLevel = group.requiredLevel;
      }

      return built;
    })
    .filter((group) => group.spells.length > 0);

  if (groups.length === 0) {
    return undefined;
  }

  return {
    groups,
    ...(expansion.requiresSpellcasting ? { requiresSpellcasting: true } : {}),
  };
}

/**
 * Группы выдачи в блоб: перечисленные — ссылками с уровнем группы, списки классов
 * — своим полем.
 *
 * Группа без содержимого не уезжает: перечисление без заклинаний ничего не даёт, а
 * список классов без единого класса потребитель прочитал бы как «весь компендиум».
 *
 * @param groups - группы формы
 * @param data - блоб даров, в который пишутся оба поля
 */
function applyGrantedSpellGroups(
  groups: EditableGrantedSpellGroup[],
  data: FeatData,
): void {
  const refs: GrantedSpellRef[] = [];
  const classLists: FeatGrantedClassSpells[] = [];

  for (const group of groups) {
    if (group.source === 'classList') {
      if (group.classKeys.length === 0) {
        continue;
      }

      classLists.push({
        classKeys: [...group.classKeys],
        ...(group.classNames.length
          ? { classNames: [...group.classNames] }
          : {}),
        ...(group.classPackId ? { classPackId: group.classPackId } : {}),
        ...(group.spellPackIds.length
          ? { spellPackIds: [...group.spellPackIds] }
          : {}),
        ...(group.levelMode === 'exact' && group.level !== undefined
          ? { level: group.level }
          : {}),
        ...(group.levelMode === 'upTo' && group.level !== undefined
          ? { maxLevel: group.level }
          : {}),
        ...(group.levelMode === 'slots' ? { fromSlots: true } : {}),
        ...(group.requiredLevel ? { requiredLevel: group.requiredLevel } : {}),
        ...(group.spellcastingAbility
          ? { spellcastingAbility: group.spellcastingAbility }
          : {}),
        // Отметка пишется всегда, а не только взведённая: у записи есть своя,
        // прежняя, и пропуск снятой отметки означал бы «как у записи»
        alwaysPrepared: group.alwaysPrepared,
      });

      continue;
    }

    for (const spell of group.spells) {
      if (spell.name.trim().length === 0) {
        continue;
      }

      refs.push({
        ...buildGrantedSpellRef(spell),
        ...(group.requiredLevel ? { requiredLevel: group.requiredLevel } : {}),
        ...(group.spellcastingAbility
          ? { spellcastingAbility: group.spellcastingAbility }
          : {}),
        alwaysPrepared: group.alwaysPrepared,
      });
    }
  }

  if (refs.length > 0) {
    data.grantedSpells = refs;
  }

  if (classLists.length > 0) {
    data.grantedClassSpells = classLists;
  }
}

/**
 * Собирает `featData` записи из строчной модели формы.
 *
 * Обратное `featDataToGrants`: форма правит дары строками, а на лист и в
 * компендиум уходит `featData` — то, что понимает движок.
 *
 * Выдаваемые заклинания приходят вместе с остальной механикой — группами
 * ({@link EditableFeatGrants.grantedSpellGroups}), а не отдельным списком: у
 * группы есть уровень и источник, и вторым аргументом их было бы не передать.
 *
 * @param grants - дары записи, как их набрали в форме
 * @returns данные записи либо `undefined`, когда механики у неё нет
 */
export function buildFeatData(
  grants: EditableFeatGrants,
): FeatData | undefined {
  const data: FeatData = { type: 'feat' };
  const choices: FeatChoice[] = [];

  // Ключи автору не показываются, поэтому пустой ключ чинится, а не отбрасывает
  // выбор: иначе механика пропала бы молча и починить её в окне было бы нечем
  const takenKeys = usedChoiceKeys(grants);

  for (const row of grants.grantRows) {
    if (row.mode === 'all') {
      // Характеристики раскладывает повышение, а у «варианта» и типа урона
      // фиксированной выдачи нет — их значения имеют смысл только как набор
      if (hasKind(row, 'feat')) {
        applyGrantedFeatRow(data, row);

        continue;
      }

      if (
        !hasKind(row, 'ability')
        && !hasKind(row, 'damageType')
        && !hasKind(row, 'option')
      ) {
        applyFixedGrantRow(data, row);
      }

      continue;
    }

    ensureKey(row, primaryKind(row), takenKeys);
    choices.push(grantRowToChoice(row));
  }

  const defenseChoices = buildDamageDefenseChoices(
    grants.modifiers,
    takenKeys,
    choices,
  );

  choices.push(
    ...buildSpellChoices(
      grants.spellChoice,
      takenKeys,
      new Set(choices.map((choice) => choice.key)),
    ),
  );

  if (choices.length > 0) {
    data.choices = choices;
  }

  if (defenseChoices.length > 0) {
    data.damageDefenseChoices = defenseChoices;
  }

  const increase = buildAbilityScoreIncrease(grants.grantRows);

  if (increase) {
    data.abilityScoreIncrease = increase;
  }

  const built = buildModifiers(grants.modifiers);

  // Легаси-поле пишется вместе со списком: его читают потребители, до которых
  // новое поле ещё не доехало. Иммунитет и уязвимость им не описать
  const legacyResistance = defenseChoices.find(
    (choice) => choice.kind === 'resistance',
  );

  if (legacyResistance) {
    built.modifiers.resistanceFromChoiceKey = legacyResistance.choiceKey;
  }

  if (Object.keys(built.modifiers).length > 0) {
    data.modifiers = built.modifiers;
  }

  if (built.darkvision > 0) {
    data.darkvision = built.darkvision;
  }

  if (built.damageDefenses.length > 0) {
    data.damageDefenses = built.damageDefenses;
  }

  if (built.conditionImmunities.length > 0) {
    data.conditionImmunities = built.conditionImmunities;
  }

  const prerequisite = buildPrerequisite(grants.prerequisites);

  if (prerequisite) {
    data.prerequisite = prerequisite;
  }

  const counters: FeatCounterDefinition[] = grants.counters
    .filter((counter) => counter.key.trim() && counter.name.trim())
    .map((counter) => {
      const builtCounter: FeatCounterDefinition = {
        key: counter.key.trim(),
        name: counter.name.trim(),
        max: counter.max.trim() || '0',
        recovery: counter.recovery,
      };

      if (counter.shortName.trim()) {
        builtCounter.shortName = counter.shortName.trim();
      }

      // Нулевая граница ничего не описывает: у ресурса без неё поля быть не
      // должно
      if (counter.min > 0) {
        builtCounter.min = Math.round(counter.min);
      }

      const progression = entriesToProgression(counter.progression);

      if (progression) {
        builtCounter.progression = progression;
      }

      return builtCounter;
    });

  if (counters.length > 0) {
    data.counters = counters;
  }

  applyGrantedSpellGroups(grants.grantedSpellGroups, data);

  const spellList = buildSpellListExpansion(grants.spellList);

  if (spellList) {
    data.spellList = spellList;
  }

  // Характеристика одна — она и есть характеристика черты; несколько уехали
  // выбором игрока, и жёстко задавать тут нечего
  const [onlyAbility] = grants.spellChoice.abilityOptions;

  if (onlyAbility && grants.spellChoice.abilityOptions.length === 1) {
    data.spellcastingAbility = onlyAbility;
  }

  // Пишется только «готовить не нужно»: умолчание — готовить, и явное `false`
  // ничего не меняет, зато засоряет блоб у каждой черты без заклинаний
  if (grants.grantedSpellsAlwaysPrepared) {
    data.grantedSpellsAlwaysPrepared = true;
  }

  // Кроме дискриминанта `type` ничего не задано — блоб не нужен.
  return Object.keys(data).length > 1 ? data : undefined;
}
