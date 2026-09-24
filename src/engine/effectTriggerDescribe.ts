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
  EffectTempHpMode,
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerAreaShiftKind,
  EffectTriggerAreaTarget,
  EffectTriggerChoice,
  EffectTriggerEvent,
  EffectTriggerLimitPeriod,
  EffectTriggerMoveKind,
  EffectTriggerRestType,
  EffectTriggerSaveMode,
} from './effectTriggerTypes.js';
import type {
  TriggerAttackKind,
  TriggerConditionKind,
} from './triggerConditions.js';

import {
  describeConditionName,
  describeEffectChangeCondition,
  describeEffectDamageParts,
  describeEffectDuration,
} from './activeEffectDescribe.js';
import {
  ABILITY_GENITIVE_LABELS,
  ABILITY_LABELS,
  CREATURE_CATEGORIES,
  CREATURE_SIZE_LABELS,
  isAbilityType,
  isCreatureCategory,
  isCreatureSize,
} from './consts.js';
import { getShortDamageTypeLabel } from './damageConstants.js';
import {
  classifyLegacyTrigger,
  isTurnTriggerEvent,
  resolveTriggerActionGate,
  triggerEventHasPathFeet,
  triggerEventHasRestType,
} from './effectTriggers.js';
import {
  AREA_TRIGGER_RECIPIENT,
  CHOICE_TRIGGER_RECIPIENT,
  DEFAULT_CAST_OWNER,
  DEFAULT_TEMP_HP_MODE,
  DEFAULT_TRIGGER_AREA_TARGET,
  DEFAULT_TRIGGER_CHOICE_COUNT,
  DEFAULT_TRIGGER_CHOOSER,
  DEFAULT_TRIGGER_MOVE_DISTANCE,
  DEFAULT_TRIGGER_REST_TYPE,
  MAX_HP_REDUCTION_NEVER_ENDS,
  MIN_REVIVE_HP,
  SOURCE_TRIGGER_RECIPIENT,
} from './effectTriggerTypes.js';
import { EVENT_DAMAGE_VARIABLE } from './formulaParser.js';
import { MIN_SPELL_SLOT_LEVEL } from './spellSlotTable.js';
import {
  DEFAULT_TAG_COUNT_THRESHOLD,
  isTriggerAttackKind,
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
  healed: 'когда носителя лечат',
  hpZero: 'когда хиты падают до 0',
  downedOther: 'когда носитель сваливает цель',
  conditionLost: 'когда состояние снимается',
  rest: 'после отдыха',
  activate: 'при включении',
  castEnd: 'когда заклинание заканчивается',
  moved: 'когда носитель проходит путь',
};

/**
 * Шаг пути в фразе события перемещения.
 *
 * @param feet - шаг в футах
 * @returns «за каждые 5 фт пути»
 */
function describePathStep(feet: number): string {
  return `за каждые ${feet} фт пути`;
}

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
  setHpMax: 'хиты восстанавливаются полностью',
  removeConditionPrefix: 'снимается состояние ',
  removeAllConditions: 'снимаются все состояния',
  kill: 'получатель умирает',
  revivePrefix: 'получатель возвращается к жизни с ',
  reviveFull: 'получатель возвращается к жизни с полным запасом хитов',
  dropHeld: 'получатель роняет то, что держит',
  restoreSlotPrefix: 'возвращается ячейка круга ',
  restoreCounterPrefix: 'возвращается ресурс ',
  dispelPrefix: 'рассеиваются заклинания до круга ',
  grantInspiration: 'получатель получает вдохновение',
  moveSuffix: ' фт',
  endRecipientCast: 'каст получателя заканчивается',
  notifyPrefix: 'сообщение ',
  nextStage: 'эффект переходит на следующую ступень',
  actionJoiner: ', ',
  endCast: 'каст заканчивается',
  dcFormulaPrefix: 'Сл = ',
  damageVariable: 'урон',
  recipientOther: ', на другую сторону',
  recipientSource: ', на наложившего',
  endsOnExitSuffix: ' до выхода из зоны',
  recipientAreaPrefix: ', на ',
  recipientAreaSuffix: ' фт вокруг',
  recipientChoicePrefix: ', на ',
  recipientChoiceTargetPrefix: ' из ',
  recipientChoiceSuffix: ' фт вокруг по выбору',
  recipientChoiceChooser: ' наложившего',
  recipientChoiceOptional: ' (можно отказаться)',
  recipientChoiceConditionPrefix: ', только ',
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

