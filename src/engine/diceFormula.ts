/**
 * Минимальный разбор и бросок кубиковой формулы — server-safe (без внешних
 * зависимостей и без рандом-движка клиента).
 *
 * Поддерживает слагаемые вида `NкM` / `NдM` / `NdM` (кубики) и плоские числа,
 * соединённые `+`/`−`. Бросок используется серверным рантаймом периодического
 * урона (DoT): на клиенте бросок делает rpg-dice-roller, но сервер тикает урон
 * сам. Разбор слагаемых нужен и без броска — формуле хитов существа, где из
 * записи компендиума берётся только число костей.
 *
 * НЕ поддерживает `@`-токены и продвинутую нотацию (kh/kl и т.п.) — токены
 * `@dmg.<type>` нужно снять заранее (через разбор сегментов), а сложные броски
 * для периодического урона не используются.
 */

/** Регэксп одного кубикового слагаемого: `2к6`, `1д8`, `3d10` */
const DICE_TERM_REGEX = /^(\d+)[кдd](\d+)$/i;

/** Кубиковое слагаемое формулы: число костей и граней */
export interface DiceFormulaTerm {
  /** Число костей */
  count: number;
  /** Число граней кости */
  sides: number;
}

/** Слагаемое формулы после разбиения по знакам */
interface SignedFormulaTerm {
  /** Знак слагаемого */
  sign: 1 | -1;
  /** Тело слагаемого без знака: `2к6` или `3` */
  body: string;
}

/**
 * Разбивает формулу на слагаемые со знаком. Пробелы снимаются заранее:
 * «2к6 + 3» и «2к6+3» — одна и та же формула.
 *
 * @param formula - формула без `@`-токенов
 * @returns слагаемые в порядке записи
 */
function splitFormulaTerms(formula: string): SignedFormulaTerm[] {
  const normalized = formula.replace(/\s+/g, '');
  const terms = normalized.match(/[+-]?[^+-]+/g) ?? [];

  return terms.map((term) => ({
    sign: term.startsWith('-') ? -1 : 1,
    body: term.replace(/^[+-]/, ''),
  }));
}

/**
 * Разбирает кубиковое слагаемое; плоское число и мусор — `undefined`.
 *
 * @param body - тело слагаемого без знака
 * @returns число костей и граней
 */
function parseDiceTerm(body: string): DiceFormulaTerm | undefined {
  const diceMatch = body.match(DICE_TERM_REGEX);

  if (!diceMatch) {
    return undefined;
  }

  return {
    count: Number.parseInt(diceMatch[1], 10),
    sides: Number.parseInt(diceMatch[2], 10),
  };
}

/**
 * Первое кубиковое слагаемое формулы: «4к10 + 4» → 4 кости по 10 граней.
 *
 * @param formula - формула без `@`-токенов
 * @returns кубиковое слагаемое, либо `undefined`, если в формуле одни числа
 */
export function findFirstDiceTerm(
  formula: string,
): DiceFormulaTerm | undefined {
  for (const term of splitFormulaTerms(formula)) {
    const dice = parseDiceTerm(term.body);

    if (dice) {
      return dice;
    }
  }

  return undefined;
}

/**
 * Бросает кубиковую формулу и возвращает сумму и выпавшие значения кубиков.
 *
 * @param formula - формула без `@`-токенов (напр. «2к6 + 3»)
 * @returns сумма броска и массив выпавших значений (для отображения)
 */
export function rollDamageFormula(formula: string): {
  total: number;
  values: number[];
} {
  const values: number[] = [];

  let total = 0;

  for (const term of splitFormulaTerms(formula)) {
    const dice = parseDiceTerm(term.body);

    if (dice) {
      for (let rollIndex = 0; rollIndex < dice.count; rollIndex++) {
        const roll = Math.floor(Math.random() * dice.sides) + 1;

        values.push(roll);
        total += term.sign * roll;
      }

      continue;
    }

    const flat = Number.parseInt(term.body, 10);

    if (!Number.isNaN(flat)) {
      total += term.sign * flat;
    }
  }

  return { total, values };
}
