/**
 * Минимальный разбор и бросок кубиковой формулы — server-safe (без внешних
 * зависимостей и без рандом-движка клиента).
 *
 * Поддерживает слагаемые вида `NкM` / `NдM` / `NdM` (кубики), плоские числа и
 * арифметику без костей (`(2 * 3)`, `floor(5 / 2)`), соединённые `+`/`−` вне
 * скобок. Арифметика нужна потому, что подстановка чисел источника оставляет
 * выражения: `(@classLevel)@heal.temp` Дикой формы приходит сюда как `(3)`, а
 * `(5 * (@castLevel - 1))@heal` — как `(5 * (2 - 1))`; простое чтение числа
 * давало на них ноль, и лечение молча пропадало. Скобка с костями внутри
 * (`(1к8 + 3)@dmg.fire`) раскрывается.
 *
 * Бросок используется серверным рантаймом периодического
 * урона (DoT): на клиенте бросок делает rpg-dice-roller, но сервер тикает урон
 * сам. Разбор слагаемых нужен и без броска — формуле хитов существа, где из
 * записи компендиума берётся только число костей.
 *
 * НЕ поддерживает `@`-токены и продвинутую нотацию (kh/kl и т.п.) — токены
 * `@dmg.<type>` нужно снять заранее (через разбор сегментов), а сложные броски
 * для периодического урона не используются.
 *
 * Здесь же живёт русская буква кости для показа. Способа два, и они не
 * взаимозаменяемы: {@link formatDiceFormula} разбирает формулу и заново
 * расставляет знаки, а {@link formatDiceLetters} меняет одну букву в уже
 * собранной строке, где есть и пробелы записи мира, и `@`-токены, и слова.
 */

import { evaluateDetachedFormula } from './formulaParser.js';

/** Регэксп одного кубикового слагаемого: `2к6`, `1д8`, `3d10` */
const DICE_TERM_REGEX = /^(\d+)[кдd](\d+)$/i;

/**
 * Латинская буква кости внутри готовой строки: `1d8` → `1к8`.
 *
 * Число костей обязательно, и это не придирка к записи: без него замена
 * задела бы `@`-токены, где за `d` тоже идут цифры (`@d20` стал бы `@к20` и
 * перестал бы находиться как незнакомый токен).
 */
const DICE_LETTER_REGEX = /(\d+)d(\d+)/gi;

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

/** Знак, после которого `+`/`−` — знак числа, а не новое слагаемое: `2*-3` */
const OPERATOR_BEFORE_SIGN_REGEX = /[*/(,]/;

/** Кость где-то внутри выражения: `(1к8+3)` */
const DICE_INSIDE_REGEX = /\d[кдd]\d/i;

/**
 * Делит формулу на слагаемые со знаком по `+`/`−` вне скобок: `(5*(2-1))` —
 * одно слагаемое, а не обрывки «(5*(2» и «1))». Пробелы снимаются заранее:
 * «2к6 + 3» и «2к6+3» — одна и та же формула.
 *
 * @param formula - формула без `@`-токенов
 * @returns слагаемые верхнего уровня в порядке записи
 */
function splitTopLevelTerms(formula: string): SignedFormulaTerm[] {
  const normalized = formula.replace(/\s+/g, '');
  const terms: SignedFormulaTerm[] = [];

  let depth = 0;
  let sign: 1 | -1 = 1;
  let body = '';

  for (const char of normalized) {
    const previous = body.at(-1);

    const startsTerm =
      depth === 0
      && (char === '+' || char === '-')
      && previous !== undefined
      && !OPERATOR_BEFORE_SIGN_REGEX.test(previous);

    if (startsTerm) {
      terms.push({ sign, body });
      sign = char === '-' ? -1 : 1;
      body = '';

      continue;
    }

    // Ведущий знак формулы — знак первого слагаемого
    if (body.length === 0 && depth === 0 && (char === '+' || char === '-')) {
      if (char === '-') {
        sign = sign === 1 ? -1 : 1;
      }

      continue;
    }

    if (char === '(') {
      depth++;
    } else if (char === ')' && depth > 0) {
      depth--;
    }

    body += char;
  }

  if (body.length > 0) {
    terms.push({ sign, body });
  }

  return terms;
}

/**
 * Внутренность скобки, которая охватывает слагаемое целиком: `(1к8+3)` →
 * `1к8+3`. У `(1)+(2)` и `floor(5/2)` такой скобки нет.
 *
 * @param body - тело слагаемого
 * @returns выражение в скобках либо `undefined`
 */
function unwrapParentheses(body: string): string | undefined {
  if (!body.startsWith('(') || !body.endsWith(')')) {
    return undefined;
  }

  let depth = 0;

  for (const [index, char] of [...body].entries()) {
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    }

    if (depth === 0 && index < body.length - 1) {
      return undefined;
    }
  }

  return body.slice(1, -1);
}