/** Как двигает действие «Переместить» — в фразе */
const MOVE_KIND_PHRASES: Record<EffectTriggerMoveKind, string> = {
  push: 'отталкивает на ',
  pull: 'притягивает на ',
  teleport: 'переносит на ',
};

/** Как сдвигается зона — в фразе */
const AREA_SHIFT_PHRASES: Record<EffectTriggerAreaShiftKind, string> = {
  away: 'сдвигает зону от получателя на ',
  toward: 'сдвигает зону к получателю на ',
  follow: 'зона идёт за носителем',
};

/** Что делает действие с временными хитами — в фразе */
const TEMP_HP_PHRASES: Record<EffectTempHpMode, string> = {
  set: 'временные хиты ',
  add: 'временные хиты +',
  spend: 'временные хиты −',
};

/** Кого задевает «всем в радиусе» — в фразе */
const AREA_TARGET_PHRASES: Record<EffectTriggerAreaTarget, string> = {
  all: 'всех',
  allies: 'союзников',
  enemies: 'врагов',
  allWithSelf: 'всех и себя',
  alliesWithSelf: 'союзников и себя',
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

  if (trigger.recipient === SOURCE_TRIGGER_RECIPIENT) {
    return TRIGGER_LABELS.recipientSource;
  }

  if (trigger.recipient === CHOICE_TRIGGER_RECIPIENT && trigger.choice) {
    return describeTriggerChoice(trigger.choice);
  }

  if (trigger.recipient !== AREA_TRIGGER_RECIPIENT || !trigger.area) {
    return '';
  }

  const target =
    AREA_TARGET_PHRASES[trigger.area.target ?? DEFAULT_TRIGGER_AREA_TARGET];

  return `${TRIGGER_LABELS.recipientAreaPrefix}${target} в ${trigger.area.radius}${TRIGGER_LABELS.recipientAreaSuffix}`;
}

/**
 * Получатель «по выбору» — часть фразы: «, на 1 из союзников в 30 фт вокруг по
 * выбору наложившего».
 *
 * @param choice - блок «по выбору»
 * @returns часть фразы
 */
function describeTriggerChoice(choice: EffectTriggerChoice): string {
  const {
    recipientChoicePrefix,
    recipientChoiceTargetPrefix,
    recipientChoiceSuffix,
    recipientChoiceChooser,
    recipientChoiceOptional,
    recipientChoiceConditionPrefix,
  } = TRIGGER_LABELS;

  const count = choice.count ?? DEFAULT_TRIGGER_CHOICE_COUNT;

  const target =
    AREA_TARGET_PHRASES[choice.target ?? DEFAULT_TRIGGER_AREA_TARGET];

  const chooser =
    (choice.chooser ?? DEFAULT_TRIGGER_CHOOSER) === 'source'
      ? recipientChoiceChooser
      : '';

  const condition = choice.condition
    ? `${recipientChoiceConditionPrefix}${describeTriggerCondition(choice.condition)}`
    : '';

  return [
    recipientChoicePrefix,
    count,
    recipientChoiceTargetPrefix,
    target,
    ' в ',
    choice.radius,
    recipientChoiceSuffix,
    chooser,
    condition,
    choice.optional ? recipientChoiceOptional : '',
  ].join('');
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
  selfTempHpZero: () => 'у носителя нет временных хитов',
  selfGrounded: () => 'носитель не летит',
  selfSpecies: (value) => `вид носителя — «${value}»`,
  selfAbilityAtMost: (value, amount) =>
    `${describeAbilityName(value)} носителя не больше ${amount}`,
  selfAbilityAtLeast: (value, amount) =>
    `${describeAbilityName(value)} носителя не меньше ${amount}`,
  otherIsSource: () => 'другая сторона — тот, кто наложил эффект',
  otherBloodied: () => 'у другой стороны не больше половины хитов',
  otherHpAtMost: (value) => `у другой стороны не больше ${value} хитов`,
  damageAtLeast: (value) => `урон не меньше ${value}`,
  sourceWithin: (value) => `наложивший в пределах ${value} фт`,
  attackKind: (value) => `атака ${describeAttackKind(value)}`,
  attackAbility: (value) =>
    `атака считается характеристикой «${describeAbilityName(value)}»`,
  attackLanded: () => 'атака попала',
  attackMissed: () => 'атака промахнулась',
  combatRoundIs: (value) => `на ${value}-м раунде боя`,
  combatRoundAtLeast: (value) => `с ${value}-го раунда боя`,
  movementOwn: () => 'носитель шёл сам',
  movementForced: () => 'носителя переставили толчком или переносом',
};

/**
 * Подписи видов атаки в фразе условия. Окно показывает их же с заглавной
 * буквы — таблица одна
 */
