/**
 * Подстановка ОДНОГО числа вместо токена во все формулы эффекта.
 *
 * Так живут числа, которые известны только снаружи эффекта и одинаковы для
 * всех его формул: уровень своего класса (`@classLevel`,
 * `classEffectScope.ts`), круг ячейки каста (`@castLevel`,
 * `sourceFormulaBinding.ts`) и потраченное ценой (`@paid.*`,
 * `effectPaidTokens.ts`). Обход один на все числа: новое поле с формулой
 * добавляется сюда — и доходит до всех подстановок сразу.
 *
 * Где формулы: строки модификаторов (значение и условие), урон при наложении и
 * каждый ход, формулы действий срабатываний (урон, лечение, хиты, возврат
 * ресурса, срок наложенного, текст сообщения), количество цены, радиус ауры
 * формулой, срок формулой, сохранённый бросок и Сл формулой.
 *
 * @module system/dnd/effectTokenBinding
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect, EffectChange } from './activeEffectTypes.js';
import type { EffectPay } from './effectPayTypes.js';
import type {
  EffectTrigger,
  EffectTriggerAction,
} from './effectTriggerTypes.js';

import { resolveDiceCountExpressions } from './diceCountExpressions.js';
import { priceHasAmount } from './effectPayTypes.js';
import { listEffectSaveDcs, mapEffectSaveDcs } from './effectSaveDc.js';

/**
 * Токен целиком: `@classLevels` или `@castLevelX` — не он, и подменять в них
 * начало нельзя.
 *
 * @param token - токен с `@`
 * @returns регэксп всех вхождений
 */
function tokenPattern(token: string): RegExp {
  // Точка в токене (`@paid.hitDice`) — буква токена, а не «любой символ»
  return new RegExp(`${token.replaceAll('.', String.raw`\.`)}\\b`, 'g');
}

/**
 * Есть ли токен в строке.
 *
 * @param value - формула
 * @param token - токен с `@`
 * @returns `true`, если токен есть
 */
function hasToken(value: string | undefined, token: string): boolean {
  return value !== undefined && tokenPattern(token).test(value);
}

/**
 * Подставляет число в формулу. Число костей выражением
 * (`(1 + steps(@classLevel, 7, 13, 18))к8`, `(@castLevel)к10`) тут же
 * становится числом.
 *
 * @param value - формула
 * @param token - токен с `@`
 * @param replacement - число
 * @returns формула с числом
 */
function bindFormula(
  value: string,
  token: string,
  replacement: number,
): string {
  return hasToken(value, token)
    ? resolveDiceCountExpressions(
        value.replace(tokenPattern(token), String(replacement)),
      )
    : value;
}

/** Есть ли токен в части урона */
function partHasToken(part: DamagePart, token: string): boolean {
  return (
    hasToken(part.formula, token) || hasToken(part.versatileFormula, token)
  );
}

/** Подставляет число в часть урона */
function bindPart(
  part: DamagePart,
  token: string,
  replacement: number,
): DamagePart {
  if (!partHasToken(part, token)) {
    return part;
  }

  return {
    ...part,
    formula: bindFormula(part.formula, token, replacement),
    ...(part.versatileFormula === undefined
      ? {}
      : {
          versatileFormula: bindFormula(
            part.versatileFormula,
            token,
            replacement,
          ),
        }),
  };
}

/** Подставляет число в строку модификатора */
function bindChange(
  change: EffectChange,
  token: string,
  replacement: number,
): EffectChange {
  if (!hasToken(change.value, token) && !hasToken(change.condition, token)) {
    return change;
  }

  return {
    ...change,
    value: bindFormula(change.value, token, replacement),
    ...(change.condition === undefined
      ? {}
      : { condition: bindFormula(change.condition, token, replacement) }),
  };
}

/**
 * Формулы платежей цены: количество и верхняя граница выбора.
 *
 * @param pay - цена
 * @returns формулы
 */
function listPayFormulas(pay: EffectPay | undefined): string[] {
  return (pay ?? []).flatMap((price) =>
    priceHasAmount(price)
      ? [price.amount, price.max].filter((formula) => formula !== undefined)
      : [],
  );
}

