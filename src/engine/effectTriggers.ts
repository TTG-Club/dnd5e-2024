/**
 * Чтение и запись срабатываний эффекта.
 *
 * Старые поля эффекта — урон каждый ход, повторный спасбросок, снятие после
 * атаки, спасбросок и урон срабатывания — читаются как срабатывания
 * `legacy.*`, явные `triggers` добавляются следом. Так весь код, которому нужно
 * «что эффект делает на событии», читает один список, а данные контента не
 * меняются.
 *
 * Запись идёт «сначала старые поля»: строка, которую выражает старое поле,
 * пишется в него — сайт и прежние версии VTTG читают такой контент как раньше.
 * В `triggers` уходит только то, чего старые поля не выражают (лимит, состояние
 * на ходу, ход источника, условие, второе однотипное срабатывание).
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type {
  EffectTrigger,
  EffectTriggerAction,
  EffectTriggerActionGate,
  EffectTriggerEvent,
  LegacyTriggerKind,
} from './effectTriggerTypes.js';

import { generateId } from '@vtt/shared';

import {
  LEGACY_TRIGGER_ID_PREFIX,
  LEGACY_TRIGGER_IDS,
} from './effectTriggerTypes.js';

/** Приставка id нового срабатывания */
const TRIGGER_ID_PREFIX = 'trigger';

/** Срабатывания эффекта уже прочитаны — эффект в окне не мутируется */
const collectedTriggers = new WeakMap<ActiveEffect, readonly EffectTrigger[]>();

/**
 * Выведено ли срабатывание из старого поля эффекта.
 *
 * @param trigger - срабатывание
 * @returns `true` для id `legacy.*`
 */
export function isLegacyTrigger(trigger: Pick<EffectTrigger, 'id'>): boolean {
  return trigger.id.startsWith(LEGACY_TRIGGER_ID_PREFIX);
}

/**
 * Гейт действия, если он не задан: при спасброске — провал, без него — всегда.
 *
 * @param trigger - срабатывание
 * @param action - действие
 * @returns гейт
 */
export function resolveTriggerActionGate(
  trigger: Pick<EffectTrigger, 'save'>,
  action: EffectTriggerAction,
): EffectTriggerActionGate {
  return action.on ?? (trigger.save ? 'failed' : 'always');
}

/**
 * Событие хода по старой отметке времени.
 *
 * @param timing - начало или конец хода
 * @returns событие
 */
function turnEventOf(timing: 'startOfTurn' | 'endOfTurn'): EffectTriggerEvent {
  return timing === 'startOfTurn' ? 'turnStart' : 'turnEnd';
}

/**
 * Разовое срабатывание эффекта: спасбросок и урон при наложении на цель или при
 * входе и выходе. Событие — по доставке; у эффекта «на носителе» и «пока внутри»
 * разового срабатывания нет (поля там не работают).
 *
 * Гейты повторяют `resolveEffectApplication` (`effectAutomation.ts`): без своего
 * спасброска «провал» — это непройденная защита действия или заклинания.
 *
 * @param effect - эффект
 * @returns срабатывание либо `null`
 */
function readLandingTrigger(effect: ActiveEffect): EffectTrigger | null {
  const hasDamage = (effect.damageParts?.length ?? 0) > 0;

  const hasLanding =
    effect.applySave !== undefined
    || hasDamage
    || effect.applyOnSuccess === true
    || effect.applyOnSuccessOnly === true;

  let event: EffectTriggerEvent | null = null;

  if (effect.effectTarget === 'target') {
    event = 'applied';
  } else if (effect.areaTrigger === 'enter' || effect.areaTrigger === 'exit') {
    event = effect.areaTrigger;
  }

  if (!hasLanding || !event) {
    return null;
  }

  const halfDamage = effect.applySave?.onSuccess === 'half';

  let damageGate: EffectTriggerActionGate = halfDamage ? 'always' : 'failed';
  let effectGate: EffectTriggerActionGate = 'failed';

  if (effect.applyOnSuccessOnly) {
    damageGate = 'saved';
    effectGate = 'saved';
  } else if (effect.applyOnSuccess) {
    effectGate = 'always';
  }

  const actions: EffectTriggerAction[] = [];

  if (hasDamage && effect.damageParts) {
    actions.push({
      type: 'damage',
      parts: effect.damageParts,
      on: damageGate,
      ...(damageGate === 'always' && halfDamage
        ? { halfOnSave: true as const }
        : {}),
    });
  }

  actions.push({ type: 'applySelf', on: effectGate });

  return {
    id: LEGACY_TRIGGER_IDS.landing,
    event,
    ...(effect.applySave
      ? {
          save: {
            ability: effect.applySave.ability,
            dc: effect.applySave.dc,
          },
        }
      : {}),
    actions,
  };
}

