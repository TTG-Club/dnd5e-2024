/**
 * Фраза срабатывания для сводки эффекта.
 *
 * Срабатывания, которые выражает старое поле (урон каждый ход, повторный
 * спасбросок, снятие после атаки), описываются прежними фразами — сводка
 * существующих эффектов не меняется. Остальные собираются из частей: когда,
 * при каком условии, какой спасбросок, что при провале и успехе, как часто.
 */

import type { EffectDuration } from '@vtt/shared';

import type {
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerAreaTarget,
  EffectTriggerEvent,
  EffectTriggerLimitPeriod,
  EffectTriggerRestType,
  EffectTriggerSaveMode,
} from './effectTriggerTypes.js';
import type { TriggerConditionKind } from './triggerConditions.js';

import {
  describeConditionName,
  describeEffectChangeCondition,
  describeEffectDamageParts,
  describeEffectDuration,
} from './activeEffectDescribe.js';
import {
  ABILITY_GENITIVE_LABELS,
  CREATURE_CATEGORIES,
  CREATURE_SIZE_LABELS,
  isCreatureCategory,
  isCreatureSize,
} from './consts.js';
import { getShortDamageTypeLabel } from './damageConstants.js';
import {
  classifyLegacyTrigger,
  isTurnTriggerEvent,
  resolveTriggerActionGate,
} from './effectTriggers.js';
import { DEFAULT_TRIGGER_REST_TYPE } from './effectTriggerTypes.js';
import { EVENT_DAMAGE_VARIABLE } from './formulaParser.js';
import {
  DEFAULT_TAG_COUNT_THRESHOLD,
  readTriggerConditionParts,
} from './triggerConditions.js';

/** Что даёт успех спасброска против урона каждый ход */
const RECURRING_DAMAGE_SUCCESS_LABELS = {
  negate: 'без урона',
  half: 'половина урона',
} as const;

/** Снятие после атаки — продолжением перечисления */
const CONSUME_ON_LABELS = {
  attacker: 'снимается после своей атаки',
  target: 'снимается после атаки по носителю',
} as const;

/** Когда срабатывает — по событию */
const TRIGGER_EVENT_LABELS: Record<EffectTriggerEvent, string> = {
  turnStart: 'в начале хода',
  turnEnd: 'в конце хода',
  enter: 'при входе',
  exit: 'при выходе',
  applied: 'при наложении',
  attackRoll: 'при броске атаки',
  damageTaken: 'при получении урона',
  hpZero: 'когда хиты падают до 0',
  rest: 'после отдыха',
  activate: 'при включении',
  castEnd: 'когда заклинание заканчивается',
};

/** Бросок атаки — по роли субъекта */
const ATTACK_ROLE_EVENT_LABELS = {
  attacker: 'после своей атаки',
  target: 'после атаки по носителю',
} as const;

/** Период лимита — «не чаще … за ход» */
const LIMIT_PERIOD_LABELS: Record<EffectTriggerLimitPeriod, string> = {
  turn: 'ход',
  round: 'раунд',
  shortRest: 'короткий отдых',
  longRest: 'долгий отдых',
};

/** Части фраз срабатывания */
const TRIGGER_LABELS = {
  everyTurnPrefix: 'каждый ход ',
  startOfTurn: ' в начале хода',
  endOfTurn: ' в конце хода',
  sourceTurnSuffix: ' источника',
  damageSaveSuccess: ': успех — ',
  recurringSavePrefix: 'повторный спасбросок ',
  recurringSaveSuffix: ' снимает эффект',
  savePrefix: 'спасбросок ',
  failurePrefix: 'провал — ',
  successPrefix: 'успех — ',
  conditionPrefix: ', если ',
  halfDamage: 'половина урона',
  effect: 'эффект',
  removeSelf: 'эффект снимается',
  tagPrefix: 'отметка ',
  conditionJoiner: ' и ',
  setHpPrefix: 'хиты становятся ',
  endCast: 'каст заканчивается',
  dcFormulaPrefix: 'Сл = ',
  damageVariable: 'урон',
  recipientOther: ', на другую сторону',
  recipientAreaPrefix: ', на ',
  recipientAreaSuffix: ' фт вокруг',
  nothing: 'ничего',
  listJoiner: ', ',
  clauseJoiner: '; ',
  limitPrefix: ', не чаще ',
  limitOnce: 'одного раза',
  limitTimes: ' раз',
  limitPeriodPrefix: ' за ',
  stackSuffix: ' +1',
  maxHpPrefix: 'максимум хитов −',
  saveModeAdvantage: ' с преимуществом',
  saveModeDisadvantage: ' с помехой',
} as const;

