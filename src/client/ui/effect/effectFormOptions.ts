/**
 * Варианты выбора для шагов окна эффекта: подписи зависят от места окна и
 * текущей раскладки, поэтому собираются функциями, а не лежат константами.
 */

import type { SkillType } from '@vtt/shared';
import type {
  AreaEffectTrigger,
  ConditionRef,
  EffectActionCost,
  EffectAura,
  EffectCastOwner,
  EffectChangeStepPeriod,
  EffectDelivery,
  EffectDuration,
  EffectDurationType,
  EffectEscapeActor,
  EffectEscapeOutcome,
  EffectFormContext,
  EffectFormLayout,
  EffectNotifyTarget,
  EffectRestoreKind,
  EffectSaveTiming,
  EffectSuccessOutcome,
  EffectTempHpMode,
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerActionGate,
  EffectTriggerActionType,
  EffectTriggerAreaShiftKind,
  EffectTriggerAreaTarget,
  EffectTriggerAttackRole,
  EffectTriggerChooser,
  EffectTriggerEvent,
  EffectTriggerLimitPeriod,
  EffectTriggerMaxHpRestEnd,
  EffectTriggerMoveKind,
  EffectTriggerMoveOrigin,
  EffectTriggerRecipient,
  EffectTriggerRestType,
  EffectTriggerSaveMode,
  EffectTurnAnchor,
  EffectTurnTiming,
  EffectVariantPick,
  TriggerAttackKind,
} from '@vtt/shared/system/dnd.js';

import type { EffectActivationChoice, SaveDcFieldMode } from './constants';

import { typedObjectEntries } from '@vtt/shared';
import {
  capitalize,
  DEFAULT_EFFECT_TAG,
  DEFAULT_RESTORE_KIND,
  DEFAULT_SET_HP_VALUE,
  DEFAULT_TRIGGER_AREA_SHIFT_KIND,
  DEFAULT_TRIGGER_ATTACK_ROLE,
  DEFAULT_TRIGGER_MOVE_DISTANCE,
  DEFAULT_TRIGGER_MOVE_KIND,
  EFFECT_ACTION_COST_LABELS,
  EFFECT_ACTION_COSTS,
  EFFECT_CAST_OWNERS,
  EFFECT_CHANGE_STEP_PERIODS,
  EFFECT_DURATION_LABELS,
  EFFECT_ESCAPE_ACTOR_LABELS,
  EFFECT_ESCAPE_ACTORS,
  EFFECT_ESCAPE_OUTCOME_LABELS,
  EFFECT_ESCAPE_OUTCOMES,
  EFFECT_NOTIFY_TARGETS,
  EFFECT_RESTORE_KINDS,
  EFFECT_SAVE_TIMINGS,
  EFFECT_TEMP_HP_MODES,
  EFFECT_TRIGGER_ACTION_GATES,
  EFFECT_TRIGGER_AREA_SHIFT_KINDS,
  EFFECT_TRIGGER_ATTACK_ROLES,
  EFFECT_TRIGGER_CHOOSERS,
  EFFECT_TRIGGER_LIMIT_PERIODS,
  EFFECT_TRIGGER_MAX_HP_REST_ENDS,
  EFFECT_TRIGGER_MOVE_KINDS,
  EFFECT_TRIGGER_MOVE_ORIGINS,
  EFFECT_TRIGGER_RECIPIENTS,
  EFFECT_TRIGGER_REST_TYPES,
  EFFECT_TRIGGER_SAVE_MODES,
  EFFECT_TURN_ANCHOR_LABELS,
  EFFECT_TURN_TIMING_LABELS,
  EFFECT_VARIANT_PICKS,
  listSelectableConditions,
  MIN_REVIVE_HP,
  MIN_SPELL_SLOT_LEVEL,
  PATH_AREA_SHIFT_KINDS,
  SKILLS_LABELS,
  TRIGGER_ATTACK_KIND_PHRASES,
  TRIGGER_ATTACK_KINDS,
  triggerEventAcceptsArea,
  triggerEventAcceptsChoice,
  triggerEventAcceptsSource,
  triggerEventHasOtherParty,
  triggerEventHasPathFeet,
  triggerEventHasRole,
} from '@vtt/shared/system/dnd.js';

