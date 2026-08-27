/**
 * Ресурс листа: максимум формулой и восстановление на отдыхе.
 *
 * Максимум у большинства ресурсов не число, а растущее значение: очки удачи
 * «Удачливого» равны бонусу мастерства, очки чародейства — уровню, запас
 * «Слабокровного» — бонусу мастерства минус один. Записанное число разошлось бы
 * с листом при первом же повышении уровня, поэтому у счётчика хранится формула,
 * а `max` — снимок последнего расчёта (по нему читаются листы, собранные до неё).
 *
 * Восстановление раздельное: короткий и продолжительный отдых возвращают своё,
 * и «ничего / все заряды / N зарядов» описывает и ярость (всё продолжительным),
 * и кости превосходства (всё коротким), и заряды, которые отдых возвращает по
 * одному.
 */

import type { AbilityType } from '@vtt/shared';

import type { DnDActor } from './dndEntities.js';
import type { FormulaContext } from './formulaParser.js';
import type { ActorCounterState, CounterRecoveryRule } from './types.js';

import { calculateAbilityModifier } from './calculations.js';
import { isAbilityType } from './consts.js';
import {
  ABILITY_ABBREVIATIONS,
  buildFormulaContext,
  evaluateFormula,
} from './formulaParser.js';

// ── Грамматика формулы максимума ─────────────────────────────

/**
 * Токены формул листа. Тот же диалект понимают активные эффекты и количество
 * заклинаний ступени: второй диалект того же смысла разошёлся бы с первым.
 */
export const COUNTER_FORMULA_TOKENS = {
  /** Бонус мастерства */
  proficiencyBonus: '@prof',
  /** Уровень персонажа */
  level: '@level',
  /** Приставка модификатора характеристики: `@mod.cha` */
  abilityModifierPrefix: '@mod.',
  /** Модификатор заклинательной характеристики */
  spellAbilityModifier: '@mod.spell',
} as const;

/**
 * От чего считается максимум ресурса.
 *
 * `spellAbility` — заклинательная характеристика («Вознесение лича»): своя,
 * спрошенная у игрока, либо классовая.
 */
export type CounterMaxSource =
  'fixed' | 'proficiency' | 'ability' | 'spellAbility' | 'level';

/**
 * Максимум ресурса, разобранный на понятный форме выбор.
 *
 * Хранится всё равно формулой — правило нужно только редактору, чтобы автору не
 * приходилось знать про `@prof` и `@mod.cha`. Итог — «источник + offset»,
 * поэтому «бонус мастерства минус один» и «уровень плюс два» выражаются
 * одинаково.
 */
export interface CounterMaxRule {
  source: CounterMaxSource;
  /** Характеристика источника `ability`; у прочих в счёт не идёт */
  ability: AbilityType;
  /** Прибавка к значению источника; может быть отрицательной */
  offset: number;
  /**
   * Множитель значения источника; нет — единица.
   *
   * Нужен ресурсам, у которых запас кратен растущему значению: «Возложение
   * рук» паладина — это пять хитов за уровень.
   */
  multiplier?: number;
}

/** Характеристика правила по умолчанию: поле обязано быть заполненным. */
export const COUNTER_MAX_DEFAULT_ABILITY: AbilityType = 'charisma';

/** Минимальное количество зарядов ресурса. */
export const COUNTER_COUNT_MIN = 0;

/** Максимальное количество зарядов ресурса. */
export const COUNTER_COUNT_MAX = 99;

/** Наименьший множитель значения источника: единица его не меняет. */
export const COUNTER_MAX_MULTIPLIER_MIN = 1;

/** Наибольший множитель значения источника: «Возложение рук» — пять за уровень. */
export const COUNTER_MAX_MULTIPLIER_MAX = 20;

/** Минимальная прибавка к значению источника максимума. */
export const COUNTER_MAX_OFFSET_MIN = -9;

/** Максимальная прибавка к значению источника максимума. */
export const COUNTER_MAX_OFFSET_MAX = 9;

/** Минимальное число зарядов, возвращаемых отдыхом. */
export const COUNTER_RECOVERY_AMOUNT_MIN = 1;

/** Сокращение характеристики для формулы (`charisma` → `cha`). */
const ABILITY_ABBREVIATION_BY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(ABILITY_ABBREVIATIONS).map(([abbreviation, ability]) => [
    ability,
    abbreviation,
  ]),
);

