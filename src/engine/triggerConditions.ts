/**
 * Условия срабатываний эффекта: «только если урон огнём», «кроме излучения и
 * крита», «цель помечена мной», «носитель окровавлен».
 *
 * Условие — та же строка закрытого словаря, что у модификаторов: части через
 * `&&`, каждая — из перечня. Словарь срабатываний шире: у события есть свои
 * данные (урон, бросок, другая сторона), и отрицание пишется явной частью
 * (`damage.type !== "radiant"`), а не приставкой — так словарь остаётся
 * перечнем. Незнакомая часть не выполняется: срабатывание с непонятым условием
 * молчит, а не бьёт всегда.
 */

import type { AbilityType } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { AttackFlagCategory } from './attackUtils.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { RollContext } from './effectPipeline.js';
import type {
  EffectTrigger,
  EffectTriggerEvent,
} from './effectTriggerTypes.js';
import type { SceneOffset } from './forcedMovement.js';

import {
  CARRIER_TYPE_CONDITION_PREFIX,
  CONDITION_AND_SEPARATOR,
  listLiveEffects,
  splitConditionParts,
  TARGET_TYPE_CONDITION_PREFIX,
} from './activeEffectTypes.js';
import { INCAPACITATED_CONDITION_KEY } from './conditionKeys.js';
import {
  CREATURE_SIZES,
  isAbilityType,
  isCreatureCategory,
  isCreatureSize,
  normalizeCreatureSize,
} from './consts.js';
import { resolveEntityCreatureType } from './creatureTypeGate.js';
import { isDamageType } from './damageConstants.js';
import {
  buildCarrierContext,
  evaluateConditionPart,
  listEntityMarkSources,
  MARKED_BY_SELF_CONDITION,
  resolveActorStats,
  targetHpGateMatches,
} from './effectPipeline.js';
import {
  ATTACK_DATA_TRIGGER_EVENTS,
  COMBAT_ROUND_TRIGGER_EVENTS,
  DAMAGE_DATA_TRIGGER_EVENTS,
  isEffectTag,
  MOVEMENT_TRIGGER_EVENTS,
  OTHER_PARTY_TRIGGER_EVENTS,
  OWN_DEED_TRIGGER_EVENTS,
} from './effectTriggerTypes.js';
import { isDndActor } from './entityGuards.js';
import {
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
} from './hitPoints.js';

/** Урон, от которого сработало событие */
export interface TriggerDamageData {
  /** Сколько урона дошло до хитов (с временными) */
  amount: number;
  /** Типы урона */
  types: readonly string[];
  /** Критическое попадание */
  critical: boolean;
}

/** Чем бьют: вид атаки, от которого зависят части условия */
export const TRIGGER_ATTACK_KINDS = [
  'melee',
  'ranged',
  'weapon',
  'spell',
  'unarmed',
] as const;

/** Вид атаки события */
export type TriggerAttackKind = (typeof TRIGGER_ATTACK_KINDS)[number];

/** Виды атаки строками — для сверки со значением части условия */
const ATTACK_KIND_VALUES: readonly string[] = TRIGGER_ATTACK_KINDS;

/**
 * Вид ли атаки эта строка.
 *
 * @param value - строка из условия или данных
 * @returns `true`, если это известный вид атаки
 */
export function isTriggerAttackKind(value: string): value is TriggerAttackKind {
  return ATTACK_KIND_VALUES.includes(value);
}

/** Атаки в событии нет: сверять не с чем */
const EMPTY_ATTACK_KINDS: readonly string[] = [];

/**
 * Виды атаки по её типу из нейтрального контекста ядра.
 *
 * Ядро различает рукопашную, дальнобойную и заклинание. «Оружием» и
 * «безоружная» отсюда не выводятся — их принесёт событие «атака попала»
 * (`docs/EFFECT_SCENARIOS.md`, раздел «Пробелы»).
 *
 * @param attackType - тип атаки из контекста ядра
 * @returns виды атаки для условия
 */
export function toTriggerAttackKinds(
  attackType: AttackFlagCategory,
): TriggerAttackKind[] {
  return attackType === 'spell' ? ['spell'] : [attackType, 'weapon'];
}

/** Атака, от которой сработало событие */
export interface TriggerAttackData {
  /**
   * Попал ли бросок. Не задано — неизвестно, и части «попал» / «промахнулся»
   * не выполняются обе
   */
  landed?: boolean;
  /** Вид атаки: рукопашная, дальнобойная, оружием, заклинанием, безоружная */
  kinds: readonly TriggerAttackKind[];
  /** Характеристика, которой считается атака */
  ability?: AbilityType;
}

