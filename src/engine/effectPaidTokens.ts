/**
 * Подстановка потраченного ценой (`@paid.*`) в формулы.
 *
 * Потраченное — числа, известные только после оплаты: круг ячейки, число и
 * грань костей хитов, сумма их броска. Живут они так же, как круг каста
 * (`@castLevel`): при наложении токены во всех формулах эффекта становятся
 * числами, а сами числа остаются у эффекта полем `paid`.
 *
 * Переключатель — исключение: он лежит на листе шаблоном и включается много
 * раз, поэтому числа в его формулы не вписываются, а подставляются при чтении
 * ({@link bindLivePaid}) — в единственных точках сбора: статы листа
 * (`collectActiveEffects`) и срабатывания (`buildTriggerSources`).
 *
 * @module system/dnd/effectPaidTokens
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { EffectPaid } from './effectPayTypes.js';
import type { EffectTrigger } from './effectTriggerTypes.js';

import { FORMULA_VARIABLE_LABELS } from './consts.js';
import { resolveDiceCountExpressions } from './diceCountExpressions.js';
import {
  EFFECT_PAID_FIELDS,
  PAID_TOKEN_PREFIX,
  paidTokenOf,
} from './effectPayTypes.js';
import { bindEffectToken, bindTriggerToken } from './effectTokenBinding.js';

/** Все вхождения токенов потраченного в строке */
const PAID_TOKEN_PATTERN = /@paid\.([a-z]+)\b/gi;

/**
 * Есть ли в строке токен потраченного.
 *
 * @param value - формула
 * @returns `true`, если есть хоть один `@paid.*`
 */
export function hasPaidToken(value: string | undefined): boolean {
  return value !== undefined && value.includes(PAID_TOKEN_PREFIX);
}

/**
 * Число потраченного по имени поля из токена. Платёж, которого не было, — ноль:
 * `@paid.slotLevel` у цены без ячейки не должен ронять формулу.
 *
 * @param paid - потраченное
 * @param field - имя поля из токена
 * @returns число либо `undefined`, если такого токена нет
 */
function readPaidField(paid: EffectPaid, field: string): number | undefined {
  const known = EFFECT_PAID_FIELDS.find((entry) => entry === field);

  return known === undefined ? undefined : (paid[known] ?? 0);
}

/**
 * Подставляет потраченное в одну формулу. Число костей выражением
 * (`(@paid.hitDice)к(@paid.hitDie)`) тут же становится числом. Незнакомый
 * токен `@paid.*` остаётся как есть.
 *
 * @param formula - формула
 * @param paid - потраченное
 * @returns формула с числами
 */
export function bindPaidFormula(formula: string, paid: EffectPaid): string {
  if (!hasPaidToken(formula)) {
    return formula;
  }

  return resolveDiceCountExpressions(
    formula.replace(PAID_TOKEN_PATTERN, (token, field: string) => {
      const value = readPaidField(paid, field);

      return value === undefined ? token : String(value);
    }),
  );
}

/**
 * Формула с подписями вместо токенов потраченного — для показа до оплаты:
 * числа ещё неизвестны, а сырой токен читать нельзя.
 *
 * @param formula - формула
 * @returns формула с подписями
 */
export function labelPaidTokens(formula: string): string {
  return hasPaidToken(formula)
    ? formula.replace(
        PAID_TOKEN_PATTERN,
        (token) => FORMULA_VARIABLE_LABELS[token] ?? token,
      )
    : formula;
}

/**
 * Подставляет потраченное в часть урона.
 *
 * @param part - часть урона
 * @param paid - потраченное
 * @returns часть урона с числами
 */
export function bindPaidDamagePart(
  part: DamagePart,
  paid: EffectPaid,
): DamagePart {
  if (!hasPaidToken(part.formula) && !hasPaidToken(part.versatileFormula)) {
    return part;
  }

  return {
    ...part,
    formula: bindPaidFormula(part.formula, paid),
    ...(part.versatileFormula === undefined
      ? {}
      : { versatileFormula: bindPaidFormula(part.versatileFormula, paid) }),
  };
}

/**
 * Копия эффекта с потраченным во всех формулах. Эффект без токенов
 * возвращается как есть.
 *
 * @param effect - эффект
 * @param paid - потраченное
 * @returns эффект с числами
 */
