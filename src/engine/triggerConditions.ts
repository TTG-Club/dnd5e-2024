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

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { RollContext } from './effectPipeline.js';
import type {
  EffectTrigger,
  EffectTriggerEvent,
} from './effectTriggerTypes.js';

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
  targetHpGateMatches,
} from './effectPipeline.js';
import {
  DAMAGE_DATA_TRIGGER_EVENTS,
  isEffectTag,
  OTHER_PARTY_TRIGGER_EVENTS,
} from './effectTriggerTypes.js';
import { resolveEntityCurrentHp, resolveEntityMaxHp } from './hitPoints.js';

/** Урон, от которого сработало событие */
export interface TriggerDamageData {
  /** Сколько урона дошло до хитов (с временными) */
  amount: number;
  /** Типы урона */
  types: readonly string[];
  /** Критическое попадание */
  critical: boolean;
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
 *   владеет.
 */
export type TriggerConditionKind = (typeof TRIGGER_CONDITION_KINDS)[number];

/** Какое значение выбирается у части условия */
export type TriggerConditionParameter =
  'damageType' | 'creatureType' | 'tag' | 'number' | 'size' | 'condition';

/** Часть условия срабатывания: вид и значение, если оно есть */
export interface TriggerConditionPart {
  kind: TriggerConditionKind;
  value?: string;
  /** Порог счётчика отметок (`selfTagCountAtLeast`) */
  amount?: number;
}

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
  otherCreatureType: OTHER_PARTY_TRIGGER_EVENTS,
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
};

/**
 * Счётчик отметок строкой: `self.tagCount["провал"] >= 3`. Ключ в квадратных
 * скобках — в ключе отметки бывает точка, и через точку его не прочитать.
 */
const TAG_COUNT_PATTERN = /^self\.tagCount\["([^"]+)"\] >= (\d+)$/u;

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
  return kind === 'selfTagCountAtLeast';
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

  const { damage } = eventData;
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
    default:
      return evaluateConditionPart(
        text.trim(),
        buildTriggerRollContext(entity, eventData),
      );
  }
}

/** Что известно о наложении эффекта для его условия */
export interface EffectLandingContext {
  /** Кто накладывает */
  source?: DnDSceneEntity;
  /** Наложение ударом оружия, приёмом которого атакующий владеет */
  weaponMastery?: boolean;
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
    {
      other: landing.source,
      sourceId: landing.source?.id ?? effect.sourceActorId,
      weaponMastery: landing.weaponMastery,
    },
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
