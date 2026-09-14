/**
 * Варианты выбора для шагов окна эффекта: подписи зависят от места окна и
 * текущей раскладки, поэтому собираются функциями, а не лежат константами.
 */

import type {
  AreaEffectTrigger,
  EffectAttackTrigger,
  EffectAura,
  EffectDelivery,
  EffectDuration,
  EffectDurationType,
  EffectFormContext,
  EffectFormLayout,
  EffectSaveOutcome,
  EffectSaveTiming,
  EffectSuccessOutcome,
  EffectTurnAnchor,
  EffectTurnTiming,
} from '@vtt/shared/system/dnd.js';

import {
  EFFECT_DURATION_LABELS,
  EFFECT_TURN_ANCHOR_LABELS,
  EFFECT_TURN_TIMING_LABELS,
} from '@vtt/shared/system/dnd.js';

import {
  AURA_TRIGGER_LABELS,
  EFFECT_ACTION_SAVE_OUTCOME_OPTIONS,
  EFFECT_AURA_LABELS,
  EFFECT_CARRIER_DELIVERY_LABELS,
  EFFECT_CONSUME_ON_NONE,
  EFFECT_CONSUME_ON_OPTIONS,
  EFFECT_DELIVERY_ICONS,
  EFFECT_DELIVERY_LABELS,
  EFFECT_DURATION_STEP_LABELS,
  EFFECT_RECURRING_DAMAGE_SUCCESS_LABELS,
  EFFECT_SUCCESS_OUTCOME_OPTIONS,
  EFFECT_TARGET_DELIVERY_LABELS,
  EFFECT_TURN_MOMENT_LABELS,
  ZONE_TRIGGER_LABELS,
} from './constants';

/** Моменты срабатывания зоны и ауры в порядке показа */
const EFFECT_TRIGGER_ORDER: readonly AreaEffectTrigger[] = [
  'stay',
  'enter',
  'exit',
];

/** Типы длительности в порядке показа: от частых к редким */
const EFFECT_DURATION_TYPE_ORDER: readonly EffectDurationType[] = [
  'permanent',
  'rounds',
  'turn',
  'minutes',
  'hours',
  'days',
  'special',
];

/** Моменты хода точной длительности в порядке показа */
const EFFECT_TURN_TIMING_ORDER: readonly EffectTurnTiming[] = ['end', 'start'];

/** Якоря хода точной длительности в порядке показа */
const EFFECT_TURN_ANCHOR_ORDER: readonly EffectTurnAnchor[] = [
  'carrier',
  'source',
];

/** Моменты хода урона и повторного спасброска в порядке показа */
const EFFECT_SAVE_TIMING_ORDER: readonly EffectSaveTiming[] = [
  'startOfTurn',
  'endOfTurn',
];

/** Длительности, у которых есть число единиц */
const COUNTED_DURATION_TYPES: ReadonlySet<EffectDurationType> = new Set([
  'rounds',
  'minutes',
  'hours',
  'days',
]);

/** Вариант сегментного переключателя */
export interface EffectSegmentOption<Value extends string> {
  /** Значение варианта */
  value: Value;
  /** Подпись */
  label: string;
  /** Иконка */
  icon?: string;
}

/** Вариант выбора с пояснением */
export interface EffectDescribedOption<Value extends string> {
  /** Значение варианта */
  value: Value;
  /** Подпись */
  label: string;
  /** Пояснение под подписью */
  description: string;
}

/**
 * Подпись доставки в месте окна.
 *
 * @param delivery - доставка
 * @param context - место окна
 * @returns подпись
 */
function deliveryLabel(
  delivery: EffectDelivery,
  context: EffectFormContext,
): string {
  switch (delivery) {
    case 'carrier':
      return EFFECT_CARRIER_DELIVERY_LABELS[context];
    case 'target':
      return EFFECT_TARGET_DELIVERY_LABELS[context];
    case 'aura':
      return EFFECT_DELIVERY_LABELS.aura;
    case 'zone':
    default:
      return EFFECT_DELIVERY_LABELS.zone;
  }
}

/**
 * Варианты «на кого» для места окна.
 *
 * @param layout - раскладка окна
 * @returns варианты в порядке раскладки
 */
export function buildDeliveryOptions(
  layout: EffectFormLayout,
): EffectSegmentOption<EffectDelivery>[] {
  return layout.deliveryOptions.map((delivery) => ({
    value: delivery,
    label: deliveryLabel(delivery, layout.context),
    icon: EFFECT_DELIVERY_ICONS[delivery],
  }));
}

/**
 * Варианты момента срабатывания: у зоны и ауры подписи свои.
 *
 * @param delivery - доставка
 * @returns варианты
 */
export function buildTriggerOptions(
  delivery: EffectDelivery,
): EffectSegmentOption<AreaEffectTrigger>[] {
  const labels =
    delivery === 'aura' ? AURA_TRIGGER_LABELS : ZONE_TRIGGER_LABELS;

  return EFFECT_TRIGGER_ORDER.map((trigger) => ({
    value: trigger,
    label: labels[trigger],
  }));
}