/** Что известно о событии срабатывания */
export interface TriggerEventData {
  /** Урон события «получил урон» и «хиты упали до 0» */
  damage?: TriggerDamageData;
  /** Режим броска атаки */
  roll?: { hasAdvantage: boolean; hasDisadvantage: boolean };
  /** Другая сторона: противник в атаке, источник урона */
  other?: DnDSceneEntity;
  /** Кто наложил эффект, чьё срабатывание проверяется */
  sourceId?: string;
  /** Наложение ударом оружия: атакующий владеет его приёмом */
  weaponMastery?: boolean;
  /** Ключи состояний, снятых этим снимком — у события «состояние снялось» */
  lostConditions?: readonly string[];
  /** Вид атаки и её характеристика — у событий с атакой */
  attack?: TriggerAttackData;
  /**
   * Далеко ли наложивший эффект: проверка «в пределах N футов». Сцену знает
   * только инициатор, поэтому проверку он и передаёт. Нет поля — расстояние
   * неизвестно, и часть условия о нём НЕ выполняется.
   */
  isSourceWithin?: (feet: number) => boolean;
  /**
   * Номер идущего раунда боя. Его знает только ядро (`getCombatRound`), и не
   * на всяком пути: у клиентского «При действии» его нет. Нет поля — раунд
   * неизвестен, и части расписания НЕ выполняются.
   */
  combatRound?: number;
  /** Перемещение носителя — у события «прошёл N футов» */
  movement?: {
    /** Фишку переставили правила (толчок, притягивание), а не носитель */
    forced: boolean;
    /** Смещение фишки за перемещение, px */
    offset?: SceneOffset;
  };
}

/** Виды частей условия срабатывания */
export const TRIGGER_CONDITION_KINDS = [
  'damageType',
  'damageTypeNot',
  'damageCritical',
  'damageNotCritical',
  'selfBloodied',
  'selfWounded',
  'selfCreatureType',
  'selfTag',
  'selfTagNot',
  'rollAdvantage',
  'rollDisadvantage',
  'otherCreatureType',
  'otherMarkedBySelf',
  'selfHpAtMost',
  'selfHpAtLeast',
  'selfSizeAtMost',
  'selfSizeAtLeast',
  'selfCondition',
  'selfConditionNot',
  'selfTagCountAtLeast',
  'selfTagFromSource',
  'selfTagFromSourceNot',
  'sourceWeaponMastery',
  'selfTempHpZero',
  'selfGrounded',
  'selfSpecies',
  'selfAbilityAtMost',
  'selfAbilityAtLeast',
  'otherIsSource',
  'otherBloodied',
  'otherHpAtMost',
  'damageAtLeast',
  'sourceWithin',
  'attackKind',
  'attackAbility',
  'attackLanded',
  'attackMissed',
  'combatRoundIs',
  'combatRoundAtLeast',
  'movementOwn',
  'movementForced',
] as const;

/**
 * Вид части условия:
 * - `damageType` / `damageTypeNot` — урон этого типа / без этого типа;
 * - `damageCritical` / `damageNotCritical` — крит / не крит;
 * - `selfBloodied` / `selfWounded` — у носителя не больше половины хитов / хиты не полные;
 * - `selfCreatureType` — тип носителя;
 * - `selfTag` / `selfTagNot` — на носителе есть / нет отметки;
 * - `rollAdvantage` / `rollDisadvantage` — атака с преимуществом / помехой;
 * - `otherCreatureType` — тип другой стороны;
 * - `otherMarkedBySelf` — другая сторона помечена носителем;
 * - `selfHpAtMost` / `selfHpAtLeast` — хитов у носителя не больше / не меньше N;
 * - `selfSizeAtMost` / `selfSizeAtLeast` — размер носителя не больше / не меньше;
 * - `selfCondition` / `selfConditionNot` — на носителе есть / нет состояния;
 * - `selfTagCountAtLeast` — отметок с ключом на носителе не меньше N (счётчик);
 * - `selfTagFromSource` / `selfTagFromSourceNot` — есть / нет отметки,
 *   поставленной тем же, кто наложил эффект («невосприимчив к этому источнику»);
 * - `sourceWeaponMastery` — наложение ударом оружия, приёмом которого атакующий
 *   владеет;
 * - `selfTempHpZero` — у носителя нет временных хитов;
 * - `selfGrounded` — носитель стоит на земле (не летит);
 * - `selfSpecies` — вид носителя по названию записи;
 * - `selfAbilityAtMost` / `selfAbilityAtLeast` — характеристика носителя не
 *   больше / не меньше N;
 * - `otherIsSource` — другая сторона и есть тот, кто наложил эффект;
 * - `otherBloodied` — у другой стороны не больше половины хитов;
 * - `otherHpAtMost` — у другой стороны не больше N хитов;
 * - `damageAtLeast` — урон события не меньше N;
 * - `sourceWithin` — наложивший эффект в пределах N футов;
 * - `attackKind` — вид атаки события;
 * - `attackAbility` — атака считается этой характеристикой;
 * - `combatRoundIs` / `combatRoundAtLeast` — идёт раунд боя N / раунд не
 *   раньше N (расписание «на втором раунде», «с третьего раунда»);
 * - `movementOwn` / `movementForced` — носитель шёл сам / его переставили
 *   правила (толчок, притягивание, телепортация).
 */
