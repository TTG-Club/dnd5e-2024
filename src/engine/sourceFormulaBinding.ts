/**
 * Подстановка чисел ИСТОЧНИКА в формулы эффекта.
 *
 * Эффект, который источник отдаёт другим, считается по источнику: «Аура
 * защиты» даёт союзникам модификатор Харизмы ПАЛАДИНА, «Лунный луч» бьёт с
 * модификатором заклинателя. Пайплайн же читает формулы строк в контексте
 * носителя, а сервер пропускает части урона с `@`. Поэтому, пока источник под
 * рукой, его токены превращаются в числа — остальные (`@dmg.*`, `@heal`,
 * `@target.*`, `@speed.*`) остаются: они относятся к цели и броску.
 *
 * @module system/dnd/sourceFormulaBinding
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect, EffectChange } from './activeEffectTypes.js';
import type { FormulaContext } from './formulaParser.js';

import { evaluateFormula } from './formulaParser.js';

/**
 * Токены, которые принадлежат источнику: модификаторы и значения
 * характеристик, модификатор заклинания, бонус мастерства, уровни.
 */
const SOURCE_TOKEN_PATTERN =
  /@(?:mod\.(?:str|dex|con|int|wis|cha|spell)|prof|classLevel|level|str|dex|con|int|wis|cha)\b/g;

/** Тот же токен — для проверки наличия, без позиции поиска у глобального */
const SOURCE_TOKEN_PROBE = new RegExp(SOURCE_TOKEN_PATTERN.source, 'u');

/** Есть ли в строке токен источника */
function hasSourceToken(value: string | undefined): boolean {
  return value !== undefined && SOURCE_TOKEN_PROBE.test(value);
}

/**
 * Подставляет числа источника в одну формулу. Токен, который в контексте не
 * посчитать (`@mod.spell` вне каста), остаётся как есть.
 *
 * @param formula - формула
 * @param context - контекст источника
 * @returns формула с числами источника
 */
export function bindSourceFormula(
  formula: string,
  context: FormulaContext,
): string {
  if (!hasSourceToken(formula)) {
    return formula;
  }

  return formula.replace(SOURCE_TOKEN_PATTERN, (token) => {
    try {
      const value = evaluateFormula(token, context);

      return value < 0 ? `(${value})` : String(value);
    } catch {
      return token;
    }
  });
}

/** Подставляет числа источника в строку модификатора */
function bindChange(
  change: EffectChange,
  context: FormulaContext,
): EffectChange {
  return hasSourceToken(change.value)
    ? { ...change, value: bindSourceFormula(change.value, context) }
    : change;
}

/** Подставляет числа источника в часть урона */
function bindDamagePart(part: DamagePart, context: FormulaContext): DamagePart {
  if (!hasSourceToken(part.formula) && !hasSourceToken(part.versatileFormula)) {
    return part;
  }

  return {
    ...part,
    formula: bindSourceFormula(part.formula, context),
    ...(part.versatileFormula === undefined
      ? {}
      : {
          versatileFormula: bindSourceFormula(part.versatileFormula, context),
        }),
  };
}

/**
 * Есть ли в эффекте формулы, которые считаются от источника.
 *
 * @param effect - эффект
 * @returns `true`, если подставлять есть что
 */
export function effectUsesSourceFormulas(effect: ActiveEffect): boolean {
  return (
    effect.changes.some((change) => hasSourceToken(change.value))
    || (effect.damageParts ?? []).some(
      (part) =>
        hasSourceToken(part.formula) || hasSourceToken(part.versatileFormula),
    )
    || (effect.recurringDamage?.damageParts ?? []).some(
      (part) =>
        hasSourceToken(part.formula) || hasSourceToken(part.versatileFormula),
    )
  );
}

/**
 * Копия эффекта с числами источника в модификаторах и уроне.
 *
 * @param effect - эффект
 * @param context - контекст источника
 * @returns исходный эффект, если подставлять нечего, иначе копия
 */
export function bindSourceEffectFormulas(
  effect: ActiveEffect,
  context: FormulaContext,
): ActiveEffect {
  if (!effectUsesSourceFormulas(effect)) {
    return effect;
  }

  return {
    ...effect,
    changes: effect.changes.map((change) => bindChange(change, context)),
    ...(effect.damageParts === undefined
      ? {}
      : {
          damageParts: effect.damageParts.map((part) =>
            bindDamagePart(part, context),
          ),
        }),
    ...(effect.recurringDamage === undefined
      ? {}
      : {
          recurringDamage: {
            ...effect.recurringDamage,
            damageParts: effect.recurringDamage.damageParts.map((part) =>
              bindDamagePart(part, context),
            ),
          },
        }),
  };
}