export function bindEffectPaid(
  effect: ActiveEffect,
  paid: EffectPaid,
): ActiveEffect {
  return EFFECT_PAID_FIELDS.reduce(
    (bound, field) =>
      bindEffectToken(bound, paidTokenOf(field), paid[field] ?? 0),
    effect,
  );
}

/**
 * Копия срабатывания с потраченным в формулах действий.
 *
 * @param trigger - срабатывание
 * @param paid - потраченное
 * @returns срабатывание с числами
 */
export function bindTriggerPaid(
  trigger: EffectTrigger,
  paid: EffectPaid,
): EffectTrigger {
  return EFFECT_PAID_FIELDS.reduce(
    (bound, field) =>
      bindTriggerToken(bound, paidTokenOf(field), paid[field] ?? 0),
    trigger,
  );
}

/**
 * Эффект с потраченным, записанным при оплате, — для чтения. Так читается
 * включённый переключатель: его формулы остаются шаблоном, а числа берутся из
 * `paid`. У эффекта без оплаты это тот же объект — проверка одна и дешёвая.
 *
 * @param effect - эффект носителя
 * @returns эффект с числами либо тот же эффект
 */
export function bindLivePaid(effect: ActiveEffect): ActiveEffect {
  return effect.paid === undefined
    ? effect
    : bindEffectPaid(effect, effect.paid);
}

/**
 * Эффект, наложенный после оплаты: потраченное вписано в формулы и записано
 * полем `paid`, цена снята — наложенная копия второй раз не платит.
 *
 * Переключатель формулы сохраняет: он включается снова, и числа у следующего
 * включения будут другими — ему записывается только `paid`.
 *
 * @param effect - эффект источника
 * @param paid - потраченное
 * @param keepTemplate - формулы не трогать (переключатель)
 * @returns эффект с потраченным
 */
export function stampEffectPaid(
  effect: ActiveEffect,
  paid: EffectPaid,
  keepTemplate = false,
): ActiveEffect {
  if (keepTemplate) {
    return { ...effect, paid };
  }

  const { pay: _pay, ...bound } = bindEffectPaid(effect, paid);

  return { ...bound, paid };
}

/**
 * Эффект, который несёт только цену: у заклинания, чей урон записан в его
 * собственных полях, цене каста больше негде жить — она лежит в эффекте без
 * нагрузки. Такой эффект после оплаты никому не достаётся.
 *
 * @param effect - эффект источника
 * @returns `true`, если кроме цены эффект ничего не делает
 */
export function isPriceOnlyEffect(effect: ActiveEffect): boolean {
  return (
    effect.pay !== undefined
    && effect.changes.length === 0
    && effect.flags.length === 0
    && effect.conditionKey === undefined
    && effect.tag === undefined
    && (effect.triggers?.length ?? 0) === 0
    && (effect.damageParts?.length ?? 0) === 0
    && effect.recurringDamage === undefined
    && effect.recurringSave === undefined
    && effect.aura === undefined
    && effect.light === undefined
    && effect.saveOverride === undefined
    && (effect.conditionImmunities?.length ?? 0) === 0
    && (effect.suppressConditions?.length ?? 0) === 0
    && effect.escape === undefined
    && (effect.stages?.length ?? 0) === 0
  );
}

/** Что оплачено: заклинание, применение предмета или эффекта */
export interface PaidSource {
  activeEffects?: ActiveEffect[];
  damageParts?: DamagePart[];
}

/**
 * Источник после оплаты: потраченное вписано в его эффекты и в его
 * собственный урон и лечение («урон равен броску потраченных Костей Хитов» —
 * в полях самого заклинания).
 *
 * @param source - заклинание или псевдо-заклинание применения
 * @param paid - потраченное
 * @returns источник с числами
 */
export function bindSourcePaid<Source extends PaidSource>(
  source: Source,
  paid: EffectPaid,
): Source {
  return {
    ...source,
    ...(source.activeEffects === undefined
      ? {}
      : {
          // Эффект, который только называет цену, после оплаты своё сделал:
          // накладывать его не на кого
          activeEffects: source.activeEffects
            .filter((effect) => !isPriceOnlyEffect(effect))
            .map((effect) => stampEffectPaid(effect, paid)),
        }),
    ...(source.damageParts === undefined
      ? {}
      : {
          damageParts: source.damageParts.map((part) =>
            bindPaidDamagePart(part, paid),
          ),
        }),
  };
}