import {
  AURA_TRIGGER_LABELS,
  EFFECT_ACTION_SAVE_OUTCOME_OPTIONS,
  EFFECT_ACTIVATION_CHOICE_LABELS,
  EFFECT_AURA_LABELS,
  EFFECT_CARRIER_DELIVERY_LABELS,
  EFFECT_CHANGE_STEP_PER_LABELS,
  EFFECT_DELIVERY_HINTS,
  EFFECT_DELIVERY_ICONS,
  EFFECT_DELIVERY_LABELS,
  EFFECT_DURATION_STEP_LABELS,
  EFFECT_PERMANENT_ACTIVATION,
  EFFECT_SPELL_ZONE_DELIVERY_HINT,
  EFFECT_SUCCESS_OUTCOME_OPTIONS,
  EFFECT_TARGET_DELIVERY_LABELS,
  EFFECT_USE_DELIVERY_HINTS,
  EFFECT_USE_DELIVERY_LABELS,
  EFFECT_VARIANT_PICK_LABELS,
  SAVE_DC_FIELD_MODE_LABELS,
  ZONE_TRIGGER_LABELS,
} from './constants';
import {
  DEFAULT_MAX_HP_REDUCTION,
  EFFECT_CAST_OWNER_LABELS,
  EFFECT_NOTIFY_TARGET_LABELS,
  EFFECT_RESTORE_KIND_LABELS,
  EFFECT_SAVE_TIMING_LABELS,
  EFFECT_TEMP_HP_MODE_LABELS,
  EFFECT_TRIGGER_APPLIED_OTHER_PARTY_LABEL,
  EFFECT_TRIGGER_AREA_LABELS,
  EFFECT_TRIGGER_AREA_SHIFT_KIND_LABELS,
  EFFECT_TRIGGER_ATTACK_OTHER_PARTY_LABELS,
  EFFECT_TRIGGER_CHOOSER_LABELS,
  EFFECT_TRIGGER_DAMAGE_HALF_GATE,
  EFFECT_TRIGGER_DAMAGE_HALF_LABEL,
  EFFECT_TRIGGER_GATE_LABELS,
  EFFECT_TRIGGER_MAX_HP_REST_LABELS,
  EFFECT_TRIGGER_MOVE_KIND_LABELS,
  EFFECT_TRIGGER_MOVE_ORIGIN_LABELS,
  EFFECT_TRIGGER_NORMAL_SAVE_MODE,
  EFFECT_TRIGGER_PERIOD_LABELS,
  EFFECT_TRIGGER_RECIPIENT_LABELS,
  EFFECT_TRIGGER_REST_LABELS,
  EFFECT_TRIGGER_ROLE_LABELS,
  EFFECT_TRIGGER_SAVE_MODE_LABELS,
} from './triggerLabels';

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
 * @param useActivated - эффект накладывается применением
 * @returns подпись
 */
function deliveryLabel(
  delivery: EffectDelivery,
  context: EffectFormContext,
  useActivated: boolean,
): string {
  switch (delivery) {
    case 'carrier':
      return useActivated
        ? EFFECT_USE_DELIVERY_LABELS.carrier
        : EFFECT_CARRIER_DELIVERY_LABELS[context];
    case 'target':
      return useActivated
        ? EFFECT_USE_DELIVERY_LABELS.target
        : EFFECT_TARGET_DELIVERY_LABELS[context];
    case 'aura':
      return EFFECT_DELIVERY_LABELS.aura;
    case 'zone':
    default:
      return context === 'spell'
        ? EFFECT_DELIVERY_LABELS.spellZone
        : EFFECT_DELIVERY_LABELS.zone;
  }
}