/**
 * Зажимает значение в границы.
 *
 * @param value - значение
 * @param min - нижняя граница
 * @param max - верхняя граница
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Целое число без знака — им записаны и своё число максимума, и множитель. */
const NUMBER_PATTERN = /^\d+$/;

/**
 * Источник максимума и его множитель, отделённые от формулы.
 *
 * Множитель ищется отдельно по той же причине, что и смещение: у общего разбора
 * всей строки они перетягивают друг у друга пробелы и знак. Записать его можно
 * с любой стороны — «5 × уровень» и «уровень × 5» читаются одинаково.
 *
 * @param base - часть формулы без смещения
 * @returns источник без множителя и сам множитель (нет — единица)
 */
function splitCounterMaxMultiplier(base: string): {
  source: string;
  multiplier: number;
} {
  const parts = base.split('*');

  const left = parts[0]?.trim() ?? '';
  const right = parts[1]?.trim() ?? '';

  if (parts.length !== 2 || !left || !right) {
    return { source: base, multiplier: 1 };
  }

  if (NUMBER_PATTERN.test(right)) {
    return { source: left, multiplier: Number(right) };
  }

  if (NUMBER_PATTERN.test(left)) {
    return { source: right, multiplier: Number(left) };
  }

  return { source: base, multiplier: 1 };
}

/**
 * Разбирает формулу максимума в правило для формы.
 *
 * Грамматика: число, `@prof`, `@level`, `@mod.spell` или `@mod.<аббревиатура>`,
 * любое из них с множителем (`@level * 5`) и смещением (`@prof - 1`). Смещение
 * всегда в хвосте и ищется отдельно от источника: у общего разбора всей строки
 * источник и смещение перетягивают друг у друга пробелы и знак.
 *
 * @param formula - формула максимума
 * @returns правило; null — формула пуста либо написана руками и не разбирается
 */
export function parseCounterMaxFormula(formula: string): CounterMaxRule | null {
  const trimmed = formula.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const offsetMatch = /([+-])\s*(\d+)\s*$/.exec(trimmed);

  const offset = offsetMatch
    ? Number(offsetMatch[2]) * (offsetMatch[1] === '-' ? -1 : 1)
    : 0;

  const withMultiplier = trimmed
    .slice(0, offsetMatch?.index ?? trimmed.length)
    .trim();

  const { source: base, multiplier } =
    splitCounterMaxMultiplier(withMultiplier);

  if (!base) {
    // Формула из одного числа: «10» разобралось как смещение без источника
    return offset
      ? { source: 'fixed', ability: COUNTER_MAX_DEFAULT_ABILITY, offset }
      : null;
  }

  if (/^\d+$/.test(base)) {
    return {
      source: 'fixed',
      ability: COUNTER_MAX_DEFAULT_ABILITY,
      offset: Number(base) * multiplier + offset,
    };
  }

  if (base === COUNTER_FORMULA_TOKENS.proficiencyBonus) {
    return {
      source: 'proficiency',
      ability: COUNTER_MAX_DEFAULT_ABILITY,
      offset,
      multiplier,
    };
  }

  if (base === COUNTER_FORMULA_TOKENS.level) {
    return {
      source: 'level',
      ability: COUNTER_MAX_DEFAULT_ABILITY,
      offset,
      multiplier,
    };
  }

  if (base === COUNTER_FORMULA_TOKENS.spellAbilityModifier) {
    return {
      source: 'spellAbility',
      ability: COUNTER_MAX_DEFAULT_ABILITY,
      offset,
      multiplier,
    };
  }

  if (base.startsWith(COUNTER_FORMULA_TOKENS.abilityModifierPrefix)) {
    const ability =
      ABILITY_ABBREVIATIONS[
        base.slice(COUNTER_FORMULA_TOKENS.abilityModifierPrefix.length)
      ];

    // Приставка знакома, а характеристика за ней — нет: формулу правили руками,
    // и подставлять вместо неё чужую характеристику хуже, чем отдать её как есть
    return isAbilityType(ability)
      ? { source: 'ability', ability, offset, multiplier }
      : null;
  }

  return null;
}

/**
 * Собирает формулу максимума из правила формы.
 *
 * @param rule - правило максимума
 * @returns формула для записи в счётчик
 */