/** Кого задевает «всем в радиусе» — в фразе */
const AREA_TARGET_PHRASES: Record<EffectTriggerAreaTarget, string> = {
  all: 'всех',
  allies: 'союзников',
  enemies: 'врагов',
};

/**
 * Кому достаются действия — часть фразы.
 *
 * @param trigger - срабатывание
 * @returns часть фразы; субъект — пусто
 */
function describeTriggerRecipient(trigger: EffectTrigger): string {
  if (trigger.recipient === 'other') {
    return TRIGGER_LABELS.recipientOther;
  }

  if (trigger.recipient !== 'area' || !trigger.area) {
    return '';
  }

  const target = AREA_TARGET_PHRASES[trigger.area.target ?? 'all'];

  return `${TRIGGER_LABELS.recipientAreaPrefix}${target} в ${trigger.area.radius}${TRIGGER_LABELS.recipientAreaSuffix}`;
}

/** Отдых срабатывания «после отдыха» */
const REST_EVENT_LABELS: Record<EffectTriggerRestType, string> = {
  long: 'после долгого отдыха',
  short: 'после короткого отдыха',
  any: 'после любого отдыха',
};

/** До какого отдыха держится уменьшение максимума хитов */
const REST_UNTIL_LABELS: Record<EffectTriggerRestType, string> = {
  long: ' до долгого отдыха',
  short: ' до короткого отдыха',
  any: ' до отдыха',
};

/** Настройки фразы */
export interface EffectTriggerDescribeOptions {
  /** Подпись Сл (0 — Сл источника по месту окна) */
  formatDc: (dc: number) => string;
}

/**
 * Подписи частей условия срабатывания; значение — тип урона, существа, отметка,
 * размер, состояние или число, `amount` — порог счётчика отметок.
 */
const TRIGGER_CONDITION_PHRASES: Record<
  TriggerConditionKind,
  (value: string, amount: number) => string
> = {
  damageType: (value) => `урон ${getShortDamageTypeLabel(value)}`,
  damageTypeNot: (value) => `урон не ${getShortDamageTypeLabel(value)}`,
  damageCritical: () => 'критическое попадание',
  damageNotCritical: () => 'не критическое попадание',
  selfBloodied: () => 'у носителя не больше половины хитов',
  selfWounded: () => 'носитель ранен',
  selfCreatureType: (value) => `носитель — ${describeCreatureType(value)}`,
  selfTag: (value) => `на носителе отметка «${value}»`,
  selfTagNot: (value) => `на носителе нет отметки «${value}»`,
  rollAdvantage: () => 'атака с преимуществом',
  rollDisadvantage: () => 'атака с помехой',
  otherCreatureType: (value) =>
    `другая сторона — ${describeCreatureType(value)}`,
  otherMarkedBySelf: () => 'другая сторона помечена носителем',
  selfHpAtMost: (value) => `у носителя не больше ${value} хитов`,
  selfHpAtLeast: (value) => `у носителя не меньше ${value} хитов`,
  selfSizeAtMost: (value) =>
    `носитель размером не больше «${describeCreatureSize(value)}»`,
  selfSizeAtLeast: (value) =>
    `носитель размером не меньше «${describeCreatureSize(value)}»`,
  selfCondition: (value) =>
    `носитель в состоянии «${describeConditionName(value)}»`,
  selfConditionNot: (value) =>
    `носитель не в состоянии «${describeConditionName(value)}»`,
  selfTagCountAtLeast: (value, amount) =>
    `отметок «${value}» на носителе не меньше ${amount}`,
  selfTagFromSource: (value) => `на носителе отметка «${value}» от наложившего`,
  selfTagFromSourceNot: (value) =>
    `на носителе нет отметки «${value}» от наложившего`,
  sourceWeaponMastery: () => 'наложивший владеет приёмом оружия',
};

/**
 * Подпись размера существа.
 *
 * @param value - ключ размера
 * @returns подпись либо ключ
 */
function describeCreatureSize(value: string): string {
  return isCreatureSize(value) ? CREATURE_SIZE_LABELS[value] : value;
}

/**
 * Подпись типа существа.
 *
 * @param value - ключ типа
 * @returns подпись либо ключ
 */
function describeCreatureType(value: string): string {
  return isCreatureCategory(value) ? CREATURE_CATEGORIES[value] : value;
}

/**
 * Подпись условия срабатывания: части словаря срабатываний — фразой, остальные
 * — как у модификаторов (незнакомая часть остаётся кодом).
 *
 * @param condition - условие срабатывания
 * @returns подпись
 */