/**
 * Срабатывания из старых полей хода и атаки.
 *
 * @param effect - эффект
 * @returns срабатывания в порядке полей
 */
function readLegacyListTriggers(effect: ActiveEffect): EffectTrigger[] {
  const triggers: EffectTrigger[] = [];
  const { recurringDamage, recurringSave, consumeOn } = effect;

  if (recurringDamage) {
    const { save } = recurringDamage;
    const half = save?.onSuccess === 'half';

    triggers.push({
      id: LEGACY_TRIGGER_IDS.recurringDamage,
      event: turnEventOf(recurringDamage.timing),
      ...(save ? { save: { ability: save.ability, dc: save.dc } } : {}),
      actions: [
        {
          type: 'damage',
          parts: recurringDamage.damageParts,
          on: save && !half ? 'failed' : 'always',
          ...(half ? { halfOnSave: true as const } : {}),
        },
      ],
    });
  }

  if (recurringSave) {
    triggers.push({
      id: LEGACY_TRIGGER_IDS.recurringSave,
      event: turnEventOf(recurringSave.timing),
      save: { ability: recurringSave.ability, dc: recurringSave.dc },
      actions: [{ type: 'removeSelf', on: 'saved' }],
    });
  }

  if (consumeOn) {
    triggers.push({
      id: LEGACY_TRIGGER_IDS.consumeOn,
      event: 'attackRoll',
      role: consumeOn === 'carrierAttack' ? 'attacker' : 'target',
      actions: [{ type: 'removeSelf', on: 'always' }],
    });
  }

  return triggers;
}

/**
 * Все срабатывания эффекта: разовое при наложении или входе, старые поля хода и
 * атаки, затем явные `triggers`.
 *
 * Результат кэшируется по объекту эффекта и не должен мутироваться.
 *
 * @param effect - эффект
 * @returns срабатывания
 */
export function collectEffectTriggers(
  effect: ActiveEffect,
): readonly EffectTrigger[] {
  const cached = collectedTriggers.get(effect);

  if (cached) {
    return cached;
  }

  const landing = readLandingTrigger(effect);

  const triggers = [
    ...(landing ? [landing] : []),
    ...readLegacyListTriggers(effect),
    ...(effect.triggers ?? []),
  ];

  collectedTriggers.set(effect, triggers);

  return triggers;
}

/**
 * Срабатывания списка «Срабатывания» — всё, кроме разового при наложении или
 * входе: его настраивают шаги «Когда срабатывает», «Спасбросок» и «Урон».
 *
 * @param effect - эффект
 * @returns срабатывания списка
 */
export function listEffectListTriggers(
  effect: ActiveEffect,
): readonly EffectTrigger[] {
  return collectEffectTriggers(effect).filter(
    (trigger) => trigger.id !== LEGACY_TRIGGER_IDS.landing,
  );
}

/**
 * Простое срабатывание: без роли, условия и лимита, ход — субъекта.
 *
 * @param trigger - срабатывание
 * @returns `true`, если ничего сверх события, спасброска и действий нет
 */
function isPlainTrigger(trigger: EffectTrigger): boolean {
  return (
    trigger.condition === undefined
    && trigger.limit === undefined
    && (trigger.turnOf === undefined || trigger.turnOf === 'subject')
  );
}