export function counterMaxFormula(rule: CounterMaxRule): string {
  const offset = clamp(
    Math.trunc(rule.offset),
    COUNTER_MAX_OFFSET_MIN,
    COUNTER_MAX_OFFSET_MAX,
  );

  // «Своё число» источника не имеет — весь его максимум лежит в прибавке
  if (rule.source === 'fixed') {
    return String(Math.max(COUNTER_COUNT_MIN, offset));
  }

  const multiplier = Math.trunc(rule.multiplier ?? 1);

  const token = counterMaxSourceToken(rule);

  const base = multiplier > 1 ? `${token} * ${multiplier}` : token;

  return offset === 0
    ? base
    : `${base} ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}`;
}

/**
 * Токен источника максимума без смещения.
 *
 * @param rule - правило максимума
 * @returns `@prof`, `@level`, `@mod.spell` либо `@mod.<abbr>`
 */
function counterMaxSourceToken(rule: CounterMaxRule): string {
  if (rule.source === 'proficiency') {
    return COUNTER_FORMULA_TOKENS.proficiencyBonus;
  }

  if (rule.source === 'level') {
    return COUNTER_FORMULA_TOKENS.level;
  }

  if (rule.source === 'spellAbility') {
    return COUNTER_FORMULA_TOKENS.spellAbilityModifier;
  }

  const abbreviation =
    ABILITY_ABBREVIATION_BY_KEY[rule.ability]
    ?? ABILITY_ABBREVIATION_BY_KEY[COUNTER_MAX_DEFAULT_ABILITY];

  return `${COUNTER_FORMULA_TOKENS.abilityModifierPrefix}${abbreviation}`;
}

/**
 * Формула модификатора характеристики (`charisma` → `@mod.cha`).
 *
 * @param ability - характеристика
 */
export function counterAbilityModifierFormula(ability: AbilityType): string {
  return counterMaxSourceToken({ source: 'ability', ability, offset: 0 });
}

// ── Расчёт максимума ─────────────────────────────────────────

/**
 * Контекст формул листа с заполненным `@mod.spell`.
 *
 * Заклинательная характеристика берётся у первого заклинающего класса: у своего
 * ресурса листа спросить её больше негде, а у ресурса черты она уже посчитана
 * при выдаче (`buildFeatCounters`).
 *
 * @param actor - лист персонажа
 */
export function buildCounterFormulaContext(actor: DnDActor): FormulaContext {
  const ability = (actor.system.classes ?? []).find(
    (entry) => entry.spellcastingAbility,
  )?.spellcastingAbility;

  return {
    ...buildFormulaContext(actor),
    spellMod: ability
      ? calculateAbilityModifier(actor.system.abilities[ability] ?? 10)
      : undefined,
  };
}

/**
 * Значение формулы максимума. Кривая формула не должна ронять лист — тогда
 * персонаж остался бы без ресурса из-за опечатки в одном поле, поэтому
 * неразобранная формула читается как ноль.
 *
 * @param formula - формула максимума
 * @param context - `@`-переменные листа
 */
export function evaluateCounterMaxFormula(
  formula: string,
  context: FormulaContext,
): number {
  try {
    return clamp(
      Math.round(evaluateFormula(formula, context)),
      COUNTER_COUNT_MIN,
      COUNTER_COUNT_MAX,
    );
  } catch {
    return 0;
  }
}

/**
 * Максимум счётчика по готовому контексту формул.
 *
 * Отдельно от {@link resolveCounterMax} ради списка: контекст собирается один
 * раз на весь лист, а не заново на каждый счётчик.
 *
 * @param context - `@`-переменные листа
 * @param counter - состояние счётчика
 * @returns максимум зарядов
 */
export function resolveCounterMaxIn(
  context: FormulaContext,
  counter: ActorCounterState,
): number {
  const formula = counter.maxFormula?.trim();

  if (!formula) {
    return Math.max(COUNTER_COUNT_MIN, counter.max);
  }

  return evaluateCounterMaxFormula(formula, context);
}

/**
 * Максимум счётчика: с формулой он считается от листа, без формулы — лежит
 * числом.
 *
 * Считается при чтении, а не хранится: бонус мастерства и модификатор
 * характеристики растут вместе с персонажем, и записанное число разошлось бы с
 * листом при первом же повышении уровня.
 *
 * @param actor - лист персонажа
 * @param counter - состояние счётчика
 * @returns максимум зарядов
 */