export const TRIGGER_ATTACK_KIND_PHRASES: Record<TriggerAttackKind, string> = {
  melee: 'рукопашная',
  ranged: 'дальнобойная',
  weapon: 'оружием',
  spell: 'заклинанием',
  unarmed: 'безоружная',
};

/**
 * Подпись вида атаки.
 *
 * @param value - ключ вида
 * @returns подпись либо ключ
 */
function describeAttackKind(value: string): string {
  return isTriggerAttackKind(value)
    ? TRIGGER_ATTACK_KIND_PHRASES[value]
    : value;
}

/**
 * Подпись характеристики.
 *
 * @param value - ключ характеристики
 * @returns подпись либо ключ
 */
function describeAbilityName(value: string): string {
  return isAbilityType(value) ? ABILITY_LABELS[value] : value;
}

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
      const named = `«${describeConditionName(action.conditionKey)}»`;

      const condition = action.endsOnExit
        ? `${named}${TRIGGER_LABELS.endsOnExitSuffix}`
        : withDurationSuffix(named, action.duration);

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

      return `${TRIGGER_LABELS.maxHpPrefix}${amount}${endsOnRest === MAX_HP_REDUCTION_NEVER_ENDS ? '' : REST_UNTIL_LABELS[endsOnRest]}`;
    }
    case 'setHp':
      return action.toMax
        ? TRIGGER_LABELS.setHpMax
        : `${TRIGGER_LABELS.setHpPrefix}${action.value}`;
    case 'tempHp':
      return `${TEMP_HP_PHRASES[action.mode ?? DEFAULT_TEMP_HP_MODE]}${action.amount}`;
    case 'removeCondition':
      return action.conditionKey
        ? `${TRIGGER_LABELS.removeConditionPrefix}«${describeConditionName(action.conditionKey)}»`
        : TRIGGER_LABELS.removeAllConditions;
    case 'kill':
      return TRIGGER_LABELS.kill;
    case 'revive':
      return action.full
        ? TRIGGER_LABELS.reviveFull
        : `${TRIGGER_LABELS.revivePrefix}${action.hp ?? MIN_REVIVE_HP}`;
    case 'dropHeld':
      return TRIGGER_LABELS.dropHeld;
    case 'restore':
      return action.what === 'spellSlot'
        ? `${TRIGGER_LABELS.restoreSlotPrefix}${action.level ?? MIN_SPELL_SLOT_LEVEL}`
        : `${TRIGGER_LABELS.restoreCounterPrefix}«${action.counter ?? ''}»`;
    case 'dispel':
      return `${TRIGGER_LABELS.dispelPrefix}${action.maxLevel}`;
    case 'grantInspiration':
      return TRIGGER_LABELS.grantInspiration;
    case 'move':
      return `${MOVE_KIND_PHRASES[action.kind]}${action.distance}${TRIGGER_LABELS.moveSuffix}`;
    case 'moveArea':
      return action.kind === 'follow'
        ? AREA_SHIFT_PHRASES.follow
        : `${AREA_SHIFT_PHRASES[action.kind]}${action.distance ?? DEFAULT_TRIGGER_MOVE_DISTANCE}${TRIGGER_LABELS.moveSuffix}`;
    case 'notify':
      return `${TRIGGER_LABELS.notifyPrefix}«${action.text}»`;
    case 'nextStage':
      return TRIGGER_LABELS.nextStage;
    case 'endCast':
      return (action.whose ?? DEFAULT_CAST_OWNER) === 'recipient'
        ? TRIGGER_LABELS.endRecipientCast
        : TRIGGER_LABELS.endCast;
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

  if (triggerEventHasRestType(trigger.event)) {
    return REST_EVENT_LABELS[trigger.restType ?? DEFAULT_TRIGGER_REST_TYPE];
  }

  if (triggerEventHasPathFeet(trigger.event) && trigger.everyFeet) {
    return describePathStep(trigger.everyFeet);
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

/**
 * Короткая сводка действий срабатывания — для вопроса человеку: «что будет,
 * если согласиться».
 *
 * Отличается от {@link describeEffectTrigger} тем, что не разбирает момент,
 * условие и спасбросок: в окне вопроса важно только, что случится.
 *
 * @param trigger - срабатывание
 * @returns перечисление действий; пустая строка, если описывать нечего
 */
export function describeTriggerActions(trigger: EffectTrigger): string {
  return trigger.actions
    .map((action) => describeAction(action, { formatDc: (dc) => String(dc) }))
    .filter((text) => text.length > 0)
    .join(TRIGGER_LABELS.actionJoiner);
}