export type TriggerConditionKind = (typeof TRIGGER_CONDITION_KINDS)[number];

/** Какое значение выбирается у части условия */
export type TriggerConditionParameter =
  | 'damageType'
  | 'creatureType'
  | 'tag'
  | 'number'
  | 'size'
  | 'condition'
  | 'ability'
  | 'attackKind'
  | 'text';

/** Часть условия срабатывания: вид и значение, если оно есть */
export interface TriggerConditionPart {
  kind: TriggerConditionKind;
  value?: string;
  /** Порог счётчика отметок (`selfTagCountAtLeast`) */
  amount?: number;
}

/**
 * События, где известна другая сторона: противник в атаке, источник урона и
 * тот, кого носитель свалил, — условия о ней читают `eventData.other`.
 */
const OTHER_CONDITION_EVENTS: readonly EffectTriggerEvent[] = [
  ...OTHER_PARTY_TRIGGER_EVENTS,
  ...OWN_DEED_TRIGGER_EVENTS,
];

/**
 * На каких событиях часть условия что-то значит; `undefined` — на любых. На
 * чужом событии часть не выполняется: данных для неё нет.
 */
const KIND_EVENTS: Record<
  TriggerConditionKind,
  readonly EffectTriggerEvent[] | undefined
> = {
  damageType: DAMAGE_DATA_TRIGGER_EVENTS,
  damageTypeNot: DAMAGE_DATA_TRIGGER_EVENTS,
  damageCritical: DAMAGE_DATA_TRIGGER_EVENTS,
  damageNotCritical: DAMAGE_DATA_TRIGGER_EVENTS,
  selfBloodied: undefined,
  selfWounded: undefined,
  selfCreatureType: undefined,
  selfTag: undefined,
  selfTagNot: undefined,
  rollAdvantage: ['attackRoll'],
  rollDisadvantage: ['attackRoll'],
  otherCreatureType: OTHER_CONDITION_EVENTS,
  otherMarkedBySelf: ['attackRoll'],
  selfHpAtMost: undefined,
  selfHpAtLeast: undefined,
  selfSizeAtMost: undefined,
  selfSizeAtLeast: undefined,
  selfCondition: undefined,
  selfConditionNot: undefined,
  selfTagCountAtLeast: undefined,
  selfTagFromSource: undefined,
  selfTagFromSourceNot: undefined,
  sourceWeaponMastery: ['applied'],
  selfTempHpZero: undefined,
  selfGrounded: undefined,
  selfSpecies: undefined,
  selfAbilityAtMost: undefined,
  selfAbilityAtLeast: undefined,
  otherIsSource: OTHER_CONDITION_EVENTS,
  otherBloodied: OTHER_CONDITION_EVENTS,
  otherHpAtMost: OTHER_CONDITION_EVENTS,
  damageAtLeast: DAMAGE_DATA_TRIGGER_EVENTS,
  sourceWithin: undefined,
  attackKind: ATTACK_DATA_TRIGGER_EVENTS,
  attackAbility: ATTACK_DATA_TRIGGER_EVENTS,
  attackLanded: ATTACK_DATA_TRIGGER_EVENTS,
  attackMissed: ATTACK_DATA_TRIGGER_EVENTS,
  combatRoundIs: COMBAT_ROUND_TRIGGER_EVENTS,
  combatRoundAtLeast: COMBAT_ROUND_TRIGGER_EVENTS,
  movementOwn: MOVEMENT_TRIGGER_EVENTS,
  movementForced: MOVEMENT_TRIGGER_EVENTS,
};

/** Части условия со значением: приставка строки и что выбирается */
const PARAMETRIC_PARTS: Partial<
  Record<
    TriggerConditionKind,
    { prefix: string; parameter: TriggerConditionParameter }
  >