export function resolveCounterMax(
  actor: DnDActor,
  counter: ActorCounterState,
): number {
  return resolveCounterMaxIn(buildCounterFormulaContext(actor), counter);
}

/**
 * Пересчитывает максимумы счётчиков с формулой, подрезая остаток.
 *
 * Нужен при повышении уровня: у ресурса с максимумом по бонусу мастерства он
 * обязан вырасти вместе с ним, а у ресурса, максимум которого упал, в списке
 * осталось бы «3/2».
 *
 * @param actor - лист персонажа (уже с новыми уровнем и характеристиками)
 * @param counters - текущий список счётчиков
 * @returns список счётчиков с пересчитанными максимумами
 */
export function refreshCounterMaxima(
  actor: DnDActor,
  counters: ReadonlyArray<ActorCounterState>,
): ActorCounterState[] {
  const context = buildCounterFormulaContext(actor);

  return counters.map((counter) => {
    if (!counter.maxFormula?.trim()) {
      return counter;
    }

    const max = resolveCounterMaxIn(context, counter);

    return { ...counter, max, current: clamp(counter.current, 0, max) };
  });
}

// ── Восстановление на отдыхе ─────────────────────────────────

/** Вид отдыха как ключ правила восстановления в счётчике. */
export type CounterRestKey = 'shortRest' | 'longRest';

/** Виды отдыха в порядке показа. */
export const COUNTER_REST_KEYS: readonly CounterRestKey[] = [
  'shortRest',
  'longRest',
];

/** Правило «отдых не возвращает ничего». */
const NO_RECOVERY: CounterRecoveryRule = {
  mode: 'none',
  amount: COUNTER_RECOVERY_AMOUNT_MIN,
};

/** Правило «отдых возвращает все заряды». */
const FULL_RECOVERY: CounterRecoveryRule = {
  mode: 'all',
  amount: COUNTER_RECOVERY_AMOUNT_MIN,
};

/**
 * Правила восстановления счётчика по видам отдыха.
 *
 * Без своих правил читается легаси-поле `recovery`, где отдых назван один:
 * короткий отдых в правилах короче продолжительного, поэтому ресурс с откатом
 * `short` восстанавливается и продолжительным тоже. Так же его разбирает лист
 * на сайте.
 *
 * @param counter - состояние счётчика
 * @returns правила короткого и продолжительного отдыха
 */
export function getCounterRecoveryRules(
  counter: Pick<ActorCounterState, 'recovery' | 'shortRest' | 'longRest'>,
): Record<CounterRestKey, CounterRecoveryRule> {
  if (counter.shortRest || counter.longRest) {
    return {
      shortRest: counter.shortRest ?? NO_RECOVERY,
      longRest: counter.longRest ?? NO_RECOVERY,
    };
  }

  return {
    shortRest: counter.recovery === 'short' ? FULL_RECOVERY : NO_RECOVERY,
    longRest: FULL_RECOVERY,
  };
}

/**
 * Сколько зарядов вернёт правило: «все заряды» — до максимума, «своё число» —
 * заданное количество (выше максимума оно не поднимет).
 *
 * @param rule - правило восстановления
 * @param max - максимум зарядов счётчика
 * @returns число возвращаемых зарядов
 */
export function getCounterRecoveryAmount(
  rule: CounterRecoveryRule,
  max: number,
): number {
  if (rule.mode === 'none') {
    return 0;
  }

  return rule.mode === 'all' ? max : clamp(Math.trunc(rule.amount), 0, max);
}

/**
 * Приводит правило восстановления к допустимым значениям: число зарядов — целое
 * не меньше минимума и не больше максимума ресурса.
 *
 * @param rule - правило восстановления
 * @param max - максимум зарядов счётчика
 */
export function normalizeCounterRecoveryRule(
  rule: CounterRecoveryRule,
  max: number,
): CounterRecoveryRule {
  return {
    mode: rule.mode,
    amount: clamp(
      Math.trunc(rule.amount),
      COUNTER_RECOVERY_AMOUNT_MIN,
      Math.max(COUNTER_RECOVERY_AMOUNT_MIN, max),
    ),
  };
}