export function describeTriggerCondition(condition: string): string {
  return readTriggerConditionParts(condition)
    .map((part) =>
      typeof part === 'string'
        ? describeEffectChangeCondition(part)
        : TRIGGER_CONDITION_PHRASES[part.kind](
            part.value ?? '',
            part.amount ?? DEFAULT_TAG_COUNT_THRESHOLD,
          ),
    )
    .join(TRIGGER_LABELS.conditionJoiner);
}

/**
 * Подпись наложенного со сроком, если он задан: «„Отравлен“ на 1 раунд».
 *
 * @param name - подпись наложенного
 * @param duration - срок; без него — до снятия или срок по умолчанию
 * @returns подпись
 */
function withDurationSuffix(
  name: string,
  duration: EffectDuration | undefined,
): string {
  const suffix = duration ? describeEffectDuration(duration) : null;

  return suffix ? `${name} ${suffix}` : name;
}

/**
 * Подпись действия.
 *
 * @param action - действие
 * @param options - настройки
 * @returns подпись либо пустая строка, если описывать нечего
 */
function describeAction(
  action: EffectTriggerAction,
  options: EffectTriggerDescribeOptions,
): string {
  switch (action.type) {
    case 'damage':
      return describeEffectDamageParts(action.parts);
    case 'applySelf':
      return TRIGGER_LABELS.effect;
    case 'applyCondition': {
      const condition = withDurationSuffix(
        `«${describeConditionName(action.conditionKey)}»`,
        action.duration,
      );

      if (!action.recurringSave) {
        return condition;
      }

      const { ability, dc, timing } = action.recurringSave;

      const moment =
        timing === 'startOfTurn'
          ? TRIGGER_LABELS.startOfTurn
          : TRIGGER_LABELS.endOfTurn;

      return `${condition} (${TRIGGER_LABELS.recurringSavePrefix}${ABILITY_GENITIVE_LABELS[ability]} ${options.formatDc(dc)}${moment}${TRIGGER_LABELS.recurringSaveSuffix})`;
    }
    case 'applyTag':
      return withDurationSuffix(
        `${TRIGGER_LABELS.tagPrefix}«${action.label ?? action.tag}»${action.stack ? TRIGGER_LABELS.stackSuffix : ''}`,
        action.duration,
      );
    case 'reduceMaxHp': {
      const amount = action.amount.replaceAll(
        `@${EVENT_DAMAGE_VARIABLE}`,
        TRIGGER_LABELS.damageVariable,
      );

      const endsOnRest = action.endsOnRest ?? DEFAULT_TRIGGER_REST_TYPE;

      return `${TRIGGER_LABELS.maxHpPrefix}${amount}${endsOnRest === 'never' ? '' : REST_UNTIL_LABELS[endsOnRest]}`;
    }
    case 'setHp':
      return `${TRIGGER_LABELS.setHpPrefix}${action.value}`;
    case 'endCast':
      return TRIGGER_LABELS.endCast;
    case 'removeSelf':
      return TRIGGER_LABELS.removeSelf;
    default:
      return '';
  }
}

/**
 * Подпись действий, которые выполнятся при данном исходе спасброска.
 *
 * @param trigger - срабатывание
 * @param saved - пройден ли спасбросок
 * @param options - настройки
 * @returns перечисление либо «ничего»
 */
function describeOutcomeActions(
  trigger: EffectTrigger,
  saved: boolean,
  options: EffectTriggerDescribeOptions,
): string {
  const parts = trigger.actions.flatMap((action) => {
    const gate = resolveTriggerActionGate(trigger, action);

    if (gate === (saved ? 'failed' : 'saved')) {
      return [];
    }

    if (saved && action.type === 'damage' && action.halfOnSave) {
      return [TRIGGER_LABELS.halfDamage];
    }

    const label = describeAction(action, options);

    return label ? [label] : [];
  });

  return parts.length > 0
    ? parts.join(TRIGGER_LABELS.listJoiner)
    : TRIGGER_LABELS.nothing;
}

/**
 * Когда срабатывает.
 *
 * @param trigger - срабатывание
 * @returns подпись момента
 */
function describeMoment(trigger: EffectTrigger): string {
  if (trigger.event === 'attackRoll' && trigger.role) {
    return ATTACK_ROLE_EVENT_LABELS[trigger.role];
  }

  if (trigger.event === 'rest') {
    return REST_EVENT_LABELS[trigger.restType ?? DEFAULT_TRIGGER_REST_TYPE];
  }

  const label = TRIGGER_EVENT_LABELS[trigger.event];

  return isTurnTriggerEvent(trigger.event) && trigger.turnOf === 'source'
    ? `${label}${TRIGGER_LABELS.sourceTurnSuffix}`
    : label;
}

