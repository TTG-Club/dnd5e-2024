/**
 * Раскладка окна эффекта: какие шаги показывать там, откуда окно открыто.
 *
 * Один и тот же `ActiveEffect` живёт в разных местах — на персонаже, в
 * предмете, в оружии, в зоне, в записи состояния, — и в каждом месте работает
 * своё подмножество полей. Окно, показывающее все поля везде, и было причиной
 * путаницы: спасбросок на пассивной черте, длительность на кольце, «цель» у
 * зоны молча ничего не делали. Здесь, по месту и текущим настройкам эффекта,
 * решается, что имеет смысл, — чистыми функциями, которые проверяет тест.
 *
 * Правила сверены с рантаймом: пассивный сбор (`collectActiveEffects`),
 * наложение при попадании (`useTargetEffectResolution`), зоны и ауры
 * (`positionalEffects`), тики хода (`turnEffects`).
 */

import type {
  ActiveEffect,
  AreaEffectTrigger,
  EffectAura,
  EffectSave,
  EffectSaveOutcome,
} from './activeEffectTypes.js';
import type {
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerEvent,
} from './effectTriggerTypes.js';

import {
  DEFAULT_EFFECT_CHANGE_PRIORITY,
  parseFormNumber,
} from './activeEffectTypes.js';
import { hasLastingEffectPayload } from './effectAutomation.js';
import {
  createEffectTriggerId,
  listEffectListTriggers,
  writeEffectTriggers,
} from './effectTriggers.js';

/** Места, откуда открывается окно эффекта */
export const EFFECT_FORM_CONTEXTS = [
  'ownEffects',
  'feature',
  'item',
  'weapon',
  'spell',
  'creatureAction',
  'creatureTrait',
  'zone',
  'condition',
  'generic',
] as const;

/**
 * Место, откуда открыто окно эффекта:
 * - `ownEffects` — «Свои эффекты» персонажа или существа;
 * - `feature` — черта, предыстория, класс, вид (эффект копируется на персонажа,
 *   аура умения — «Аура защиты» паладина — излучается уже с него);
 * - `item` — снаряжение и инструменты (действует, пока надето);
 * - `weapon` — оружие: на владельце или на цели при попадании;
 * - `spell` — заклинание: на цели, на заклинателе, аурой или зоной на месте
 *   шаблона;
 * - `creatureAction` — действие существа (на цели);
 * - `creatureTrait` — черта существа (на самом существе);
 * - `zone` — зона на сцене;
 * - `condition` — запись состояния мира;
 * - `generic` — место неизвестно (старое ядро): видно всё, как раньше.
 */
export type EffectFormContext = (typeof EFFECT_FORM_CONTEXTS)[number];

/** Куда эффект доставляется */
export type EffectDelivery = 'carrier' | 'aura' | 'target' | 'zone';

/**
 * Что происходит при УСПЕШНОМ спасброске — одна настройка вместо трёх полей
 * (`applySave.onSuccess`, `applyOnSuccess`, `applyOnSuccessOnly`).
 */
export const EFFECT_SUCCESS_OUTCOMES = [
  'nothing',
  'halfDamage',
  'halfDamageWithEffect',
  'effectWithoutDamage',
  'onlyOnSuccess',
] as const;

/** Исход успешного спасброска */
export type EffectSuccessOutcome = (typeof EFFECT_SUCCESS_OUTCOMES)[number];

/** Почему спасбросок в текущей настройке недоступен */
export type EffectSaveUnavailableReason = 'stayTrigger' | 'onCarrier';

/** Поля, которые в месте окна ничего не делают */
export type InertEffectField =
  | 'effectTarget'
  | 'aura'
  | 'areaTrigger'
  | 'applySave'
  | 'successOutcome'
  | 'damageParts'
  | 'recurringDamage'
  | 'recurringSave'
  | 'consumeOn'
  | 'duration'
  | 'conditionImmunities'
  | 'triggers';

/** Вид действия срабатывания */
export type EffectTriggerActionType = EffectTriggerAction['type'];

/** Что ещё, кроме места, влияет на раскладку */
export interface EffectFormLayoutOptions {
  /**
   * Есть ли у заклинания область: без неё зоне на месте шаблона взяться неоткуда.
   * Не задано — считается, что есть (окно без этого знания доставку не прячет).
   */
  zoneAvailable?: boolean;
}

/** Прежние пропы окна — у ядра, которое ещё не передаёт место */
export interface LegacyEffectFormProps {
  /** Окно зоны */
  showAreaTrigger?: boolean;
  /** Окно записи состояния */
  hideConditionPreset?: boolean;
}