/**
 * Подставляет число в формулы платежей цены.
 *
 * @param pay - цена
 * @param bind - подстановка в одну формулу
 * @returns цена с числами
 */
function mapPayFormulas(
  pay: EffectPay,
  bind: (formula: string) => string,
): EffectPay {
  return pay.map((price) =>
    priceHasAmount(price)
      ? {
          ...price,
          ...(price.amount === undefined ? {} : { amount: bind(price.amount) }),
          ...(price.max === undefined ? {} : { max: bind(price.max) }),
        }
      : price,
  );
}

/**
 * Формулы одного действия срабатывания: урон и лечение, хиты, временные хиты,
 * возврат ресурса, срок наложенного и текст сообщения с его броском.
 *
 * Один перечень на «есть ли токен» и на подстановку: новое поле с формулой
 * добавляется здесь и в {@link mapActionFormulas} — и доходит до всех чисел,
 * которые подставляются снаружи.
 *
 * @param action - действие
 * @returns формулы действия
 */
function listActionFormulas(action: EffectTriggerAction): string[] {
  switch (action.type) {
    case 'damage':
      return action.parts.flatMap((part) =>
        part.versatileFormula === undefined
          ? [part.formula]
          : [part.formula, part.versatileFormula],
      );
    case 'tempHp':
    case 'reduceMaxHp':
      return [action.amount];
    case 'restore':
      return action.amount === undefined ? [] : [action.amount];
    case 'setHp':
      return action.formula === undefined ? [] : [action.formula];
    case 'applyCondition':
    case 'applyTag':
      return action.durationFormula === undefined
        ? []
        : [action.durationFormula];
    case 'notify':
      return action.roll === undefined
        ? [action.text]
        : [action.text, action.roll];
    case 'dispel':
      return action.maxLevelFormula === undefined
        ? []
        : [action.maxLevelFormula];
    default:
      return [];
  }
}

/**
 * Копия действия с подстановкой во все его формулы.
 *
 * @param action - действие
 * @param bind - подстановка в одну формулу
 * @param bindDamagePart - подстановка в часть урона
 * @returns действие с числами
 */
function mapActionFormulas(
  action: EffectTriggerAction,
  bind: (formula: string) => string,
  bindDamagePart: (part: DamagePart) => DamagePart,
): EffectTriggerAction {
  switch (action.type) {
    case 'damage':
      return { ...action, parts: action.parts.map(bindDamagePart) };
    case 'tempHp':
    case 'reduceMaxHp':
      return { ...action, amount: bind(action.amount) };
    case 'restore':
      return action.amount === undefined
        ? action
        : { ...action, amount: bind(action.amount) };
    case 'setHp':
      return action.formula === undefined
        ? action
        : { ...action, formula: bind(action.formula) };
    case 'applyCondition':
    case 'applyTag':
      return action.durationFormula === undefined
        ? action
        : { ...action, durationFormula: bind(action.durationFormula) };
    case 'notify':
      return {
        ...action,
        text: bind(action.text),
        ...(action.roll === undefined ? {} : { roll: bind(action.roll) }),
      };
    case 'dispel':
      return action.maxLevelFormula === undefined
        ? action
        : { ...action, maxLevelFormula: bind(action.maxLevelFormula) };
    default:
      return action;
  }
}

/**
 * Есть ли токен в формулах срабатывания: в действиях и в цене.
 *
 * @param trigger - срабатывание
 * @param token - токен с `@`
 * @returns `true`, если подставлять есть куда
 */
export function triggerUsesToken(
  trigger: EffectTrigger,
  token: string,
): boolean {
  return (
    trigger.actions.some((action) =>
      listActionFormulas(action).some((formula) => hasToken(formula, token)),
    )
    || listPayFormulas(trigger.pay).some((formula) => hasToken(formula, token))
  );
}

/**
 * Копия срабатывания с числом вместо токена в формулах действий и цены.
 * Срабатывание без токена возвращается как есть.
 *
 * @param trigger - срабатывание
 * @param token - токен с `@`
 * @param replacement - число
 * @returns срабатывание с подставленным числом
 */