/** Пункт выпадающего списка окна */
export interface EffectSelectItem {
  /** Подпись */
  label: string;
  /** Значение */
  value: string;
}

/**
 * Состояния для выбора: канон и заведённые в мире — список меняется, пока окно
 * открыто, поэтому его зовут из `computed`.
 *
 * @returns пункты состояний
 */
export function buildConditionItems(): EffectSelectItem[] {
  return listSelectableConditions().map((condition) => ({
    label: condition.nameRu,
    value: condition.key,
  }));
}

/**
 * Ключ пункта «любое / все состояния»: в данных это отсутствие ключа
 * состояния, а у списка выбора пустого значения нет.
 */
export const ANY_CONDITION_KEY = '';

/**
 * Состояния для выбора с пунктом «любое / все» первым.
 *
 * @param anyLabel - подпись пункта без состояния
 * @returns пункты состояний
 */
export function buildConditionItemsWithAny(
  anyLabel: string,
): EffectSelectItem[] {
  return [
    { label: anyLabel, value: ANY_CONDITION_KEY },
    ...buildConditionItems(),
  ];
}

/**
 * Типы урона для выбора.
 *
 * @param damageTypes - типы урона справочника системы
 * @returns пункты типов урона
 */
export function buildDamageTypeItems(
  damageTypes: ReadonlyArray<{ key: string; name: string }>,
): EffectSelectItem[] {
  return damageTypes.map((damageType) => ({
    label: damageType.name,
    value: damageType.key,
  }));
}

/**
 * Пояснение под выбором доставки: у зоны заклинания и у применяемого эффекта
 * свои.
 *
 * @param layout - раскладка окна
 * @returns пояснение
 */
export function describeDeliveryHint(layout: EffectFormLayout): string {
  if (layout.delivery === 'zone' && layout.context === 'spell') {
    return EFFECT_SPELL_ZONE_DELIVERY_HINT;
  }

  if (
    layout.useActivated
    && (layout.delivery === 'carrier' || layout.delivery === 'target')
  ) {
    return EFFECT_USE_DELIVERY_HINTS[layout.delivery];
  }

  return EFFECT_DELIVERY_HINTS[layout.delivery];
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
    label: deliveryLabel(delivery, layout.context, layout.useActivated),
    icon: EFFECT_DELIVERY_ICONS[delivery],
  }));
}

/**
 * Варианты выбора «Действует» для места окна: «Постоянно» и способы
 * применения, которые здесь работают.
 *
 * @param layout - раскладка окна
 * @returns варианты; пусто — выбора нет
 */