/** Раскладка окна эффекта для текущего места и настройки */
export interface EffectFormLayout {
  /** Место окна */
  context: EffectFormContext;
  /** Текущая доставка эффекта */
  delivery: EffectDelivery;
  /** Текущий момент срабатывания зоны или ауры */
  trigger: AreaEffectTrigger;
  /** Доступные доставки; одна — выбора нет */
  deliveryOptions: readonly EffectDelivery[];
  /** Выбор «пока внутри / при входе / при выходе» */
  showTrigger: boolean;
  /** Радиус и цели ауры */
  showAuraSettings: boolean;
  /** Спасбросок эффекта */
  showSave: boolean;
  /** Почему спасбросок недоступен (шаг показывается с подсказкой) */
  saveUnavailableReason: EffectSaveUnavailableReason | null;
  /** Варианты «при успехе»; пусто — выбор не показывается */
  successOutcomes: readonly EffectSuccessOutcome[];
  /** Выбор «при успехе» относится к спасброску действия, а не эффекта */
  successOutcomeForActionSave: boolean;
  /** Урон срабатывания */
  showTriggerDamage: boolean;
  /** Урон каждый ход */
  showRecurringDamage: boolean;
  /** Кнопка «Шаблон состояния» */
  showConditionPreset: boolean;
  /** Иммунитеты к состояниям */
  showConditionImmunities: boolean;
  /** Длительность */
  showDuration: boolean;
  /** Повторный спасбросок хода */
  showRecurringSave: boolean;
  /** Снятие после атаки */
  showConsumeOn: boolean;
  /**
   * События, на которые здесь работают срабатывания списка «Срабатывания»;
   * пусто — шага нет
   */
  triggerEvents: readonly EffectTriggerEvent[];
  /** Действия срабатываний списка, которые здесь работают */
  triggerActions: readonly EffectTriggerActionType[];
  /** Минимальная Сл спасброска (0 — «Сл источника») */
  minSaveDc: number;
  /** Есть где появиться зоне на месте шаблона (у заклинания есть область) */
  zoneAvailable: boolean;
}

/** Известные места окна — для проверки значения пропа */
const KNOWN_EFFECT_FORM_CONTEXTS: ReadonlySet<unknown> = new Set(
  EFFECT_FORM_CONTEXTS,
);

/** Доставки по месту окна: первая — доставка нового эффекта */
const CONTEXT_DELIVERIES: Record<EffectFormContext, readonly EffectDelivery[]> =
  {
    ownEffects: ['carrier', 'aura'],
    feature: ['carrier', 'aura'],
    item: ['carrier', 'aura'],
    weapon: ['carrier', 'target', 'aura'],
    spell: ['target', 'carrier', 'aura', 'zone'],
    creatureAction: ['target'],
    creatureTrait: ['carrier', 'aura'],
    zone: ['zone'],
    condition: ['carrier'],
    generic: ['carrier', 'target', 'aura'],
  };

/**
 * Места, где эффект «на носителе» лежит в `activeEffects` и проживает свою
 * жизнь: тикает длительность, бросается повторный спасбросок, снимается после
 * атаки. У предмета и черты эффект вложен в запись и этого не делает, а у
 * выданной черты повторный спасбросок и снятие удалили бы саму черту.
 */
const LIVING_CARRIER_CONTEXTS: ReadonlySet<EffectFormContext> = new Set([
  'ownEffects',
  'spell',
]);

/**
 * Места, где эффект «на носителе» не лежит в `activeEffects`, но срабатывания
 * хода у него работают: черта существа лечит и бьёт на его ходу
 * («Регенерация»). Снять саму черту срабатывание не может.
 */
const TICKING_CARRIER_CONTEXTS: ReadonlySet<EffectFormContext> = new Set([
  'creatureTrait',
]);

/**
 * Места со спасброском самого действия — к нему относится выбор «при успехе»,
 * если у эффекта своего спасброска нет.
 */
const ACTION_SAVE_CONTEXTS: ReadonlySet<EffectFormContext> = new Set([
  'spell',
  'creatureAction',
]);

/** Аура нового эффекта по умолчанию */
const DEFAULT_EFFECT_AURA: EffectAura = {
  radius: 10,
  target: 'allies',
  applyToSelf: true,
  visible: true,
};

/** Сложность спасброска нового эффекта по умолчанию */
export const DEFAULT_EFFECT_SAVE_DC = 13;

/** Характеристика спасброска нового эффекта по умолчанию */
const DEFAULT_EFFECT_SAVE_ABILITY = 'wisdom';

/** Минимальная Сл, когда подставить Сл источника нечем */
const FIXED_MIN_SAVE_DC = 1;

/** Минимальная Сл, когда 0 значит «Сл источника» */
const SOURCE_MIN_SAVE_DC = 0;

/**
 * Проверяет, что значение — известное место окна эффекта.
 *
 * @param value - произвольное значение пропа
 * @returns `true` для известного места
 */
export function isEffectFormContext(
  value: unknown,
): value is EffectFormContext {
  return KNOWN_EFFECT_FORM_CONTEXTS.has(value);
}

/**
 * Место окна: явное из пропа, иначе — по прежним пропам старого ядра.
 *
 * @param context - проп `context`
 * @param legacy - прежние пропы окна
 * @returns место окна
 */