export function bindTriggerToken(
  trigger: EffectTrigger,
  token: string,
  replacement: number,
): EffectTrigger {
  if (!triggerUsesToken(trigger, token)) {
    return trigger;
  }

  /**
   * Подставляет число в одну формулу.
   *
   * @param formula - формула
   * @returns формула с числом
   */
  const bind = (formula: string): string =>
    bindFormula(formula, token, replacement);

  return {
    ...trigger,
    actions: trigger.actions.map((action) =>
      mapActionFormulas(action, bind, (part) =>
        bindPart(part, token, replacement),
      ),
    ),
    ...(trigger.pay === undefined
      ? {}
      : { pay: mapPayFormulas(trigger.pay, bind) }),
  };
}

/**
 * Есть ли токен хоть в одной формуле эффекта.
 *
 * @param effect - эффект
 * @param token - токен с `@`
 * @returns `true`, если подставлять есть куда
 */
export function effectUsesToken(effect: ActiveEffect, token: string): boolean {
  return (
    effect.changes.some(
      (change) =>
        hasToken(change.value, token) || hasToken(change.condition, token),
    )
    || (effect.damageParts ?? []).some((part) => partHasToken(part, token))
    || (effect.recurringDamage?.damageParts ?? []).some((part) =>
      partHasToken(part, token),
    )
    || hasToken(effect.aura?.radiusFormula, token)
    || hasToken(effect.durationFormula, token)
    || hasToken(effect.savedRoll, token)
    || (effect.triggers ?? []).some((trigger) =>
      triggerUsesToken(trigger, token),
    )
    || listPayFormulas(effect.pay).some((formula) => hasToken(formula, token))
    || listEffectSaveDcs(effect).some((save) => hasToken(save.dcFormula, token))
  );
}

/**
 * Копия эффекта с числом вместо токена во всех формулах. Эффект без токена
 * возвращается как есть.
 *
 * @param effect - эффект
 * @param token - токен с `@`
 * @param replacement - число
 * @returns эффект с подставленным числом
 */
export function bindEffectToken(
  effect: ActiveEffect,
  token: string,
  replacement: number,
): ActiveEffect {
  if (!effectUsesToken(effect, token)) {
    return effect;
  }

  const bound = mapEffectSaveDcs(effect, (save) =>
    save.dcFormula === undefined
      ? save
      : { ...save, dcFormula: bindFormula(save.dcFormula, token, replacement) },
  );

  const { aura, recurringDamage } = bound;

  return {
    ...bound,
    changes: bound.changes.map((change) =>
      bindChange(change, token, replacement),
    ),
    ...(bound.damageParts === undefined
      ? {}
      : {
          damageParts: bound.damageParts.map((part) =>
            bindPart(part, token, replacement),
          ),
        }),
    ...(recurringDamage === undefined
      ? {}
      : {
          recurringDamage: {
            ...recurringDamage,
            damageParts: recurringDamage.damageParts.map((part) =>
              bindPart(part, token, replacement),
            ),
          },
        }),
    ...(aura?.radiusFormula === undefined
      ? {}
      : {
          aura: {
            ...aura,
            radiusFormula: bindFormula(aura.radiusFormula, token, replacement),
          },
        }),
    ...(bound.durationFormula === undefined
      ? {}
      : {
          durationFormula: bindFormula(
            bound.durationFormula,
            token,
            replacement,
          ),
        }),
    ...(bound.savedRoll === undefined
      ? {}
      : { savedRoll: bindFormula(bound.savedRoll, token, replacement) }),
    ...(bound.triggers === undefined
      ? {}
      : {
          triggers: bound.triggers.map((trigger) =>
            bindTriggerToken(trigger, token, replacement),
          ),
        }),
    ...(bound.pay === undefined
      ? {}
      : {
          pay: mapPayFormulas(bound.pay, (formula) =>
            bindFormula(formula, token, replacement),
          ),
        }),
  };
}