/**
 * Прежняя фраза срабатывания, которое выражает старое поле.
 *
 * @param trigger - срабатывание
 * @param options - настройки
 * @returns фраза, пустая строка (описывать нечего) либо `null`, если это не
 *   старое поле
 */
function describeLegacyShape(
  trigger: EffectTrigger,
  options: EffectTriggerDescribeOptions,
): string | null {
  const kind = classifyLegacyTrigger(trigger);
  const [action] = trigger.actions;

  const timing =
    trigger.event === 'turnStart'
      ? TRIGGER_LABELS.startOfTurn
      : TRIGGER_LABELS.endOfTurn;

  if (kind === 'recurringDamage' && action.type === 'damage') {
    const damage = describeEffectDamageParts(action.parts);

    if (!damage) {
      return '';
    }

    const { save } = trigger;

    const saveClause = save
      ? ` (${TRIGGER_LABELS.savePrefix}${ABILITY_GENITIVE_LABELS[save.ability]}, ${options.formatDc(save.dc)}${TRIGGER_LABELS.damageSaveSuccess}${RECURRING_DAMAGE_SUCCESS_LABELS[action.halfOnSave ? 'half' : 'negate']})`
      : '';

    return `${TRIGGER_LABELS.everyTurnPrefix}${damage}${timing}${saveClause}`;
  }

  if (kind === 'recurringSave' && trigger.save) {
    const { ability, dc } = trigger.save;

    return `${TRIGGER_LABELS.recurringSavePrefix}${ABILITY_GENITIVE_LABELS[ability]} ${options.formatDc(dc)}${timing}${TRIGGER_LABELS.recurringSaveSuffix}`;
  }

  if (kind === 'consumeOn' && trigger.role) {
    return CONSUME_ON_LABELS[trigger.role];
  }

  return null;
}

/**
 * Подпись режима спасброска.
 *
 * @param mode - режим
 * @returns продолжение фразы либо пустая строка
 */
function describeSaveMode(mode: EffectTriggerSaveMode | undefined): string {
  if (mode === 'advantage') {
    return TRIGGER_LABELS.saveModeAdvantage;
  }

  return mode === 'disadvantage' ? TRIGGER_LABELS.saveModeDisadvantage : '';
}

/**
 * Лимит «не чаще N раз за период».
 *
 * @param trigger - срабатывание
 * @returns продолжение фразы либо пустая строка
 */
function describeLimit(trigger: EffectTrigger): string {
  if (!trigger.limit) {
    return '';
  }

  const { max, per } = trigger.limit;

  const times =
    max === 1 ? TRIGGER_LABELS.limitOnce : `${max}${TRIGGER_LABELS.limitTimes}`;

  return `${TRIGGER_LABELS.limitPrefix}${times}${TRIGGER_LABELS.limitPeriodPrefix}${LIMIT_PERIOD_LABELS[per]}`;
}

/**
 * Фраза срабатывания для сводки — продолжение перечисления со строчной буквы.
 *
 * @param trigger - срабатывание
 * @param options - настройки
 * @returns фраза либо пустая строка, если описывать нечего
 */
export function describeEffectTrigger(
  trigger: EffectTrigger,
  options: EffectTriggerDescribeOptions,
): string {
  const legacy = describeLegacyShape(trigger, options);

  if (legacy !== null) {
    return legacy;
  }

  const condition = trigger.condition
    ? `${TRIGGER_LABELS.conditionPrefix}${describeTriggerCondition(trigger.condition)}`
    : '';

  const recipient = describeTriggerRecipient(trigger);

  const moment = `${describeMoment(trigger)}${condition}${recipient}`;
  const limit = describeLimit(trigger);

  if (!trigger.save) {
    return `${moment}: ${describeOutcomeActions(trigger, false, options)}${limit}`;
  }

  const { ability, dc, dcFormula, mode } = trigger.save;

  const dcLabel = dcFormula
    ? `${TRIGGER_LABELS.dcFormulaPrefix}${dcFormula.replaceAll(`@${EVENT_DAMAGE_VARIABLE}`, TRIGGER_LABELS.damageVariable)}`
    : options.formatDc(dc);

  return [
    `${moment}: ${TRIGGER_LABELS.savePrefix}${ABILITY_GENITIVE_LABELS[ability]}${describeSaveMode(mode)}, ${dcLabel}`,
    `${TRIGGER_LABELS.failurePrefix}${describeOutcomeActions(trigger, false, options)}`,
    `${TRIGGER_LABELS.successPrefix}${describeOutcomeActions(trigger, true, options)}${limit}`,
  ].join(TRIGGER_LABELS.clauseJoiner);
}
