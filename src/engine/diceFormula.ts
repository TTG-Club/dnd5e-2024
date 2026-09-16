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

/** Кости одной группы броска: грани и выпавшие значения */
export interface RolledDiceGroup {
  /** Число граней */
  sides: number;
  /** Выпавшие значения */
  values: number[];
}

/** Брошенная формула: для кубиков в чате */
export interface RolledFormula {
  /** Формула без токенов */
  formula: string;
  /** Итог броска */
  total: number;
  /** Кости по группам */
  dice: RolledDiceGroup[];
  /** Строка деталей: «[3, 1] + 2» */
  details: string;
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
 * Знак слагаемого в строке деталей: первое положительное — без знака.
 *
 * @param sign - знак слагаемого
 * @param isFirst - первое ли слагаемое
 * @returns приставка
 */
function formatTermSign(sign: 1 | -1, isFirst: boolean): string {
  if (isFirst) {
    return sign < 0 ? '-' : '';
  }

  return sign < 0 ? ' - ' : ' + ';
}

/**
 * Бросает кубиковую формулу и возвращает сумму и выпавшие значения кубиков.
 *
 * @param formula - формула без `@`-токенов (напр. «2к6 + 3»)
 * @returns сумма броска, выпавшие значения, кости по группам и строка деталей
 *   (для отображения и кубиков в чате)
 */
export function rollDamageFormula(formula: string): {
  total: number;
  values: number[];
  dice: RolledDiceGroup[];
  details: string;
} {
  const values: number[] = [];
  const dice: RolledDiceGroup[] = [];
  const detailParts: string[] = [];

  let total = 0;

  for (const [index, term] of splitFormulaTerms(formula).entries()) {
    const sign = formatTermSign(term.sign, index === 0);
    const diceTerm = parseDiceTerm(term.body);

    if (diceTerm) {
      const groupValues: number[] = [];

      for (let rollIndex = 0; rollIndex < diceTerm.count; rollIndex++) {
        const roll = Math.floor(Math.random() * diceTerm.sides) + 1;

        groupValues.push(roll);
        total += term.sign * roll;
      }

      values.push(...groupValues);
      dice.push({ sides: diceTerm.sides, values: groupValues });
      detailParts.push(`${sign}[${groupValues.join(', ')}]`);

      continue;
    }

    const flat = Number.parseInt(term.body, 10);

    if (!Number.isNaN(flat)) {
      total += term.sign * flat;
      detailParts.push(`${sign}${flat}`);
    }
  }

  return { total, values, dice, details: detailParts.join('') };
}

/**
 * Формула для чата: кости по-русски и пробелы вокруг знаков — «2к4 + 2».
 *
 * @param formula - формула без `@`-токенов
 * @returns формула для показа
 */
export function formatDiceFormula(formula: string): string {
  return splitFormulaTerms(formula)
    .map(
      (term, index) =>
        `${formatTermSign(term.sign, index === 0)}${term.body.replace(/^(\d*)[кдd]/i, '$1к')}`,
    )
    .join('');
}