/**
 * Сужает значение переключателя до момента срабатывания.
 *
 * @param value - значение из переключателя
 * @returns момент либо `undefined` для чужого значения
 */
export function findTrigger(
  value: string | number,
): AreaEffectTrigger | undefined {
  return EFFECT_TRIGGER_ORDER.find((trigger) => trigger === value);
}

/**
 * Варианты «при успехе» для раскладки.
 *
 * @param layout - раскладка окна
 * @returns варианты с пояснениями
 */
export function buildSuccessOutcomeOptions(
  layout: EffectFormLayout,
): EffectDescribedOption<EffectSuccessOutcome>[] {
  const options = layout.successOutcomeForActionSave
    ? EFFECT_ACTION_SAVE_OUTCOME_OPTIONS
    : EFFECT_SUCCESS_OUTCOME_OPTIONS;

  return layout.successOutcomes.map((outcome) => ({
    value: outcome,
    ...options[outcome],
  }));
}

/**
 * Сужает значение переключателя «снять после атаки».
 *
 * @param value - значение из переключателя
 * @returns триггер атаки либо `undefined` — «не снимать»
 */
export function findConsumeOn(
  value: string | number,
): EffectAttackTrigger | undefined {
  return EFFECT_CONSUME_ON_OPTIONS.map((option) => option.value).find(
    (option): option is EffectAttackTrigger =>
      option !== EFFECT_CONSUME_ON_NONE && option === value,
  );
}

/**
 * Есть ли у длительности число единиц.
 *
 * @param type - тип длительности
 * @returns `true` для раундов, минут, часов и дней
 */
export function isCountedDuration(type: EffectDurationType): boolean {
  return COUNTED_DURATION_TYPES.has(type);
}

/**
 * Пояснение под выбором длительности.
 *
 * @param type - тип длительности
 * @returns пояснение
 */
export function durationHint(type: EffectDurationType): string {
  switch (type) {
    case 'permanent':
      return EFFECT_DURATION_STEP_LABELS.permanentHint;
    case 'rounds':
      return EFFECT_DURATION_STEP_LABELS.roundsHint;
    case 'turn':
      return EFFECT_DURATION_STEP_LABELS.turnHint;
    case 'special':
      return EFFECT_DURATION_STEP_LABELS.specialHint;
    default:
      return EFFECT_DURATION_STEP_LABELS.timeHint;
  }
}

/** Варианты типа длительности */
export const EFFECT_DURATION_TYPE_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectDurationType>
> = EFFECT_DURATION_TYPE_ORDER.map((type) => ({
  value: type,
  label: EFFECT_DURATION_LABELS[type],
}));

/** Варианты момента хода точной длительности */
export const EFFECT_TURN_TIMING_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTurnTiming>
> = EFFECT_TURN_TIMING_ORDER.map((timing) => ({
  value: timing,
  label: EFFECT_TURN_TIMING_LABELS[timing],
}));

/** Варианты якоря хода точной длительности */
export const EFFECT_TURN_ANCHOR_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTurnAnchor>
> = EFFECT_TURN_ANCHOR_ORDER.map((anchor) => ({
  value: anchor,
  label: EFFECT_TURN_ANCHOR_LABELS[anchor],
}));

/**
 * Меняет тип длительности. Число единиц переносится между раундами, минутами,
 * часами и днями; момент и якорь хода нужны только точной длительности.
 *
 * @param duration - длительность
 * @param type - новый тип
 * @returns новая длительность
 */
export function writeDurationType(
  duration: EffectDuration,
  type: EffectDurationType,
): EffectDuration {
  return {
    type,
    value: isCountedDuration(type) ? duration.value : undefined,
    turnAnchor: type === 'turn' ? duration.turnAnchor : undefined,
    turnTiming: type === 'turn' ? duration.turnTiming : undefined,
  };
}

/** Варианты момента хода для урона и повторного спасброска */
export const EFFECT_SAVE_TIMING_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectSaveTiming>
> = EFFECT_SAVE_TIMING_ORDER.map((timing) => ({
  value: timing,
  label: EFFECT_TURN_MOMENT_LABELS[timing],
}));

/** Варианты «если спасбросок против урона каждый ход успешен» */
export const EFFECT_RECURRING_DAMAGE_SUCCESS_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectSaveOutcome>
> = [
  { value: 'negate', label: EFFECT_RECURRING_DAMAGE_SUCCESS_LABELS.negate },
  { value: 'half', label: EFFECT_RECURRING_DAMAGE_SUCCESS_LABELS.half },
];

/** Варианты «кого задевает аура» */
export const EFFECT_AURA_TARGET_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectAura['target']>
> = [
  { value: 'allies', label: EFFECT_AURA_LABELS.targetAllies },
  { value: 'enemies', label: EFFECT_AURA_LABELS.targetEnemies },
  { value: 'all', label: EFFECT_AURA_LABELS.targetAll },
];