export function resolveEffectFormContext(
  context: unknown,
  legacy: LegacyEffectFormProps,
): EffectFormContext {
  if (isEffectFormContext(context)) {
    return context;
  }

  if (legacy.showAreaTrigger) {
    return 'zone';
  }

  return legacy.hideConditionPreset ? 'condition' : 'generic';
}

/**
 * Доставка эффекта, как её видит окно в этом месте.
 *
 * @param effect - эффект
 * @param context - место окна
 * @returns доставка
 */
export function readEffectDelivery(
  effect: ActiveEffect,
  context: EffectFormContext,
): EffectDelivery {
  const options = CONTEXT_DELIVERIES[context];

  // Зона мастера — единственная доставка своего места; у заклинания зона лишь
  // одна из доставок, и её выбирает поле эффекта
  if (
    (options.length === 1 && options[0] === 'zone')
    || (effect.effectTarget === 'zone' && options.includes('zone'))
  ) {
    return 'zone';
  }

  if (effect.aura && options.includes('aura')) {
    return 'aura';
  }

  if (effect.effectTarget === 'target' && options.includes('target')) {
    return 'target';
  }

  return options.includes('carrier') ? 'carrier' : options[0];
}

/**
 * Меняет доставку эффекта. Аура и цель атаки взаимоисключающие: аура
 * излучается носителем, а эффект «на цели» ложится на того, по кому попали.
 *
 * @param effect - эффект
 * @param delivery - новая доставка
 * @returns новый эффект
 */
export function writeEffectDelivery(
  effect: ActiveEffect,
  delivery: EffectDelivery,
): ActiveEffect {
  switch (delivery) {
    case 'aura':
      return {
        ...effect,
        effectTarget: 'self',
        aura: effect.aura ?? { ...DEFAULT_EFFECT_AURA },
      };
    case 'target':
      return {
        ...effect,
        effectTarget: 'target',
        aura: undefined,
        areaTrigger: undefined,
      };
    case 'zone':
      return { ...effect, effectTarget: 'zone', aura: undefined };
    case 'carrier':
    default:
      return {
        ...effect,
        effectTarget: 'self',
        aura: undefined,
        areaTrigger: undefined,
      };
  }
}

/**
 * Момент срабатывания зоны или ауры; без поля — «пока внутри».
 *
 * @param effect - эффект
 * @returns момент срабатывания
 */
export function readEffectTrigger(effect: ActiveEffect): AreaEffectTrigger {
  return effect.areaTrigger ?? 'stay';
}

/**
 * Меняет момент срабатывания. «Пока внутри» — поведение по умолчанию, поле для
 * него не хранится.
 *
 * @param effect - эффект
 * @param trigger - новый момент
 * @returns новый эффект
 */
export function writeEffectTrigger(
  effect: ActiveEffect,
  trigger: AreaEffectTrigger,
): ActiveEffect {
  return { ...effect, areaTrigger: trigger === 'stay' ? undefined : trigger };
}

/**
 * Новый эффект для места окна: доставка по умолчанию уже выбрана.
 *
 * @param context - место окна
 * @param id - идентификатор нового эффекта
 * @param name - название по умолчанию
 * @returns новый эффект
 */
export function createEffectForContext(
  context: EffectFormContext,
  id: string,
  name: string,
): ActiveEffect {
  const effect: ActiveEffect = {
    id,
    name,
    description: '',
    disabled: false,
    origin: 'manual',
    transfer: false,
    duration: { type: 'permanent' },
    changes: [],
    flags: [],
  };

  return writeEffectDelivery(effect, CONTEXT_DELIVERIES[context][0]);
}

/**
 * Исход успешного спасброска по полям эффекта.
 *
 * @param effect - эффект
 * @returns исход
 */
export function readEffectSuccessOutcome(
  effect: ActiveEffect,
): EffectSuccessOutcome {
  if (effect.applyOnSuccessOnly) {
    return 'onlyOnSuccess';
  }

  const halfDamage = effect.applySave?.onSuccess === 'half';

  if (effect.applyOnSuccess) {
    return halfDamage ? 'halfDamageWithEffect' : 'effectWithoutDamage';
  }

  return halfDamage ? 'halfDamage' : 'nothing';
}

/**
 * Записывает исход успешного спасброска в поля эффекта.
 *
 * @param effect - эффект
 * @param outcome - исход
 * @returns новый эффект
 */
export function writeEffectSuccessOutcome(
  effect: ActiveEffect,
  outcome: EffectSuccessOutcome,
): ActiveEffect {
  const onSuccess: EffectSaveOutcome =
    outcome === 'halfDamage' || outcome === 'halfDamageWithEffect'
      ? 'half'
      : 'negate';

  const effectAnyway =
    outcome === 'halfDamageWithEffect' || outcome === 'effectWithoutDamage';

  return {
    ...effect,
    applySave: effect.applySave
      ? { ...effect.applySave, onSuccess }
      : undefined,
    applyOnSuccess: effectAnyway ? true : undefined,
    applyOnSuccessOnly: outcome === 'onlyOnSuccess' ? true : undefined,
  };
}