> = {
  damageType: { prefix: 'damage.type === ', parameter: 'damageType' },
  damageTypeNot: { prefix: 'damage.type !== ', parameter: 'damageType' },
  selfCreatureType: {
    prefix: CARRIER_TYPE_CONDITION_PREFIX,
    parameter: 'creatureType',
  },
  otherCreatureType: {
    prefix: TARGET_TYPE_CONDITION_PREFIX,
    parameter: 'creatureType',
  },
  selfTag: { prefix: 'self.tag === ', parameter: 'tag' },
  selfTagNot: { prefix: 'self.tag !== ', parameter: 'tag' },
  selfHpAtMost: { prefix: 'self.hp.value <= ', parameter: 'number' },
  selfHpAtLeast: { prefix: 'self.hp.value >= ', parameter: 'number' },
  selfSizeAtMost: { prefix: 'self.size <= ', parameter: 'size' },
  selfSizeAtLeast: { prefix: 'self.size >= ', parameter: 'size' },
  selfCondition: { prefix: 'self.condition === ', parameter: 'condition' },
  selfConditionNot: { prefix: 'self.condition !== ', parameter: 'condition' },
  selfTagCountAtLeast: { prefix: 'self.tagCount[', parameter: 'tag' },
  selfTagFromSource: { prefix: 'self.tagFromSource === ', parameter: 'tag' },
  selfTagFromSourceNot: {
    prefix: 'self.tagFromSource !== ',
    parameter: 'tag',
  },
  selfSpecies: { prefix: 'self.species === ', parameter: 'text' },
  otherHpAtMost: { prefix: 'target.hp.value <= ', parameter: 'number' },
  damageAtLeast: { prefix: 'damage.amount >= ', parameter: 'number' },
  sourceWithin: { prefix: 'source.distance <= ', parameter: 'number' },
  attackKind: { prefix: 'attack.kind === ', parameter: 'attackKind' },
  attackAbility: { prefix: 'attack.ability === ', parameter: 'ability' },
  selfAbilityAtMost: { prefix: 'self.ability[', parameter: 'ability' },
  selfAbilityAtLeast: { prefix: 'self.ability[', parameter: 'ability' },
  combatRoundIs: { prefix: 'combat.round === ', parameter: 'number' },
  combatRoundAtLeast: { prefix: 'combat.round >= ', parameter: 'number' },
};

/**
 * Счётчик отметок строкой: `self.tagCount["провал"] >= 3`. Ключ в квадратных
 * скобках — в ключе отметки бывает точка, и через точку его не прочитать.
 */
const TAG_COUNT_PATTERN = /^self\.tagCount\["([^"]+)"\] >= (\d+)$/u;

/**
 * Характеристика носителя строкой: `self.ability["strength"] >= 13`. Как у
 * счётчика отметок, у части два значения — какая характеристика и порог.
 */
const ABILITY_PATTERN = /^self\.ability\["(\w+)"\] (<=|>=) (\d+)$/u;

/** Части условия с порогом: у них два значения, а не одно */
const PARTS_WITH_AMOUNT: readonly TriggerConditionKind[] = [
  'selfTagCountAtLeast',
  'selfAbilityAtMost',
  'selfAbilityAtLeast',
];

/** Порог характеристики, пока автор не задал свой */
export const DEFAULT_ABILITY_THRESHOLD = 10;

/** Порог счётчика отметок, пока автор не задал свой */
export const DEFAULT_TAG_COUNT_THRESHOLD = 3;

/** Наименьший порог счётчика отметок */
export const MIN_TAG_COUNT_THRESHOLD = 1;

/**
 * Есть ли у части условия второе число — порог (счётчик отметок).
 *
 * @param kind - вид части
 * @returns `true` для части с порогом
 */
export function triggerConditionHasAmount(kind: TriggerConditionKind): boolean {
  return PARTS_WITH_AMOUNT.includes(kind);
}

/**
 * Порог счётчика из ввода: целое не меньше наименьшего.
 *
 * @param value - введённое число; пусто — наименьший порог
 * @returns порог
 */
export function normalizeTagCountThreshold(
  value: number | null | undefined,
): number {
  return Math.max(
    MIN_TAG_COUNT_THRESHOLD,
    Math.trunc(value ?? MIN_TAG_COUNT_THRESHOLD),
  );
}

/** Самый большой порог числа в условии: хиты и счётчики */
const MAX_CONDITION_NUMBER = 100_000;

/** Самая длинная свободная строка в условии: название вида */
const MAX_CONDITION_TEXT = 100;

/** Части условия без значения — строкой целиком */
const FIXED_PARTS: Partial<Record<TriggerConditionKind, string>> = {
  damageCritical: 'damage.isCritical === true',
  damageNotCritical: 'damage.isCritical === false',
  selfBloodied: 'self.hp.value <= (self.hp.max / 2)',
  selfWounded: 'self.hp.value < self.hp.max',
  rollAdvantage: 'roll.hasAdvantage === true',
  rollDisadvantage: 'roll.hasDisadvantage === true',
  otherMarkedBySelf: MARKED_BY_SELF_CONDITION,
  sourceWeaponMastery: 'source.weaponMastery === true',
  selfTempHpZero: 'self.hp.temp === 0',
  selfGrounded: 'self.grounded === true',
  otherIsSource: 'target.isSource === true',
  otherBloodied: 'target.hp.value <= (target.hp.max / 2)',
  attackLanded: 'attack.landed === true',
  attackMissed: 'attack.landed === false',
  movementOwn: 'move.forced === false',
  movementForced: 'move.forced === true',
};