export function buildActivationOptions(
  layout: EffectFormLayout,
): EffectSegmentOption<EffectActivationChoice>[] {
  if (layout.activationModes.length === 0) {
    return [];
  }

  const choices: EffectActivationChoice[] = [
    EFFECT_PERMANENT_ACTIVATION,
    ...layout.activationModes,
  ];

  return choices.map((choice) => ({
    value: choice,
    label: EFFECT_ACTIVATION_CHOICE_LABELS[choice],
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

/** Варианты периода шага строки модификатора */
export const EFFECT_CHANGE_STEP_PER_OPTIONS: ReadonlyArray<{
  value: EffectChangeStepPeriod;
  label: string;
}> = EFFECT_CHANGE_STEP_PERIODS.map((period) => ({
  value: period,
  label: EFFECT_CHANGE_STEP_PER_LABELS[period],
}));

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

/** Варианты «кого задевает аура» */
export const EFFECT_AURA_TARGET_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectAura['target']>
> = [
  { value: 'allies', label: EFFECT_AURA_LABELS.targetAllies },
  { value: 'enemies', label: EFFECT_AURA_LABELS.targetEnemies },
  { value: 'all', label: EFFECT_AURA_LABELS.targetAll },
];

/**
 * Кого задевает «всем в радиусе» и отбор кандидатов выбора. Отдельный список
 * от ауры: у срабатывания есть ещё «и носителя» — соседей по сцене ядро отдаёт
 * без субъекта, и добавить его может только система.
 */
export const EFFECT_TRIGGER_AREA_TARGET_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerAreaTarget>
> = [
  { value: 'allies', label: EFFECT_AURA_LABELS.targetAllies },
  { value: 'enemies', label: EFFECT_AURA_LABELS.targetEnemies },
  { value: 'all', label: EFFECT_AURA_LABELS.targetAll },
  { value: 'alliesWithSelf', label: EFFECT_TRIGGER_AREA_LABELS.alliesWithSelf },
  { value: 'allWithSelf', label: EFFECT_TRIGGER_AREA_LABELS.allWithSelf },
];

/** Режимы поля Сл: Сл источника или своё число */
export const SAVE_DC_FIELD_MODE_OPTIONS: ReadonlyArray<
  EffectSegmentOption<SaveDcFieldMode>
> = [
  { value: 'auto', label: SAVE_DC_FIELD_MODE_LABELS.auto },
  { value: 'manual', label: SAVE_DC_FIELD_MODE_LABELS.manual },
];

/** Разделитель источника Сл и её числа в режиме «Авто» («Сл заклинателя · 15») */
export const SAVE_DC_AUTO_SEPARATOR = ' · ';

/** Сколько временных хитов у нового действия */
export const DEFAULT_TRIGGER_TEMP_HP = '5';

/** До какого круга рассеивает новое действие «Рассеять» */
export const DEFAULT_DISPEL_MAX_LEVEL = 3;

/** Текст нового действия «Сообщить», пока автор не написал свой */
export const DEFAULT_TRIGGER_NOTIFY_TEXT = 'Напоминание';

/** Состояние нового действия «Наложить состояние» */
export const DEFAULT_TRIGGER_CONDITION: ConditionRef = 'poisoned';

/**
 * Новое действие срабатывания выбранного вида: пустая заготовка, которую автор
 * дозаполняет. Одна на строку срабатывания и на вложенное срабатывание
 * состояния.
 *
 * @param type - вид действия
 * @returns действие
 */
export function createTriggerAction(
  type: EffectTriggerActionType,
): EffectTriggerAction {
  switch (type) {
    case 'damage':
      return { type, parts: [] };
    case 'applyCondition':
      return { type, conditionKey: DEFAULT_TRIGGER_CONDITION };
    case 'applyTag':
      return { type, tag: DEFAULT_EFFECT_TAG };
    case 'setHp':
      return { type, value: DEFAULT_SET_HP_VALUE };
    case 'reduceMaxHp':
      return { type, amount: DEFAULT_MAX_HP_REDUCTION };
    case 'notify':
      return { type, text: DEFAULT_TRIGGER_NOTIFY_TEXT };
    case 'tempHp':
      return { type, amount: DEFAULT_TRIGGER_TEMP_HP };
    case 'removeCondition':
      return { type, conditionKey: DEFAULT_TRIGGER_CONDITION };
    case 'revive':
      return { type, hp: MIN_REVIVE_HP };
    case 'restore':
      return { type, what: DEFAULT_RESTORE_KIND, level: MIN_SPELL_SLOT_LEVEL };
    case 'dispel':
      return { type, maxLevel: DEFAULT_DISPEL_MAX_LEVEL };
    case 'move':
      return {
        type,
        kind: DEFAULT_TRIGGER_MOVE_KIND,
        distance: DEFAULT_TRIGGER_MOVE_DISTANCE,
      };
    case 'moveArea':
      return {
        type,
        kind: DEFAULT_TRIGGER_AREA_SHIFT_KIND,
        distance: DEFAULT_TRIGGER_MOVE_DISTANCE,
      };
    case 'nextStage':
      return { type };
    case 'applySelf':
      return { type };
    case 'endCast':
      return { type };
    case 'kill':
      return { type };
    case 'dropHeld':
      return { type };
    case 'grantInspiration':
      return { type };
    default:
      return { type };
  }
}

/** Период нового лимита «не чаще N раз» */
export const DEFAULT_TRIGGER_LIMIT_PERIOD: EffectTriggerLimitPeriod = 'turn';

/** Исход урона в строке срабатывания: гейт либо «успех — половина» */
export type EffectTriggerDamageGateChoice =
  EffectTriggerActionGate | typeof EFFECT_TRIGGER_DAMAGE_HALF_GATE;

/** Варианты роли субъекта в броске атаки */
export const EFFECT_TRIGGER_ROLE_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerAttackRole>
> = EFFECT_TRIGGER_ATTACK_ROLES.map((attackRole) => ({
  value: attackRole,
  label: EFFECT_TRIGGER_ROLE_LABELS[attackRole],
}));

/**
 * Подпись «другой стороны» по событию: у урона — кто его нанёс, у броска атаки
 * — цель или атакующий, при наложении — кто наложил.
 *
 * @param trigger - событие и роль строки
 * @returns подпись
 */
function resolveOtherPartyLabel(
  trigger: Pick<EffectTrigger, 'event' | 'role'>,
): string {
  if (triggerEventHasRole(trigger.event)) {
    return EFFECT_TRIGGER_ATTACK_OTHER_PARTY_LABELS[
      trigger.role ?? DEFAULT_TRIGGER_ATTACK_ROLE
    ];
  }

  return trigger.event === 'applied'
    ? EFFECT_TRIGGER_APPLIED_OTHER_PARTY_LABEL
    : EFFECT_TRIGGER_RECIPIENT_LABELS.other;
}

/** Чем платят за срабатывание */
export const EFFECT_ACTION_COST_OPTIONS: EffectSegmentOption<EffectActionCost>[] =
  EFFECT_ACTION_COSTS.map((cost) => ({
    value: cost,
    label: EFFECT_ACTION_COST_LABELS[cost],
  }));

/** Кому адресовано сообщение срабатывания */
export const EFFECT_NOTIFY_TARGET_OPTIONS: EffectSegmentOption<EffectNotifyTarget>[] =
  EFFECT_NOTIFY_TARGETS.map((target) => ({
    value: target,
    label: EFFECT_NOTIFY_TARGET_LABELS[target],
  }));

/** Как двигает действие «Переместить» */
export const EFFECT_TRIGGER_MOVE_KIND_OPTIONS: EffectSegmentOption<EffectTriggerMoveKind>[] =
  EFFECT_TRIGGER_MOVE_KINDS.map((kind) => ({
    value: kind,
    label: EFFECT_TRIGGER_MOVE_KIND_LABELS[kind],
  }));

/**
 * Как сдвигается зона. «За носителем» — только на событии пути: смещение
 * берётся у фишки носителя, на других событиях его нет.
 *
 * @param event - событие срабатывания
 * @returns виды сдвига для события
 */
export function buildAreaShiftKindOptions(
  event: EffectTriggerEvent | undefined,
): EffectSegmentOption<EffectTriggerAreaShiftKind>[] {
  return EFFECT_TRIGGER_AREA_SHIFT_KINDS.filter(
    (kind) =>
      !PATH_AREA_SHIFT_KINDS.includes(kind)
      || (event !== undefined && triggerEventHasPathFeet(event)),
  ).map((kind) => ({
    value: kind,
    label: EFFECT_TRIGGER_AREA_SHIFT_KIND_LABELS[kind],
  }));
}

/** От кого считают направление перемещения */
export const EFFECT_TRIGGER_MOVE_ORIGIN_OPTIONS: EffectSegmentOption<EffectTriggerMoveOrigin>[] =
  EFFECT_TRIGGER_MOVE_ORIGINS.map((origin) => ({
    value: origin,
    label: EFFECT_TRIGGER_MOVE_ORIGIN_LABELS[origin],
  }));

/** Что делает действие с временными хитами */
export const EFFECT_TEMP_HP_MODE_OPTIONS: EffectSegmentOption<EffectTempHpMode>[] =
  EFFECT_TEMP_HP_MODES.map((mode) => ({
    value: mode,
    label: EFFECT_TEMP_HP_MODE_LABELS[mode],
  }));

/** Какой ресурс возвращает действие */
export const EFFECT_RESTORE_KIND_OPTIONS: EffectSegmentOption<EffectRestoreKind>[] =
  EFFECT_RESTORE_KINDS.map((kind) => ({
    value: kind,
    label: EFFECT_RESTORE_KIND_LABELS[kind],
  }));

/** Чей каст заканчивает действие */
export const EFFECT_CAST_OWNER_OPTIONS: EffectSegmentOption<EffectCastOwner>[] =
  EFFECT_CAST_OWNERS.map((owner) => ({
    value: owner,
    label: EFFECT_CAST_OWNER_LABELS[owner],
  }));

/** Виды атаки в условии срабатывания */
export const ATTACK_KIND_OPTIONS: EffectSegmentOption<TriggerAttackKind>[] =
  TRIGGER_ATTACK_KINDS.map((kind) => ({
    value: kind,
    label: capitalize(TRIGGER_ATTACK_KIND_PHRASES[kind]),
  }));

/** Кто может вырваться из эффекта */
export const EFFECT_ESCAPE_ACTOR_OPTIONS: EffectSegmentOption<EffectEscapeActor>[] =
  EFFECT_ESCAPE_ACTORS.map((actor) => ({
    value: actor,
    label: EFFECT_ESCAPE_ACTOR_LABELS[actor],
  }));

/** Что даёт успех действия «вырваться» */
export const EFFECT_ESCAPE_OUTCOME_OPTIONS: EffectSegmentOption<EffectEscapeOutcome>[] =
  EFFECT_ESCAPE_OUTCOMES.map((outcome) => ({
    value: outcome,
    label: EFFECT_ESCAPE_OUTCOME_LABELS[outcome],
  }));

/** Навыки проверки действия «вырваться» */
export const EFFECT_ESCAPE_SKILL_OPTIONS: EffectSegmentOption<SkillType>[] =
  typedObjectEntries(SKILLS_LABELS).map(([skill, label]) => ({
    value: skill,
    label,
  }));

/** Кто выбирает получателей действий */
export const EFFECT_TRIGGER_CHOOSER_OPTIONS: EffectSegmentOption<EffectTriggerChooser>[] =
  EFFECT_TRIGGER_CHOOSERS.map((chooser) => ({
    value: chooser,
    label: EFFECT_TRIGGER_CHOOSER_LABELS[chooser],
  }));

/**
 * Варианты получателя действий срабатывания. «Другая сторона» подписана по
 * событию: у урона — кто его нанёс, у броска атаки — цель или атакующий.
 *
 * @param trigger - событие и роль строки
 * @returns варианты
 */
export function buildTriggerRecipientOptions(
  trigger: Pick<EffectTrigger, 'event' | 'role'>,
): EffectSegmentOption<EffectTriggerRecipient>[] {
  const labels: Record<EffectTriggerRecipient, string> = {
    ...EFFECT_TRIGGER_RECIPIENT_LABELS,
    other: resolveOtherPartyLabel(trigger),
  };

  const available: Record<EffectTriggerRecipient, boolean> = {
    subject: true,
    other: triggerEventHasOtherParty(trigger.event),
    source: triggerEventAcceptsSource(trigger.event),
    area: triggerEventAcceptsArea(trigger.event),
    choice: triggerEventAcceptsChoice(trigger.event),
  };

  return EFFECT_TRIGGER_RECIPIENTS.filter(
    (recipient) => available[recipient],
  ).map((recipient) => ({
    value: recipient,
    label: labels[recipient],
  }));
}

/**
 * Можно ли выбрать получателя действий у события.
 *
 * @param event - событие строки
 * @returns `true`, если кроме носителя есть кому отдать действия
 */
export function triggerEventHasRecipientChoice(
  event: EffectTrigger['event'],
): boolean {
  return (
    triggerEventHasOtherParty(event)
    || triggerEventAcceptsArea(event)
    || triggerEventAcceptsChoice(event)
  );
}

/** Варианты периода лимита */
export const EFFECT_TRIGGER_PERIOD_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerLimitPeriod>
> = EFFECT_TRIGGER_LIMIT_PERIODS.map((period) => ({
  value: period,
  label: EFFECT_TRIGGER_PERIOD_LABELS[period],
}));

/** Варианты исхода действия относительно спасброска */
export const EFFECT_TRIGGER_GATE_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerActionGate>
> = EFFECT_TRIGGER_ACTION_GATES.map((gate) => ({
  value: gate,
  label: EFFECT_TRIGGER_GATE_LABELS[gate],
}));

/** Варианты способа выбора варианта эффекта */
export const EFFECT_VARIANT_PICK_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectVariantPick>
> = EFFECT_VARIANT_PICKS.map((pick) => ({
  value: pick,
  label: EFFECT_VARIANT_PICK_LABELS[pick],
}));

/** Варианты отдыха срабатывания «После отдыха» */
export const EFFECT_TRIGGER_REST_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerRestType>
> = EFFECT_TRIGGER_REST_TYPES.map((restType) => ({
  value: restType,
  label: EFFECT_TRIGGER_REST_LABELS[restType],
}));

/** После какого отдыха возвращается максимум хитов */
export const EFFECT_TRIGGER_MAX_HP_REST_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerMaxHpRestEnd>
> = EFFECT_TRIGGER_MAX_HP_REST_ENDS.map((restType) => ({
  value: restType,
  label: EFFECT_TRIGGER_MAX_HP_REST_LABELS[restType],
}));

/** Выбор режима спасброска срабатывания */
export type EffectTriggerSaveModeChoice =
  EffectTriggerSaveMode | typeof EFFECT_TRIGGER_NORMAL_SAVE_MODE;

/** Режимы спасброска по порядку: обычный первым */
const SAVE_MODE_CHOICES: readonly EffectTriggerSaveModeChoice[] = [
  EFFECT_TRIGGER_NORMAL_SAVE_MODE,
  ...EFFECT_TRIGGER_SAVE_MODES,
];

/** Варианты режима спасброска срабатывания */
export const EFFECT_TRIGGER_SAVE_MODE_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerSaveModeChoice>
> = SAVE_MODE_CHOICES.map((mode) => ({
  value: mode,
  label: EFFECT_TRIGGER_SAVE_MODE_LABELS[mode],
}));

/** Варианты момента повторного спасброска */
export const EFFECT_SAVE_TIMING_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectSaveTiming>
> = EFFECT_SAVE_TIMINGS.map((timing) => ({
  value: timing,
  label: EFFECT_SAVE_TIMING_LABELS[timing],
}));

/** Варианты исхода урона: «успех — половина» — отдельный вариант */
export const EFFECT_TRIGGER_DAMAGE_GATE_OPTIONS: ReadonlyArray<
  EffectSegmentOption<EffectTriggerDamageGateChoice>
> = [
  { value: 'failed', label: EFFECT_TRIGGER_GATE_LABELS.failed },
  {
    value: EFFECT_TRIGGER_DAMAGE_HALF_GATE,
    label: EFFECT_TRIGGER_DAMAGE_HALF_LABEL,
  },
  { value: 'always', label: EFFECT_TRIGGER_GATE_LABELS.always },
  { value: 'saved', label: EFFECT_TRIGGER_GATE_LABELS.saved },
];