/**
 * Варианты «при успехе», осмысленные для настройки эффекта. Половина урона —
 * только при уроне срабатывания, наложение при успехе — только если есть что
 * накладывать. Текущий исход остаётся в списке, даже если стал неуместен: иначе
 * выбор показал бы не то, что записано.
 *
 * @param effect - эффект
 * @param forActionSave - выбор относится к спасброску действия
 * @returns варианты в порядке показа
 */
function listSuccessOutcomes(
  effect: ActiveEffect,
  forActionSave: boolean,
): EffectSuccessOutcome[] {
  const hasDamage = !forActionSave && (effect.damageParts?.length ?? 0) > 0;
  const hasPayload = hasLastingEffectPayload(effect);
  const current = readEffectSuccessOutcome(effect);

  return EFFECT_SUCCESS_OUTCOMES.filter((outcome) => {
    if (outcome === current || outcome === 'nothing') {
      return true;
    }

    switch (outcome) {
      case 'halfDamage':
        return hasDamage;
      case 'halfDamageWithEffect':
        return hasDamage && hasPayload;
      default:
        return hasPayload;
    }
  });
}

/**
 * Раскладка окна эффекта: что показывать для места и текущей настройки.
 *
 * @param context - место окна
 * @param effect - эффект в окне
 * @returns раскладка
 */
export function resolveEffectFormLayout(
  context: EffectFormContext,
  effect: ActiveEffect,
  options: EffectFormLayoutOptions = {},
): EffectFormLayout {
  const delivery = readEffectDelivery(effect, context);

  // Без области у заклинания зоне негде появиться: такой доставки не
  // предлагаем, а уже выбранная остаётся видна — её покажет плашка
  const deliveryOptions =
    options.zoneAvailable === false && context !== 'zone' && delivery !== 'zone'
      ? CONTEXT_DELIVERIES[context].filter((option) => option !== 'zone')
      : CONTEXT_DELIVERIES[context];

  const trigger = readEffectTrigger(effect);
  const isGeneric = context === 'generic';

  const hasTrigger = delivery === 'zone' || delivery === 'aura';
  const isOneShot = hasTrigger && trigger !== 'stay';
  const isOnTarget = delivery === 'target';
  const isAuraStay = delivery === 'aura' && trigger === 'stay';

  const isLivingCarrier =
    delivery === 'carrier' && LIVING_CARRIER_CONTEXTS.has(context);

  const isTickingCarrier =
    delivery === 'carrier' && TICKING_CARRIER_CONTEXTS.has(context);

  // Спасбросок эффекта бросает тот, на кого эффект ложится в момент
  // срабатывания: цель попадания или вошедший в зону/ауру
  const showSave = isGeneric || isOnTarget || isOneShot;

  let saveUnavailableReason: EffectSaveUnavailableReason | null = null;

  if (!showSave && hasTrigger) {
    saveUnavailableReason = 'stayTrigger';
  } else if (!showSave && deliveryOptions.includes('target')) {
    saveUnavailableReason = 'onCarrier';
  }

  const successOutcomeForActionSave =
    !effect.applySave && isOnTarget && ACTION_SAVE_CONTEXTS.has(context);

  const successOutcomes =
    (showSave && effect.applySave) || successOutcomeForActionSave
      ? listSuccessOutcomes(effect, successOutcomeForActionSave)
      : [];

  // Длящаяся копия на цели, на вошедшем в зону или ауру, на живом носителе
  const livesOnItsOwn = isGeneric || isOnTarget || isOneShot || isLivingCarrier;

  // Урон каждый ход тикает и у эффекта «пока в зоне» (копия лежит на
  // сущности), и у ауры «пока в ауре» — на ходу того, кого она накрыла, и у
  // черты существа — на его ходу
  const showRecurringDamage =
    livesOnItsOwn || (trigger === 'stay' && hasTrigger) || isTickingCarrier;

  return {
    context,
    delivery,
    trigger,
    deliveryOptions,
    showTrigger: hasTrigger,
    showAuraSettings: delivery === 'aura',
    showSave,
    saveUnavailableReason,
    successOutcomes,
    successOutcomeForActionSave,
    showTriggerDamage: showSave,
    showRecurringDamage,
    showConditionPreset: context !== 'condition',
    // Иммунитет ауры «пока в ауре» получают все, кого она накрывает
    // («Аура отваги»)
    showConditionImmunities: true,
    // Длительность самой ауры на живом носителе тоже тикает
    showDuration:
      livesOnItsOwn || (isAuraStay && LIVING_CARRIER_CONTEXTS.has(context)),
    showRecurringSave: livesOnItsOwn,
    showConsumeOn: livesOnItsOwn,
    ...resolveTriggerListLayout({
      showRecurringDamage,
      canRemoveSelf: livesOnItsOwn,
      isZone: delivery === 'zone',
    }),
    minSaveDc: acceptsSourceSaveDc(context, delivery)
      ? SOURCE_MIN_SAVE_DC
      : FIXED_MIN_SAVE_DC,
    zoneAvailable: options.zoneAvailable !== false,
  };
}