/** Кавычки вокруг значения в строке условия */
const QUOTES_PATTERN = /^["']|["']$/g;

/** Целое неотрицательное число строкой */
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * Годится ли строка числом условия.
 *
 * @param value - строка
 * @returns `true` для целого от 0 до предела
 */
function isConditionNumber(value: string): boolean {
  return (
    WHOLE_NUMBER_PATTERN.test(value) && Number(value) <= MAX_CONDITION_NUMBER
  );
}

/**
 * Годится ли значение для части условия.
 *
 * @param parameter - что выбирается
 * @param value - значение
 * @returns `true`, если значение из словаря
 */
function isParameterValue(
  parameter: TriggerConditionParameter,
  value: string,
): boolean {
  switch (parameter) {
    case 'damageType':
      return isDamageType(value);
    case 'creatureType':
      return isCreatureCategory(value);
    case 'number':
      return isConditionNumber(value);
    case 'size':
      return isCreatureSize(value);
    case 'ability':
      return isAbilityType(value);
    case 'attackKind':
      return isTriggerAttackKind(value);
    case 'text':
      return value.trim().length > 0 && value.length <= MAX_CONDITION_TEXT;
    default:
      // Ключ состояния мира и ключ отметки — одного вида: буквы, цифры, «_.-»
      return isEffectTag(value);
  }
}

/**
 * Действующие отметки сущности с ключом.
 *
 * @param entity - сущность
 * @param tag - ключ отметки
 * @returns эффекты отметок
 */
function listEffectTags(entity: DnDSceneEntity, tag: string): ActiveEffect[] {
  return listLiveEffects(entity).filter((effect) => effect.tag === tag);
}

/**
 * Сколько раз на сущности поставлена отметка: у счётчика — число ступеней.
 *
 * @param entity - сущность
 * @param tag - ключ отметки
 * @returns число отметок
 */
export function countEffectTag(entity: DnDSceneEntity, tag: string): number {
  return listEffectTags(entity, tag).reduce(
    (total, effect) => total + (effect.tagStacks ?? 1),
    0,
  );
}

/**
 * Есть ли на сущности отметка, поставленная этим источником.
 *
 * @param entity - сущность
 * @param tag - ключ отметки
 * @param sourceId - кто поставил
 * @returns `true`, если такая отметка есть
 */
function hasEffectTagFromSource(
  entity: DnDSceneEntity,
  tag: string,
  sourceId: string | undefined,
): boolean {
  return (
    sourceId !== undefined
    && listEffectTags(entity, tag).some(
      (effect) => effect.sourceActorId === sourceId,
    )
  );
}

/**
 * Есть ли на сущности состояние. Недееспособность дают и другие состояния
 * («Парализованный», «Ошеломлённый») — их флагом.
 *
 * @param entity - сущность
 * @param condition - ключ состояния
 * @returns `true`, если состояние есть
 */
export function hasEntityCondition(
  entity: DnDSceneEntity,
  condition: string,
): boolean {
  const effects = listLiveEffects(entity);

  if (effects.some((effect) => effect.conditionKey === condition)) {
    return true;
  }

  // Недееспособность ставят и другие состояния — своим флагом
  return (
    condition === INCAPACITATED_CONDITION_KEY
    && effects.some((effect) =>
      effect.flags.includes(INCAPACITATED_CONDITION_KEY),
    )
  );
}

/**
 * Значение характеристики носителя со всеми эффектами.
 *
 * @param entity - сущность
 * @param ability - ключ характеристики
 * @returns значение либо 0, если ключ чужой
 */
function resolveEntityAbilityScore(
  entity: DnDSceneEntity,
  ability: string,
): number {
  return isAbilityType(ability)
    ? resolveActorStats(entity).abilities[ability]
    : 0;
}

/**
 * Стоит ли существо на земле.
 *
 * Отдельного признака полёта у сущности нет: летит то, у чего есть скорость
 * полёта. Это приближение — существо со скоростью полёта может стоять на
 * земле, — и оно записано в каталоге.
 *
 * @param entity - сущность
 * @returns `true`, если существо не летает
 */
function isEntityGrounded(entity: DnDSceneEntity): boolean {
  return resolveActorStats(entity).movement.fly <= 0;
}

/**
 * Совпадает ли вид существа с названием или ключом. Сравнение без учёта
 * регистра и крайних пробелов: вид пишется от руки, а в записи он лежит и
 * ключом, и названием.
 *
 * @param entity - сущность
 * @param species - название или ключ вида
 * @returns `true`, если вид совпал
 */
function matchesEntitySpecies(
  entity: DnDSceneEntity,
  species: string,
): boolean {
  // Вид есть только у персонажа: у существа его роль играет статблок
  if (!isDndActor(entity)) {
    return false;
  }

  const own = entity.system.species;
  const wanted = species.trim().toLowerCase();

  return [own?.speciesKey, own?.speciesName].some(
    (value) => value?.trim().toLowerCase() === wanted,
  );
}

/**
 * Номер размера по порядку от крошечного.
 *
 * @param size - размер
 * @returns номер
 */
function sizeRank(size: string): number {
  return CREATURE_SIZES.findIndex((entry) => entry === size);
}

/**
 * Есть ли на сущности действующая отметка.
 *
 * @param entity - сущность
 * @param tag - ключ отметки
 * @returns `true`, если отметка есть и не отключена
 */
export function hasEffectTag(entity: DnDSceneEntity, tag: string): boolean {
  return listEffectTags(entity, tag).length > 0;
}

/**
 * Что выбирается у вида условия.
 *
 * @param kind - вид части
 * @returns параметр либо `undefined`, если значения нет
 */
export function getTriggerConditionParameter(
  kind: TriggerConditionKind,
): TriggerConditionParameter | undefined {
  return PARAMETRIC_PARTS[kind]?.parameter;
}

/**
 * Строка части условия.
 *
 * @param part - вид и значение
 * @returns строка словаря
 */
export function buildTriggerConditionPart(part: TriggerConditionPart): string {
  if (part.kind === 'selfTagCountAtLeast') {
    return `self.tagCount["${part.value ?? ''}"] >= ${part.amount ?? DEFAULT_TAG_COUNT_THRESHOLD}`;
  }

  if (part.kind === 'selfAbilityAtMost' || part.kind === 'selfAbilityAtLeast') {
    const sign = part.kind === 'selfAbilityAtMost' ? '<=' : '>=';

    return `self.ability["${part.value ?? ''}"] ${sign} ${part.amount ?? DEFAULT_ABILITY_THRESHOLD}`;
  }

  const parametric = PARAMETRIC_PARTS[part.kind];

  if (!parametric) {
    return FIXED_PARTS[part.kind] ?? '';
  }

  // Число пишется без кавычек: `self.hp.value <= 50`
  return parametric.parameter === 'number'
    ? `${parametric.prefix}${part.value ?? '0'}`
    : `${parametric.prefix}"${part.value ?? ''}"`;
}

/**
 * Вид и значение части условия по строке.
 *
 * @param text - часть условия
 * @returns часть либо `null`, если строка не из словаря срабатываний
 */
export function parseTriggerConditionPart(
  text: string,
): TriggerConditionPart | null {
  const trimmed = text.trim();
  const ability = ABILITY_PATTERN.exec(trimmed);

  if (ability) {
    return isAbilityType(ability[1]) && isConditionNumber(ability[3])
      ? {
          kind:
            ability[2] === '<=' ? 'selfAbilityAtMost' : 'selfAbilityAtLeast',
          value: ability[1],
          amount: Number(ability[3]),
        }
      : null;
  }

  const tagCount = TAG_COUNT_PATTERN.exec(trimmed);

  if (tagCount) {
    return isEffectTag(tagCount[1]) && isConditionNumber(tagCount[2])
      ? {
          kind: 'selfTagCountAtLeast',
          value: tagCount[1],
          amount: Number(tagCount[2]),
        }
      : null;
  }

  for (const kind of TRIGGER_CONDITION_KINDS) {
    if (FIXED_PARTS[kind] === trimmed) {
      return { kind };
    }

    const parametric = PARAMETRIC_PARTS[kind];

    if (parametric && trimmed.startsWith(parametric.prefix)) {
      const value = trimmed
        .slice(parametric.prefix.length)
        .trim()
        .replace(QUOTES_PATTERN, '');

      return isParameterValue(parametric.parameter, value)
        ? { kind, value }
        : null;
    }
  }

  return null;
}

/**
 * Части условия срабатывания: разобранные и строки, которых словарь не знает
 * (их окно показывает как есть, чтобы не терять).
 *
 * @param condition - условие срабатывания
 * @returns части по порядку
 */
export function readTriggerConditionParts(
  condition: string | undefined,
): Array<TriggerConditionPart | string> {
  return splitConditionParts(condition ?? '').map(
    (text) => parseTriggerConditionPart(text) ?? text,
  );
}

/**
 * Условие срабатывания из частей.
 *
 * @param parts - части: разобранные и строки как есть
 * @returns условие либо `undefined`, если частей нет
 */
export function writeTriggerCondition(
  parts: ReadonlyArray<TriggerConditionPart | string>,
): string | undefined {
  const texts = parts
    .map((part) =>
      typeof part === 'string' ? part : buildTriggerConditionPart(part),
    )
    .filter((text) => text.length > 0);

  return texts.length > 0
    ? texts.join(` ${CONDITION_AND_SEPARATOR} `)
    : undefined;
}

/**
 * Виды условий, которые что-то значат на событии.
 *
 * @param event - событие срабатывания
 * @returns виды по порядку показа
 */
export function listTriggerConditionKinds(
  event: EffectTriggerEvent,
): TriggerConditionKind[] {
  return TRIGGER_CONDITION_KINDS.filter((kind) => {
    const events = KIND_EVENTS[kind];

    return events === undefined || events.includes(event);
  });
}

/**
 * Контекст словаря модификаторов для события: носитель — субъект, цель —
 * другая сторона.
 *
 * @param entity - субъект срабатывания
 * @param eventData - данные события
 * @returns контекст для общих частей условия
 */
function buildTriggerRollContext(
  entity: DnDSceneEntity,
  eventData: TriggerEventData,
): RollContext {
  const { other } = eventData;

  return {
    hasAdvantage: eventData.roll?.hasAdvantage ?? false,
    hasDisadvantage: eventData.roll?.hasDisadvantage ?? false,
    self: buildCarrierContext(entity),
    ...(other
      ? {
          target: {
            currentHp: resolveEntityCurrentHp(other),
            maxHp: resolveEntityMaxHp(other),
            creatureType: resolveEntityCreatureType(other),
            markedBy: listEntityMarkSources(other),
          },
        }
      : {}),
  };
}

/**
 * Выполняется ли одна часть условия.
 *
 * @param entity - субъект срабатывания
 * @param text - часть условия
 * @param eventData - данные события
 * @returns `true`, если часть выполняется
 */
function isConditionPartMet(
  entity: DnDSceneEntity,
  text: string,
  eventData: TriggerEventData,
): boolean {
  const part = parseTriggerConditionPart(text);

  if (!part) {
    return false;
  }

  const { damage, other } = eventData;
  const damageTypes: readonly string[] = damage?.types ?? [];

  switch (part.kind) {
    case 'damageType':
      return damageTypes.includes(part.value ?? '');
    case 'damageTypeNot':
      return damage !== undefined && !damageTypes.includes(part.value ?? '');
    case 'damageCritical':
      return damage?.critical === true;
    case 'damageNotCritical':
      return damage !== undefined && !damage.critical;
    case 'selfBloodied':
      return targetHpGateMatches(
        'halfOrLess',
        resolveEntityCurrentHp(entity),
        resolveEntityMaxHp(entity),
      );
    case 'selfWounded':
      return targetHpGateMatches(
        'notFull',
        resolveEntityCurrentHp(entity),
        resolveEntityMaxHp(entity),
      );
    case 'selfTag':
      return hasEffectTag(entity, part.value ?? '');
    case 'selfTagNot':
      return !hasEffectTag(entity, part.value ?? '');
    case 'selfHpAtMost':
      return resolveEntityCurrentHp(entity) <= Number(part.value);
    case 'selfHpAtLeast':
      return resolveEntityCurrentHp(entity) >= Number(part.value);
    case 'selfSizeAtMost':
      return (
        sizeRank(normalizeCreatureSize(entity.system.size))
        <= sizeRank(part.value ?? '')
      );
    case 'selfSizeAtLeast':
      return (
        sizeRank(normalizeCreatureSize(entity.system.size))
        >= sizeRank(part.value ?? '')
      );
    case 'selfCondition':
      return hasEntityCondition(entity, part.value ?? '');
    case 'selfConditionNot':
      return !hasEntityCondition(entity, part.value ?? '');
    case 'selfTagCountAtLeast':
      return (
        countEffectTag(entity, part.value ?? '')
        >= (part.amount ?? DEFAULT_TAG_COUNT_THRESHOLD)
      );
    case 'selfTagFromSource':
      return hasEffectTagFromSource(
        entity,
        part.value ?? '',
        eventData.sourceId,
      );
    case 'selfTagFromSourceNot':
      return !hasEffectTagFromSource(
        entity,
        part.value ?? '',
        eventData.sourceId,
      );
    case 'sourceWeaponMastery':
      return eventData.weaponMastery === true;
    case 'selfTempHpZero':
      return resolveEntityTempHp(entity) === 0;
    case 'selfGrounded':
      return isEntityGrounded(entity);
    case 'selfSpecies':
      return matchesEntitySpecies(entity, part.value ?? '');
    case 'selfAbilityAtMost':
      return (
        resolveEntityAbilityScore(entity, part.value ?? '')
        <= (part.amount ?? DEFAULT_ABILITY_THRESHOLD)
      );
    case 'selfAbilityAtLeast':
      return (
        resolveEntityAbilityScore(entity, part.value ?? '')
        >= (part.amount ?? DEFAULT_ABILITY_THRESHOLD)
      );
    case 'otherIsSource':
      return (
        other !== undefined
        && eventData.sourceId !== undefined
        && other.id === eventData.sourceId
      );
    case 'otherBloodied':
      return (
        other !== undefined
        && targetHpGateMatches(
          'halfOrLess',
          resolveEntityCurrentHp(other),
          resolveEntityMaxHp(other),
        )
      );
    case 'otherHpAtMost':
      return (
        other !== undefined
        && resolveEntityCurrentHp(other) <= Number(part.value)
      );
    case 'damageAtLeast':
      return damage !== undefined && damage.amount >= Number(part.value);
    case 'sourceWithin':
      // Сцену знает только инициатор: без его проверки расстояние неизвестно,
      // и часть НЕ выполняется — молчать безопаснее, чем бить всегда
      return eventData.isSourceWithin?.(Number(part.value)) === true;
    case 'attackKind':
      return (
        part.value !== undefined
        && (eventData.attack?.kinds ?? EMPTY_ATTACK_KINDS).includes(part.value)
      );
    case 'attackAbility':
      return eventData.attack?.ability === part.value;
    // Попал или нет, известно не всегда: серия снарядов сообщает о броске
    // раньше, чем сделаны сами броски. Неизвестно — обе части НЕ выполняются
    case 'attackLanded':
      return eventData.attack?.landed === true;
    case 'attackMissed':
      return eventData.attack?.landed === false;
    // Раунд знает только ядро: без него расписание НЕ выполняется — «на втором
    // раунде» не должно сработать там, где номера раунда нет
    case 'combatRoundIs':
      return eventData.combatRound === Number(part.value);
    case 'combatRoundAtLeast':
      return (
        eventData.combatRound !== undefined
        && eventData.combatRound >= Number(part.value)
      );
    case 'movementOwn':
      return eventData.movement?.forced === false;
    case 'movementForced':
      return eventData.movement?.forced === true;
    default:
      return evaluateConditionPart(
        text.trim(),
        buildTriggerRollContext(entity, eventData),
      );
  }
}

/**
 * Данные события с номером идущего раунда: его знает инициатор (ядро или
 * трекер инициативы клиента), а не сам построитель данных события.
 *
 * @param eventData - данные события
 * @param combatRound - номер раунда; `undefined` — боя нет или номер неизвестен
 * @returns данные события с раундом либо те же данные
 */
export function withCombatRound(
  eventData: TriggerEventData,
  combatRound: number | undefined,
): TriggerEventData {
  return combatRound === undefined ? eventData : { ...eventData, combatRound };
}

/** Что известно о наложении эффекта для его условия */
export interface EffectLandingContext {
  /** Кто накладывает */
  source?: DnDSceneEntity;
  /** Наложение ударом оружия, приёмом которого атакующий владеет */
  weaponMastery?: boolean;
  /** Номер идущего раунда: условие «на раунде N» */
  combatRound?: number;
}

/**
 * Ложится ли эффект: его условие наложения выполнено. Нет условия — ложится.
 *
 * @param effect - накладываемый эффект
 * @param target - на кого ложится
 * @param landing - кто накладывает и чем
 * @returns `true`, если эффект ложится
 */
export function passesLandingCondition(
  effect: Pick<ActiveEffect, 'landingCondition' | 'sourceActorId'>,
  target: DnDSceneEntity,
  landing: EffectLandingContext = {},
): boolean {
  return isTriggerConditionMet(
    target,
    { condition: effect.landingCondition },
    withCombatRound(
      {
        other: landing.source,
        sourceId: landing.source?.id ?? effect.sourceActorId,
        weaponMastery: landing.weaponMastery,
      },
      landing.combatRound,
    ),
  );
}

/**
 * Выполняется ли условие срабатывания. Нет условия — выполняется всегда;
 * части соединены «и».
 *
 * @param entity - субъект срабатывания
 * @param trigger - срабатывание
 * @param eventData - данные события
 * @returns `true`, если срабатывание может сработать
 */
export function isTriggerConditionMet(
  entity: DnDSceneEntity,
  trigger: Pick<EffectTrigger, 'condition'>,
  eventData: TriggerEventData = {},
): boolean {
  if (trigger.condition === undefined) {
    return true;
  }

  const parts = splitConditionParts(trigger.condition);

  return (
    parts.length > 0
    && parts.every((part) => isConditionPartMet(entity, part, eventData))
  );
}
