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
  RecurringSave,
} from './activeEffectTypes.js';

import {
  DEFAULT_EFFECT_CHANGE_PRIORITY,
  parseFormNumber,
} from './activeEffectTypes.js';
import { hasLastingEffectPayload } from './effectAutomation.js';

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
 * - `spell` — заклинание: на цели или на заклинателе;
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
  | 'conditionImmunities';

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
  /** Минимальная Сл спасброска (0 — «Сл источника») */
  minSaveDc: number;
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
    spell: ['target', 'carrier', 'aura'],
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

  if (options.includes('zone')) {
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
      return { ...effect, aura: undefined };
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
): EffectFormLayout {
  const deliveryOptions = CONTEXT_DELIVERIES[context];
  const delivery = readEffectDelivery(effect, context);
  const trigger = readEffectTrigger(effect);
  const isGeneric = context === 'generic';

  const hasTrigger = delivery === 'zone' || delivery === 'aura';
  const isOneShot = hasTrigger && trigger !== 'stay';
  const isOnTarget = delivery === 'target';
  const isAuraStay = delivery === 'aura' && trigger === 'stay';

  const isLivingCarrier =
    delivery === 'carrier' && LIVING_CARRIER_CONTEXTS.has(context);

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
    // Урон каждый ход тикает и у эффекта «пока в зоне»: копия лежит на сущности
    showRecurringDamage:
      livesOnItsOwn || (delivery === 'zone' && trigger === 'stay'),
    showConditionPreset: context !== 'condition',
    // Иммунитет ауры «пока внутри» другим не достаётся: они получают лишь
    // модификаторы и флаги
    showConditionImmunities: isGeneric || !isAuraStay,
    // Длительность самой ауры на живом носителе тоже тикает
    showDuration:
      livesOnItsOwn || (isAuraStay && LIVING_CARRIER_CONTEXTS.has(context)),
    showRecurringSave: livesOnItsOwn,
    showConsumeOn: livesOnItsOwn,
    minSaveDc:
      isGeneric || (isOnTarget && ACTION_SAVE_CONTEXTS.has(context))
        ? SOURCE_MIN_SAVE_DC
        : FIXED_MIN_SAVE_DC,
  };
}

/** Шаги окна эффекта в порядке показа */
export const EFFECT_FORM_STEPS = [
  'trigger',
  'save',
  'damage',
  'modifiers',
  'duration',
] as const;

/**
 * Шаг окна эффекта:
 * - `trigger` — когда и на кого срабатывает;
 * - `save` — спасбросок;
 * - `damage` — урон при срабатывании и каждый ход;
 * - `modifiers` — что эффект меняет;
 * - `duration` — длительность и снятие.
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
    damage: layout.showTriggerDamage || layout.showRecurringDamage,
    modifiers: true,
    duration:
      layout.showDuration || layout.showRecurringSave || layout.showConsumeOn,
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
 * Включает или выключает повторный спасбросок хода. Новый берёт характеристику и
 * Сл спасброска эффекта: «спасбросок Мудрости в конце каждого хода» почти
 * всегда повторяет исходный.
 *
 * @param effect - эффект
 * @param enabled - нужен ли повторный спасбросок
 * @param layout - раскладка окна
 * @returns новый эффект
 */
export function writeRecurringSaveEnabled(
  effect: ActiveEffect,
  enabled: boolean,
  layout: EffectFormLayout,
): ActiveEffect {
  if (!enabled) {
    return { ...effect, recurringSave: undefined };
  }

  const recurringSave: RecurringSave = effect.recurringSave ?? {
    ability: effect.applySave?.ability ?? DEFAULT_EFFECT_SAVE_ABILITY,
    dc: effect.applySave?.dc ?? defaultSaveDc(layout),
    timing: 'endOfTurn',
  };

  return { ...effect, recurringSave };
}

/**
 * Включает или выключает спасбросок против урона каждый ход. Новый берёт
 * характеристику и Сл спасброска эффекта, а успех по умолчанию снимает весь
 * урон — так звучит большинство облаков и аур («Облако смерти» — половина,
 * это автор выберет сам).
 *
 * @param effect - эффект с уроном каждый ход
 * @param enabled - нужен ли спасбросок
 * @param layout - раскладка окна
 * @returns новый эффект; без урона каждый ход — прежний
 */
export function writeRecurringDamageSaveEnabled(
  effect: ActiveEffect,
  enabled: boolean,
  layout: EffectFormLayout,
): ActiveEffect {
  const { recurringDamage } = effect;

  if (!recurringDamage) {
    return effect;
  }

  if (!enabled) {
    return {
      ...effect,
      recurringDamage: { ...recurringDamage, save: undefined },
    };
  }

  const save: EffectSave = recurringDamage.save ?? {
    ability: effect.applySave?.ability ?? DEFAULT_EFFECT_SAVE_ABILITY,
    dc: effect.applySave?.dc ?? defaultSaveDc(layout),
    onSuccess: 'negate',
  };

  return { ...effect, recurringDamage: { ...recurringDamage, save } };
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
      // У предмета и черты эффект «на цели» отсекается сбором, у действия
      // существа эффект «на носителе» никто не накладывает
      ((context === 'item' || context === 'creatureTrait')
        && effect.effectTarget === 'target')
        || (context === 'creatureAction' && effect.effectTarget !== 'target'),
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
          effectTarget: context === 'creatureAction' ? 'target' : 'self',
        };
      case 'successOutcome':
        return {
          ...writeEffectSuccessOutcome(cleared, 'nothing'),
          applyOnSuccess: undefined,
          applyOnSuccessOnly: undefined,
        };
      case 'duration':
        return { ...cleared, duration: { type: 'permanent' } };
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
  };
}