/** События хода субъекта */
const TURN_TRIGGER_EVENTS: readonly EffectTriggerEvent[] = [
  'turnStart',
  'turnEnd',
];

/** Вход в зону и выход из неё */
const PRESENCE_TRIGGER_EVENTS: readonly EffectTriggerEvent[] = [
  'enter',
  'exit',
];

/**
 * Что умеет список «Срабатывания» в месте окна. Правила сверены с рантаймом:
 * ход — там, где эффект тикает на существе (`processTurnEffects`), вход и выход
 * — у зоны (`syncActorAreaEffects`), бросок атаки — у эффекта, лежащего на
 * существе (`runAttackRollTriggers`). Снять эффект можно только лежащий на
 * существе: черту, ауру чужого токена и зону срабатывание не снимает.
 *
 * @param place - что известно о месте
 * @param place.showRecurringDamage - эффект тикает на ходу существа
 * @param place.canRemoveSelf - эффект лежит на существе сам
 * @param place.isZone - эффект зоны
 * @returns события и действия списка
 */
function resolveTriggerListLayout(place: {
  showRecurringDamage: boolean;
  canRemoveSelf: boolean;
  isZone: boolean;
}): Pick<EffectFormLayout, 'triggerEvents' | 'triggerActions'> {
  const ticks = place.showRecurringDamage || place.canRemoveSelf;

  const triggerEvents: EffectTriggerEvent[] = [
    ...(ticks ? TURN_TRIGGER_EVENTS : []),
    ...(place.isZone ? PRESENCE_TRIGGER_EVENTS : []),
    ...(place.canRemoveSelf ? (['attackRoll'] as const) : []),
  ];

  if (triggerEvents.length === 0) {
    return { triggerEvents, triggerActions: [] };
  }

  return {
    triggerEvents,
    triggerActions: [
      'damage',
      'applyCondition',
      ...(place.canRemoveSelf ? (['removeSelf'] as const) : []),
    ],
  };
}

/**
 * Бросается ли спасбросок срабатывания на это событие. Бросок атаки делает
 * клиент, и спасброска там пока нет.
 *
 * @param event - событие
 * @returns `true`, если спасбросок работает
 */
export function triggerEventAcceptsSave(event: EffectTriggerEvent): boolean {
  return event !== 'attackRoll';
}

/**
 * Действия, которые работают у срабатывания на это событие в месте окна. На
 * броске атаки урона нет — его катает клиент без спасброска и защит.
 *
 * @param layout - раскладка окна
 * @param event - событие срабатывания
 * @returns действия
 */
export function listTriggerActionTypes(
  layout: EffectFormLayout,
  event: EffectTriggerEvent,
): EffectTriggerActionType[] {
  return layout.triggerActions.filter(
    (type) => event !== 'attackRoll' || type !== 'damage',
  );
}

/** Готовые срабатывания списка */
export const EFFECT_TRIGGER_PRESETS = [
  'recurringDamage',
  'recurringSave',
  'consumeOn',
  'custom',
] as const;

/**
 * Готовое срабатывание:
 * - `recurringDamage` — урон каждый ход;
 * - `recurringSave` — повторный спасбросок снимает эффект;
 * - `consumeOn` — снять после своей атаки;
 * - `custom` — своё.
 */
export type EffectTriggerPreset = (typeof EFFECT_TRIGGER_PRESETS)[number];

/**
 * Готовые срабатывания, которые работают в месте окна.
 *
 * @param layout - раскладка окна
 * @returns пресеты в порядке показа
 */
export function listEffectTriggerPresets(
  layout: EffectFormLayout,
): EffectTriggerPreset[] {
  const { triggerEvents, triggerActions } = layout;

  const available: Record<EffectTriggerPreset, boolean> = {
    recurringDamage:
      triggerEvents.includes('turnStart') && triggerActions.includes('damage'),
    recurringSave:
      triggerEvents.includes('turnEnd')
      && triggerActions.includes('removeSelf'),
    consumeOn:
      triggerEvents.includes('attackRoll')
      && triggerActions.includes('removeSelf'),
    custom: triggerEvents.length > 0,
  };

  return EFFECT_TRIGGER_PRESETS.filter((preset) => available[preset]);
}

/**
 * Новое срабатывание по пресету. Спасбросок берёт характеристику и Сл
 * спасброска эффекта: повторный почти всегда повторяет исходный.
 *
 * @param preset - пресет
 * @param effect - эффект в окне
 * @param layout - раскладка окна
 * @returns срабатывание
 */
