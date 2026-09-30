/**
 * Подстановка ОДНОГО числа вместо токена во все формулы эффекта.
 *
 * Так живут числа, которые известны только снаружи эффекта и одинаковы для
 * всех его формул: уровень своего класса (`@classLevel`,
 * `classEffectScope.ts`) и круг ячейки каста (`@castLevel`,
 * `sourceFormulaBinding.ts`). Обход один на оба числа: новое поле с формулой
 * добавляется сюда — и доходит до обеих подстановок сразу.
 *
 * Где формулы: строки модификаторов (значение и условие), урон при наложении и
 * каждый ход, урон, лечение и хиты действий срабатываний, радиус ауры
 * формулой, срок формулой, сохранённый бросок и Сл формулой.
 *
 * @module system/dnd/effectTokenBinding
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect, EffectChange } from './activeEffectTypes.js';
import type { EffectTrigger } from './effectTriggerTypes.js';

import { resolveDiceCountExpressions } from './diceCountExpressions.js';
import { listEffectSaveDcs, mapEffectSaveDcs } from './effectSaveDc.js';

/**
 * Токен целиком: `@classLevels` или `@castLevelX` — не он, и подменять в них
 * начало нельзя.
 *
 * @param token - токен с `@`
 * @returns регэксп всех вхождений
 */
function tokenPattern(token: string): RegExp {
  return new RegExp(`${token}\\b`, 'g');
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

/** Есть ли токен в формулах срабатывания: урон, лечение, хиты */
function triggerHasToken(trigger: EffectTrigger, token: string): boolean {
  return trigger.actions.some((action) => {
    switch (action.type) {
      case 'damage':
        return action.parts.some((part) => partHasToken(part, token));
      case 'tempHp':
      case 'reduceMaxHp':
        return hasToken(action.amount, token);
      default:
        return false;
    }
  });
}

/** Подставляет число в формулы действий срабатывания */
function bindTrigger(
  trigger: EffectTrigger,
  token: string,
  replacement: number,
): EffectTrigger {
  if (!triggerHasToken(trigger, token)) {
    return trigger;
  }

  return {
    ...trigger,
    actions: trigger.actions.map((action) => {
      switch (action.type) {
        case 'damage':
          return {
            ...action,
            parts: action.parts.map((part) =>
              bindPart(part, token, replacement),
            ),
          };
        case 'tempHp':
        case 'reduceMaxHp':
          return {
            ...action,
            amount: bindFormula(action.amount, token, replacement),
          };
        default:
          return action;
      }
    }),
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
      triggerHasToken(trigger, token),
    )
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
            bindTrigger(trigger, token, replacement),
          ),
        }),
  };
}
