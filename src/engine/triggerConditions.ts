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

import type { DnDSceneEntity } from './dndEntities.js';
import type { RollContext } from './effectPipeline.js';
import type {
  EffectTrigger,
  EffectTriggerEvent,
} from './effectTriggerTypes.js';

import {
  CARRIER_TYPE_CONDITION_PREFIX,
  CONDITION_AND_SEPARATOR,
  splitConditionParts,
  TARGET_TYPE_CONDITION_PREFIX,
} from './activeEffectTypes.js';
import { isCreatureCategory } from './consts.js';
import { resolveEntityCreatureType } from './creatureTypeGate.js';
import { isDamageType } from './damageConstants.js';
import {
  buildCarrierContext,
  evaluateConditionPart,
  listEntityMarkSources,
  MARKED_BY_SELF_CONDITION,
  targetHpGateMatches,
} from './effectPipeline.js';
import { isEffectTag } from './effectTriggerTypes.js';
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
 * - `otherMarkedBySelf` — другая сторона помечена носителем.
 */
export type TriggerConditionKind = (typeof TRIGGER_CONDITION_KINDS)[number];

/** Какое значение выбирается у части условия */
export type TriggerConditionParameter = 'damageType' | 'creatureType' | 'tag';

/** Часть условия срабатывания: вид и значение, если оно есть */
export interface TriggerConditionPart {
  kind: TriggerConditionKind;
  value?: string;
}

/** События с уроном */
const DAMAGE_EVENTS: readonly EffectTriggerEvent[] = ['damageTaken', 'hpZero'];

/** События с другой стороной */
const OTHER_PARTY_EVENTS: readonly EffectTriggerEvent[] = [
  'attackRoll',
  'damageTaken',
];

/**
 * На каких событиях часть условия что-то значит; `undefined` — на любых. На
 * чужом событии часть не выполняется: данных для неё нет.
 */
const KIND_EVENTS: Record<
  TriggerConditionKind,
  readonly EffectTriggerEvent[] | undefined
> = {
  damageType: DAMAGE_EVENTS,
  damageTypeNot: DAMAGE_EVENTS,
  damageCritical: DAMAGE_EVENTS,
  damageNotCritical: DAMAGE_EVENTS,
  selfBloodied: undefined,
  selfWounded: undefined,
  selfCreatureType: undefined,
  selfTag: undefined,
  selfTagNot: undefined,
  rollAdvantage: ['attackRoll'],
  rollDisadvantage: ['attackRoll'],
  otherCreatureType: OTHER_PARTY_EVENTS,
  otherMarkedBySelf: ['attackRoll'],
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
};

/** Части условия без значения — строкой целиком */
const FIXED_PARTS: Partial<Record<TriggerConditionKind, string>> = {
  damageCritical: 'damage.isCritical === true',
  damageNotCritical: 'damage.isCritical === false',
  selfBloodied: 'self.hp.value <= (self.hp.max / 2)',
  selfWounded: 'self.hp.value < self.hp.max',
  rollAdvantage: 'roll.hasAdvantage === true',
  rollDisadvantage: 'roll.hasDisadvantage === true',
  otherMarkedBySelf: MARKED_BY_SELF_CONDITION,
};

/** Кавычки вокруг значения в строке условия */
const QUOTES_PATTERN = /^["']|["']$/g;

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
    default:
      return isEffectTag(value);
  }
}

/**
 * Есть ли на сущности действующая отметка.
 *
 * @param entity - сущность
 * @param tag - ключ отметки
 * @returns `true`, если отметка есть и не отключена
 */
export function hasEffectTag(entity: DnDSceneEntity, tag: string): boolean {
  return (entity.activeEffects ?? []).some(
    (effect) => !effect.disabled && effect.tag === tag,
  );
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
  const parametric = PARAMETRIC_PARTS[part.kind];

  return parametric
    ? `${parametric.prefix}"${part.value ?? ''}"`
    : (FIXED_PARTS[part.kind] ?? '');
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
 * @param data - данные события
 * @returns контекст для общих частей условия
 */
function buildTriggerRollContext(
  entity: DnDSceneEntity,
  data: TriggerEventData,
): RollContext {
  const { other } = data;

  return {
    hasAdvantage: data.roll?.hasAdvantage ?? false,
    hasDisadvantage: data.roll?.hasDisadvantage ?? false,
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
 * @param data - данные события
 * @returns `true`, если часть выполняется
 */
function isConditionPartMet(
  entity: DnDSceneEntity,
  text: string,
  data: TriggerEventData,
): boolean {
  const part = parseTriggerConditionPart(text);

  if (!part) {
    return false;
  }

  const { damage } = data;
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
    default:
      return evaluateConditionPart(
        text.trim(),
        buildTriggerRollContext(entity, data),
      );
  }
}

/**
 * Выполняется ли условие срабатывания. Нет условия — выполняется всегда;
 * части соединены «и».
 *
 * @param entity - субъект срабатывания
 * @param trigger - срабатывание
 * @param data - данные события
 * @returns `true`, если срабатывание может сработать
 */
export function isTriggerConditionMet(
  entity: DnDSceneEntity,
  trigger: Pick<EffectTrigger, 'condition'>,
  data: TriggerEventData = {},
): boolean {
  if (trigger.condition === undefined) {
    return true;
  }

  const parts = splitConditionParts(trigger.condition);

  return (
    parts.length > 0
    && parts.every((part) => isConditionPartMet(entity, part, data))
  );
}