/**
 * Слагаемые со знаком, где скобка с костями раскрыта: `-(1к4+1)` →
 * `-1к4`, `-1`. Скобку бросок не катает, а кость внутри неё — должен.
 *
 * @param formula - формула без `@`-токенов
 * @returns слагаемые в порядке записи
 */
function splitFormulaTerms(formula: string): SignedFormulaTerm[] {
  return splitTopLevelTerms(formula).flatMap((term) => {
    const inner = unwrapParentheses(term.body);

    if (inner === undefined || !DICE_INSIDE_REGEX.test(inner)) {
      return [term];
    }

    return splitFormulaTerms(inner).map((innerTerm) => ({
      sign: innerTerm.sign === term.sign ? 1 : -1,
      body: innerTerm.body,
    }));
  });
}

/**
 * Число слагаемого без костей: `3`, `(3)`, `(5*(2-1))`, `floor(5/2)`.
 * Дробь округляется вниз, как все дроби правил.
 *
 * @param body - тело слагаемого без знака
 * @returns число либо `undefined`, если слагаемое не посчитать
 */
function evaluateFlatTerm(body: string): number | undefined {
  if (/^\d+$/.test(body)) {
    return Number.parseInt(body, 10);
  }

  const value = evaluateDetachedFormula(body);

  return value === undefined || !Number.isFinite(value)
    ? undefined
    : Math.floor(value);
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
 * Посчитает ли бросок движка формулу целиком: каждое слагаемое — кость или
 * арифметика без костей. Слагаемое, которое бросок не понимает (`2 * 1к6`,
 * `1к20kh1`), он молча пропускает, поэтому редактору нужно сказать о нём
 * заранее.
 *
 * @param formula - формула без `@`-токенов
 * @returns `true`, если бросок учтёт все слагаемые
 */
export function isRollableFormula(formula: string): boolean {
  const terms = splitFormulaTerms(formula);

  return (
    terms.length > 0
    && terms.every(
      (term) =>
        parseDiceTerm(term.body) !== undefined
        || evaluateFlatTerm(term.body) !== undefined,
    )
  );
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

    const flat = evaluateFlatTerm(term.body);

    if (flat !== undefined) {
      const signed = term.sign * flat;

      total += signed;

      detailParts.push(
        `${formatTermSign(signed < 0 ? -1 : 1, index === 0)}${Math.abs(signed)}`,
      );
    }
  }

  return { total, values, dice, details: detailParts.join('') };
}

/**
 * Кости по-русски в строке, которую уже собрали для показа: «1d8 + 1d6» →
 * «1к8 + 1к6». Всё остальное остаётся нетронутым — пробелы как в записи мира,
 * слова между ветками («или»), `@`-токены и подписи переменных.
 *
 * Такая строка есть у показа урона оружия, заклинания и карточки чата: её
 * собрал разбор условных веток, и переписывать её разметку нельзя. Когда
 * формулу можно разобрать целиком, берут {@link formatDiceFormula} — он
 * заодно выравнивает знаки.
 *
 * @param formula - собранная строка показа
 * @returns та же строка с русской буквой кости
 */
export function formatDiceLetters(formula: string): string {
  return formula.replace(DICE_LETTER_REGEX, '$1к$2');
}

/**
 * Формула для чата: кости по-русски и пробелы вокруг знаков — «2к4 + 2».
 *
 * Буква кости заменяется не через {@link formatDiceLetters}, а по началу уже
 * разобранного слагаемого: здесь известно, что перед буквой нет `@`-токена, а
 * значит можно привести и русскую `д` (`2д6`), и запись без числа костей
 * (`d6`). Показу, который строку не разбирает, такая свобода опасна.
 *
 * Арифметика без костей показывается числом, как её посчитает бросок:
 * `1к6 + (5 * (2 - 1))` — «1к6 + 5». Слагаемое с `@`-переменной не
 * считается и остаётся записью.
 *
 * @param formula - формула без `@`-токенов
 * @returns формула для показа
 */
export function formatDiceFormula(formula: string): string {
  return splitFormulaTerms(formula)
    .map((term, index) => {
      const isFirst = index === 0;

      const flat = parseDiceTerm(term.body)
        ? undefined
        : evaluateFlatTerm(term.body);

      if (flat !== undefined) {
        const signed = term.sign * flat;

        return `${formatTermSign(signed < 0 ? -1 : 1, isFirst)}${Math.abs(signed)}`;
      }

      return `${formatTermSign(term.sign, isFirst)}${term.body.replace(/^(\d*)[кдd]/i, '$1к')}`;
    })
    .join('');
}