export function createEffectTriggerPreset(
  preset: EffectTriggerPreset,
  effect: ActiveEffect,
  layout: EffectFormLayout,
): EffectTrigger {
  const id = createEffectTriggerId();

  switch (preset) {
    case 'recurringDamage':
      return {
        id,
        event: 'turnStart',
        actions: [{ type: 'damage', parts: [] }],
      };
    case 'recurringSave':
      return {
        id,
        event: 'turnEnd',
        save: {
          ability: effect.applySave?.ability ?? DEFAULT_EFFECT_SAVE_ABILITY,
          dc: effect.applySave?.dc ?? defaultSaveDc(layout),
        },
        actions: [{ type: 'removeSelf', on: 'saved' }],
      };
    case 'consumeOn':
      return {
        id,
        event: 'attackRoll',
        role: 'attacker',
        actions: [{ type: 'removeSelf', on: 'always' }],
      };
    default:
      return { id, event: layout.triggerEvents[0] ?? 'turnStart', actions: [] };
  }
}

/**
 * Записывает строку списка «Срабатывания»: заменяет, добавляет в конец или
 * убирает. Запись — «сначала старые поля» (`writeEffectTriggers`).
 *
 * @param effect - эффект в окне
 * @param index - номер строки; за концом списка — добавление
 * @param trigger - новая строка; `null` — убрать
 * @returns новый эффект
 */
export function writeEffectTriggerRow(
  effect: ActiveEffect,
  index: number,
  trigger: EffectTrigger | null,
): ActiveEffect {
  const rows = [...listEffectListTriggers(effect)];

  if (trigger === null) {
    rows.splice(index, 1);
  } else {
    rows[Math.min(index, rows.length)] = trigger;
  }

  return writeEffectTriggers(effect, rows);
}

/**
 * Работает ли явное срабатывание в месте окна.
 *
 * @param trigger - срабатывание
 * @param layout - раскладка окна
 * @returns `true`, если событие здесь срабатывает
 */
function isTriggerSupported(
  trigger: EffectTrigger,
  layout: EffectFormLayout,
): boolean {
  return layout.triggerEvents.includes(trigger.event);
}

/**
 * Можно ли Сл 0 — «Сл источника». У заклинания Сл заклинателя проставляется
 * при любом наложении: цели — в момент броска, заклинателю и в зону — до того,
 * как эффект уйдёт жить отдельно. У действия существа — только цели. У зоны
 * мастера и у предмета источника нет.
 *
 * @param context - место окна
 * @param delivery - доставка эффекта
 * @returns `true`, если 0 значит «Сл источника»
 */
function acceptsSourceSaveDc(
  context: EffectFormContext,
  delivery: EffectDelivery,
): boolean {
  switch (context) {
    case 'generic':
    case 'spell':
      return true;
    case 'creatureAction':
    case 'weapon':
      return delivery === 'target';
    default:
      return false;
  }
}

/** Шаги окна эффекта в порядке показа */
export const EFFECT_FORM_STEPS = [
  'trigger',
  'save',
  'damage',
  'modifiers',
  'duration',
  'triggers',
] as const;

/**
 * Шаг окна эффекта:
 * - `trigger` — когда и на кого срабатывает;
 * - `save` — спасбросок;
 * - `damage` — урон при срабатывании;
 * - `modifiers` — что эффект меняет;
 * - `duration` — длительность;
 * - `triggers` — срабатывания: урон каждый ход, повторный спасбросок, снятие
 *   после атаки и свои.
 */
export type EffectFormStep = (typeof EFFECT_FORM_STEPS)[number];

/**
 * Шаги, которые есть смысл показать при этой раскладке. Шаг без единого
 * работающего поля не показывается вовсе — нумерация идёт по оставшимся.
 *
 * @param layout - раскладка окна
 * @returns шаги в порядке показа
 */
export function listEffectFormSteps(
  layout: EffectFormLayout,
): EffectFormStep[] {
  const visibility: Record<EffectFormStep, boolean> = {
    trigger: layout.deliveryOptions.length > 1 || layout.showTrigger,
    save:
      layout.showSave
      || layout.saveUnavailableReason !== null
      || layout.successOutcomeForActionSave,
    damage: layout.showTriggerDamage,
    modifiers: true,
    duration: layout.showDuration,
    triggers: layout.triggerEvents.length > 0,
  };

  return EFFECT_FORM_STEPS.filter((step) => visibility[step]);
}

/**
 * Сложность нового спасброска: там, где есть источник, — его Сл, иначе Сл по
 * умолчанию.
 *
 * @param layout - раскладка окна
 * @returns сложность
 */
function defaultSaveDc(layout: EffectFormLayout): number {
  return layout.minSaveDc === SOURCE_MIN_SAVE_DC
    ? SOURCE_MIN_SAVE_DC
    : DEFAULT_EFFECT_SAVE_DC;
}