/**
 * Какое старое поле выражает срабатывание без потерь.
 *
 * @param trigger - срабатывание
 * @returns вид старого поля либо `null`
 */
export function classifyLegacyTrigger(
  trigger: EffectTrigger,
): LegacyTriggerKind | null {
  if (!isPlainTrigger(trigger) || trigger.actions.length !== 1) {
    return null;
  }

  const [action] = trigger.actions;
  const isTurn = trigger.event === 'turnStart' || trigger.event === 'turnEnd';
  const gate = resolveTriggerActionGate(trigger, action);

  if (isTurn && trigger.role === undefined && action.type === 'damage') {
    if (!trigger.save) {
      return gate === 'always' && !action.halfOnSave ? 'recurringDamage' : null;
    }

    const negate = gate === 'failed' && !action.halfOnSave;
    const half = gate === 'always' && action.halfOnSave === true;

    return negate || half ? 'recurringDamage' : null;
  }

  if (
    isTurn
    && trigger.role === undefined
    && trigger.save
    && action.type === 'removeSelf'
    && gate === 'saved'
  ) {
    return 'recurringSave';
  }

  if (
    trigger.event === 'attackRoll'
    && trigger.role !== undefined
    && trigger.turnOf === undefined
    && !trigger.save
    && action.type === 'removeSelf'
    && gate === 'always'
  ) {
    return 'consumeOn';
  }

  return null;
}

/**
 * Старое поле по срабатыванию, которое оно выражает.
 *
 * @param kind - вид старого поля
 * @param trigger - срабатывание того же вида
 * @returns поля эффекта
 */
function toLegacyFields(
  kind: LegacyTriggerKind,
  trigger: EffectTrigger,
): Pick<ActiveEffect, 'recurringDamage' | 'recurringSave' | 'consumeOn'> {
  const [action] = trigger.actions;
  const timing = trigger.event === 'turnStart' ? 'startOfTurn' : 'endOfTurn';

  if (kind === 'recurringDamage' && action.type === 'damage') {
    return {
      recurringDamage: {
        damageParts: action.parts,
        timing,
        ...(trigger.save
          ? {
              save: {
                ...trigger.save,
                onSuccess: action.halfOnSave ? 'half' : 'negate',
              },
            }
          : {}),
      },
    };
  }

  if (kind === 'recurringSave' && trigger.save) {
    return { recurringSave: { ...trigger.save, timing } };
  }

  return {
    consumeOn: trigger.role === 'target' ? 'attackOnCarrier' : 'carrierAttack',
  };
}

/**
 * Записывает список «Срабатывания» в эффект: выражаемое старым полем — в него,
 * остальное — в `triggers`. Разовое срабатывание при наложении или входе список
 * не трогает. Старые поля, которых в списке больше нет, снимаются.
 *
 * @param effect - эффект
 * @param triggers - строки списка
 * @returns новый эффект
 */
export function writeEffectTriggers(
  effect: ActiveEffect,
  triggers: readonly EffectTrigger[],
): ActiveEffect {
  const legacy: Pick<
    ActiveEffect,
    'recurringDamage' | 'recurringSave' | 'consumeOn'
  > = {};

  const explicit: EffectTrigger[] = [];

  for (const trigger of triggers) {
    if (trigger.id === LEGACY_TRIGGER_IDS.landing) {
      continue;
    }

    const kind = classifyLegacyTrigger(trigger);

    if (kind && legacy[kind] === undefined) {
      Object.assign(legacy, toLegacyFields(kind, trigger));

      continue;
    }

    explicit.push(
      isLegacyTrigger(trigger)
        ? { ...trigger, id: generateId(TRIGGER_ID_PREFIX) }
        : trigger,
    );
  }

  return {
    ...effect,
    recurringDamage: legacy.recurringDamage,
    recurringSave: legacy.recurringSave,
    consumeOn: legacy.consumeOn,
    triggers: explicit.length > 0 ? explicit : undefined,
  };
}
