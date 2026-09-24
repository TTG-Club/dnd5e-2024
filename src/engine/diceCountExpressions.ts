/**
 * Число костей выражением: `(1 + steps(@classLevel, 7, 13, 18))к8`.
 *
 * Правила растят урон числом костей по ступеням уровня — «Божественная
 * искра» бьёт 1к8 на 2 уровне жреца и 4к8 на 18-м. Кубиковый бросок понимает
 * только число перед буквой кости, поэтому выражение в скобках перед `к`/`d`
 * считается заранее — когда числа источника в него уже подставлены — и
 * заменяется числом. Формула остаётся строкой: справочник сайта хранит её без
 * новых полей.
 *
 * @module system/dnd/diceCountExpressions
 */

import { evaluateDetachedFormula } from './formulaParser.js';

/** Буква кости сразу за закрывающей скобкой: `)к8`, `) d6` */
const DICE_AFTER_PAREN = /\)\s*[кдd]\d/i;

/** Буква имени функции перед открывающей скобкой: `steps(` */
const FUNCTION_NAME_CHAR = /[a-z_]/i;

/**
 * Начало выражения, которое закрывает скобка на позиции `closeIndex`: парная
 * открывающая скобка и имя функции перед ней, если оно есть.
 *
 * @param formula - формула
 * @param closeIndex - позиция закрывающей скобки
 * @returns позиция начала выражения либо `undefined`, если пары нет
 */
function findExpressionStart(
  formula: string,
  closeIndex: number,
): number | undefined {
  let depth = 0;

  for (let index = closeIndex; index >= 0; index--) {
    const char = formula[index];

    if (char === ')') {
      depth++;
    } else if (char === '(') {
      depth--;
    }

    if (depth === 0) {
      let start = index;

      while (start > 0 && FUNCTION_NAME_CHAR.test(formula[start - 1])) {
        start--;
      }

      return start;
    }
  }

  return undefined;
}

/**
 * Считает выражения числа костей: `(1 + steps(7, 7, 13, 18))к8 + 3` →
 * `2к8 + 3`. Выражение с неподставленным `@`-токеном и то, что не
 * считается, остаются как есть — бросок их пропустит, как и раньше.
 * Дробное число костей округляется вниз, отрицательное становится нулём.
 *
 * @param formula - формула урона или лечения
 * @returns формула с числами костей
 */
export function resolveDiceCountExpressions(formula: string): string {
  let result = formula;
  let searchFrom = 0;

  while (searchFrom < result.length) {
    const match = DICE_AFTER_PAREN.exec(result.slice(searchFrom));

    if (!match) {
      break;
    }

    const closeIndex = searchFrom + match.index;
    const start = findExpressionStart(result, closeIndex);

    const count =
      start === undefined
        ? undefined
        : evaluateDetachedFormula(result.slice(start, closeIndex + 1));

    if (start === undefined || count === undefined) {
      searchFrom = closeIndex + 1;

      continue;
    }

    const dieCount = String(Math.max(0, Math.floor(count)));

    // Пробел между скобкой и буквой кости уходит вместе с выражением
    const letterIndex = closeIndex + match[0].length - 2;

    result = `${result.slice(0, start)}${dieCount}${result.slice(letterIndex)}`;
    searchFrom = start + dieCount.length;
  }

  return result;
}