/**
 * Включает или выключает спасбросок эффекта.
 *
 * Выключенный спасбросок забирает с собой и выбор «при успехе»: без спасброска
 * «только при успехе» у зоны или оружия значило бы «никогда». Исключение — эффект
 * на цели заклинания или действия: там выбор относится к их собственному
 * спасброску и остаётся.
 *
 * @param effect - эффект
 * @param enabled - нужен ли спасбросок
 * @param layout - раскладка окна
 * @returns новый эффект
 */
export function writeEffectSaveEnabled(
  effect: ActiveEffect,
  enabled: boolean,
  layout: EffectFormLayout,
): ActiveEffect {
  if (enabled) {
    const save: EffectSave = effect.applySave ?? {
      ability: DEFAULT_EFFECT_SAVE_ABILITY,
      dc: defaultSaveDc(layout),
      onSuccess: 'negate',
    };

    return { ...effect, applySave: save };
  }

  const keepsActionSaveOutcome =
    layout.delivery === 'target' && ACTION_SAVE_CONTEXTS.has(layout.context);

  if (keepsActionSaveOutcome) {
    return { ...effect, applySave: undefined };
  }

  return {
    ...effect,
    applySave: undefined,
    applyOnSuccess: undefined,
    applyOnSuccessOnly: undefined,
  };
}

/**
 * Заполняет эффект данными состояния из шаблона. Берётся то, ЧТО состояние
 * делает (название, модификаторы, флаги, иммунитеты, ключ состояния); как и
 * когда эффект срабатывает (доставка, момент, спасбросок, урон, длительность),
 * остаётся от автора — иначе шаблон «Отравленный» стёр бы у зоны вход и
 * спасбросок.
 *
 * @param effect - эффект в окне
 * @param condition - эффект состояния, собранный движком
 * @returns новый эффект
 */
export function applyConditionPresetToEffect(
  effect: ActiveEffect,
  condition: ActiveEffect,
): ActiveEffect {
  return {
    ...effect,
    name: condition.name,
    description: condition.description,
    icon: condition.icon,
    conditionKey: condition.conditionKey,
    changes: condition.changes,
    flags: condition.flags,
    conditionImmunities: condition.conditionImmunities,
    exhaustionLevel: condition.exhaustionLevel,
  };
}

/**
 * Поля эффекта, которые заданы, но в этом месте ничего не делают. Окно
 * показывает их плашкой с кнопкой «Убрать», а не стирает молча: запись могла
 * прийти из старого редактора, и решать за автора нельзя.
 *
 * @param effect - эффект
 * @param layout - раскладка окна
 * @returns неработающие поля
 */
export function listInertEffectFields(
  effect: ActiveEffect,
  layout: EffectFormLayout,
): InertEffectField[] {
  if (layout.context === 'generic') {
    return [];
  }

  const { context, deliveryOptions } = layout;

  const checks: Array<[InertEffectField, boolean]> = [
    [
      'effectTarget',
      // У предмета и черты существа эффект «на цели» отсекается сбором, у
      // умения копируется на персонажа и ложится на него самого, у действия
      // существа эффект «на носителе» никто не накладывает. «В зону» работает
      // только там, где зона — одна из доставок, и у заклинания с областью
      ((context === 'item'
        || context === 'creatureTrait'
        || context === 'feature')
        && effect.effectTarget === 'target')
        || (context === 'creatureAction' && effect.effectTarget !== 'target')
        || (effect.effectTarget === 'zone'
          && context !== 'zone'
          && (!CONTEXT_DELIVERIES[context].includes('zone')
            || !layout.zoneAvailable)),
    ],
    ['aura', Boolean(effect.aura) && !deliveryOptions.includes('aura')],
    [
      'areaTrigger',
      !layout.showTrigger
        && effect.areaTrigger !== undefined
        && effect.areaTrigger !== 'stay',
    ],
    ['applySave', !layout.showSave && effect.applySave !== undefined],
    [
      'successOutcome',
      layout.successOutcomes.length === 0
        && (effect.applyOnSuccess === true
          || effect.applyOnSuccessOnly === true),
    ],
    [
      'damageParts',
      !layout.showTriggerDamage && (effect.damageParts?.length ?? 0) > 0,
    ],
    [
      'recurringDamage',
      !layout.showRecurringDamage && effect.recurringDamage !== undefined,
    ],
    [
      'recurringSave',
      !layout.showRecurringSave && effect.recurringSave !== undefined,
    ],
    ['consumeOn', !layout.showConsumeOn && effect.consumeOn !== undefined],
    ['duration', !layout.showDuration && effect.duration.type !== 'permanent'],
    [
      'conditionImmunities',
      !layout.showConditionImmunities
        && (effect.conditionImmunities?.length ?? 0) > 0,
    ],
    [
      'triggers',
      (effect.triggers ?? []).some(
        (trigger) => !isTriggerSupported(trigger, layout),
      ),
    ],
  ];

  return checks.filter(([, isInert]) => isInert).map(([field]) => field);
}

/**
 * Убирает у эффекта неработающие поля.
 *
 * @param effect - эффект
 * @param fields - поля, которые убрать
 * @param context - место окна (задаёт цель, которая здесь работает)
 * @returns новый эффект
 */
export function clearInertEffectFields(
  effect: ActiveEffect,
  fields: readonly InertEffectField[],
  context: EffectFormContext,
): ActiveEffect {
  return fields.reduce<ActiveEffect>((cleared, field) => {
    switch (field) {
      case 'effectTarget':
        return {
          ...cleared,
          effectTarget:
            CONTEXT_DELIVERIES[context][0] === 'target' ? 'target' : 'self',
        };
      case 'successOutcome':
        return {
          ...writeEffectSuccessOutcome(cleared, 'nothing'),
          applyOnSuccess: undefined,
          applyOnSuccessOnly: undefined,
        };
      case 'duration':
        return { ...cleared, duration: { type: 'permanent' } };
      case 'triggers': {
        // Убираются только срабатывания, которые здесь не работают
        const layout = resolveEffectFormLayout(context, cleared);

        const kept = (cleared.triggers ?? []).filter((trigger) =>
          isTriggerSupported(trigger, layout),
        );

        return { ...cleared, triggers: kept.length > 0 ? kept : undefined };
      }
      default:
        return { ...cleared, [field]: undefined };
    }
  }, effect);
}

/**
 * Сложность спасброска не ниже допустимой. Пустое поле там, где 0 значит «Сл
 * источника», — Сл источника; там, где подставить нечего, — Сл по умолчанию, а
 * не минимум: Сл 1 проходил бы любой.
 *
 * @param dc - сложность из поля
 * @param minDc - минимум места
 * @returns сложность
 */
function clampSaveDc(dc: unknown, minDc: number): number {
  const fallback =
    minDc === SOURCE_MIN_SAVE_DC ? SOURCE_MIN_SAVE_DC : DEFAULT_EFFECT_SAVE_DC;

  return Math.max(minDc, Math.trunc(parseFormNumber(dc) ?? fallback));
}

/**
 * Явные срабатывания для записи: без действий — не пишутся (разбор записи их
 * всё равно отбросит), Сл — не ниже допустимой, лимит — от одного раза.
 *
 * @param triggers - срабатывания черновика
 * @param minDc - минимум Сл места
 * @returns срабатывания либо `undefined`
 */
function normalizeDraftTriggers(
  triggers: readonly EffectTrigger[] | undefined,
  minDc: number,
): EffectTrigger[] | undefined {
  const normalized = (triggers ?? [])
    .filter((trigger) => trigger.actions.length > 0)
    .map((trigger) => ({
      ...trigger,
      save: trigger.save
        ? { ...trigger.save, dc: clampSaveDc(trigger.save.dc, minDc) }
        : undefined,
      limit: trigger.limit
        ? {
            ...trigger.limit,
            max: Math.max(
              1,
              Math.trunc(parseFormNumber(trigger.limit.max) ?? 1),
            ),
          }
        : undefined,
    }));

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Приводит черновик к записи перед сохранением: числа из полей — числами,
 * Сл — не ниже допустимой, пустые списки — отсутствием поля.
 *
 * @param effect - черновик окна
 * @param layout - раскладка окна
 * @returns эффект для сохранения
 */
export function normalizeEffectDraft(
  effect: ActiveEffect,
  layout: EffectFormLayout,
): ActiveEffect {
  const durationValue = parseFormNumber(effect.duration.value);

  return {
    ...effect,
    name: effect.name.trim(),
    duration: {
      ...effect.duration,
      value:
        durationValue === undefined
          ? undefined
          : Math.max(0, Math.trunc(durationValue)),
    },
    changes: effect.changes.map((change) => ({
      ...change,
      priority: Math.trunc(
        parseFormNumber(change.priority) ?? DEFAULT_EFFECT_CHANGE_PRIORITY,
      ),
    })),
    aura: effect.aura
      ? {
          ...effect.aura,
          radius: Math.max(0, parseFormNumber(effect.aura.radius) ?? 0),
        }
      : undefined,
    applySave: effect.applySave
      ? {
          ...effect.applySave,
          dc: clampSaveDc(effect.applySave.dc, layout.minSaveDc),
        }
      : undefined,
    recurringSave: effect.recurringSave
      ? {
          ...effect.recurringSave,
          dc: clampSaveDc(effect.recurringSave.dc, layout.minSaveDc),
        }
      : undefined,
    recurringDamage: effect.recurringDamage
      ? {
          ...effect.recurringDamage,
          save: effect.recurringDamage.save
            ? {
                ...effect.recurringDamage.save,
                dc: clampSaveDc(
                  effect.recurringDamage.save.dc,
                  layout.minSaveDc,
                ),
              }
            : undefined,
        }
      : undefined,
    damageParts: effect.damageParts?.length ? effect.damageParts : undefined,
    conditionImmunities: effect.conditionImmunities?.length
      ? effect.conditionImmunities
      : undefined,
    triggers: normalizeDraftTriggers(effect.triggers, layout.minSaveDc),
  };
}
