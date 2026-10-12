/**
 * Бросок части урона в записи карточки чата: что выпало без крита и что
 * добавили кости крита — по отдельности.
 *
 * По правилам 5e критическое попадание бросает кости урона ещё раз, а
 * модификаторы не повторяет. Атака бросает такой урон одной формулой с
 * удвоенными костями (`doubleDiceInFormula`), поэтому запись делит бросок
 * сама: вторая половина костей каждого слагаемого — кости крита. Так кнопка
 * «Не крит» под уроном снимает ровно их, а «Крит» — добавляет к обычному
 * удару.
 *
 * @module system/dnd/attackDamageRoll
 */

import type { DiceRollData } from '@vtt/shared';

import type { CritDiceTerm } from './attackUtils.js';

import { z } from 'zod';

import {
  buildCritDiceFormula,
  halveDiceInFormula,
  listCritDiceTerms,
} from './attackUtils.js';
import { isDeductionFormula, rollDamageFormula } from './diceFormula.js';

/**
 * Сколько выпавших костей помнит запись по одному броску. Кости нужны только
 * подробностям карточки: бросок длиннее идёт в запись без них
 */
const MAX_RECORD_DICE = 64;

/** Zod-схема броска части урона */
export const AttackDamagePartRollSchema = z.object({
  formula: z.string().min(1),
  total: z.number().finite(),
  dice: z.array(z.number().finite()).max(MAX_RECORD_DICE).optional(),
  critFormula: z.string().min(1).optional(),
  critTotal: z.number().finite().optional(),
  critDice: z.array(z.number().finite()).max(MAX_RECORD_DICE).optional(),
});

/** Бросок части урона: обычный урон и кости крита по отдельности */
export interface AttackDamagePartRoll {
  /** Формула без костей крита: её перебрасывает «Нанести урон» */
  formula: string;
  /** Итог броска без костей крита: кости и модификаторы */
  total: number;
  /** Выпавшие кости без костей крита — для подробностей карточки */
  dice?: number[];
  /**
   * Кости крита — формула из одних костей («2к6»). Нет — крит части ничего
   * не добавляет: в формуле нет костей либо это вычет из урона
   */
  critFormula?: string;
  /** Сумма костей крита; нет — их ещё не бросали */
  critTotal?: number;
  /** Выпавшие кости крита — для подробностей карточки */
  critDice?: number[];
}

/** Что брошено по части урона */
export interface RolledDamagePartInput {
  /** Брошенная формула: у крита кости в ней уже удвоены */
  formula: string;
  /** Итог броска */
  total: number;
  /** Выпавшие кости в порядке формулы; нет — бросок их не отдал */
  values?: readonly number[];
  /** Часть брошена критом */
  critical: boolean;
}

/**
 * Выпавшие кости для записи: длинный бросок идёт без них.
 *
 * @param values - выпавшие кости
 * @returns поле `dice` записи или пусто
 */
function pickRecordDice(
  values: readonly number[] | undefined,
): Pick<AttackDamagePartRoll, 'dice'> {
  return values && values.length > 0 && values.length <= MAX_RECORD_DICE
    ? { dice: [...values] }
    : {};
}

/**
 * То же для костей крита.
 *
 * @param values - выпавшие кости крита
 * @returns поле `critDice` записи или пусто
 */
function pickRecordCritDice(
  values: readonly number[] | undefined,
): Pick<AttackDamagePartRoll, 'critDice'> {
  const { dice } = pickRecordDice(values);

  return dice ? { critDice: dice } : {};
}

/**
 * Делит кости удвоенного броска на обычные и кости крита: в каждом
 * слагаемом первая половина костей — обычный урон, вторая — крит.
 *
 * @param terms - слагаемые-кости удвоенной формулы
 * @param values - выпавшие кости в порядке формулы
 * @returns кости по отдельности и сумма костей крита с учётом знака
 *   слагаемого либо `undefined`, если костей выпало не столько, сколько в
 *   формуле
 */
function splitCritDice(
  terms: readonly CritDiceTerm[],
  values: readonly number[],
): { base: number[]; crit: number[]; critTotal: number } | undefined {
  const expected = terms.reduce((sum, term) => sum + term.count, 0);

  if (values.length !== expected) {
    return undefined;
  }

  const base: number[] = [];
  const crit: number[] = [];

  let critTotal = 0;
  let offset = 0;

  for (const term of terms) {
    const half = term.count / 2;
    const group = values.slice(offset, offset + term.count);
    const critGroup = group.slice(half);

    base.push(...group.slice(0, half));
    crit.push(...critGroup);
    critTotal += term.sign * critGroup.reduce((sum, value) => sum + value, 0);
    offset += term.count;
  }

  return { base, crit, critTotal };
}

/**
 * Сумма костей броска, когда сами кости неизвестны: итог без модификаторов.
 * Модификаторы — та же формула без костей.
 *
 * @param formula - брошенная формула
 * @param total - итог броска
 * @returns сумма костей
 */
function resolveDiceSum(formula: string, total: number): number {
  const flatFormula = listCritDiceTerms(formula).reduce(
    (flat, term) => flat.replace(term.body, '0'),
    formula,
  );

  return total - rollDamageFormula(flatFormula).total;
}

/**
 * Описывает бросок части урона для записи: что выпало без крита и что
 * добавили кости крита.
 *
 * Бросок критом делится по костям: вторая половина костей каждого слагаемого
 * — крит. Если кости броска неизвестны или их не столько, сколько в формуле,
 * точно разделить нельзя — костями крита считается половина суммы костей с
 * округлением вниз. Формула с нечётным числом костей критом не удваивалась:
 * такая часть описывается как обычная.
 *
 * @param input - брошенная формула, итог, кости и был ли крит
 * @returns бросок части для записи
 */
export function describeDamagePartRoll(
  input: RolledDamagePartInput,
): AttackDamagePartRoll {
  const { formula, total } = input;

  // Вычет из урона — не урон: его кости крит не удваивает
  if (isDeductionFormula(formula)) {
    return { formula, total, ...pickRecordDice(input.values) };
  }

  const baseFormula = input.critical ? halveDiceInFormula(formula) : undefined;
  const critFormula = buildCritDiceFormula(baseFormula ?? formula);

  if (!baseFormula || !critFormula) {
    return {
      formula,
      total,
      ...pickRecordDice(input.values),
      ...(critFormula ? { critFormula } : {}),
    };
  }

  const split = splitCritDice(listCritDiceTerms(formula), input.values ?? []);

  if (split) {
    return {
      formula: baseFormula,
      total: total - split.critTotal,
      ...pickRecordDice(split.base),
      critFormula,
      critTotal: split.critTotal,
      ...pickRecordCritDice(split.crit),
    };
  }

  const diceSum =
    input.values && input.values.length > 0
      ? input.values.reduce((sum, value) => sum + value, 0)
      : resolveDiceSum(formula, total);

  const critTotal = Math.floor(diceSum / 2);

  return {
    formula: baseFormula,
    total: total - critTotal,
    critFormula,
    critTotal,
  };
}

/**
 * Выпавшие кости броска роллера в порядке формулы. Бросок с отброшенными
 * костями («оставить старшие») костей не отдаёт: по ним бросок на обычный
 * урон и крит не разделить.
 *
 * @param roll - данные броска
 * @returns выпавшие кости или `undefined`
 */
export function listRolledDiceValues(roll: DiceRollData): number[] | undefined {
  if (roll.dice.some((group) => group.dropped.length > 0)) {
    return undefined;
  }

  return roll.dice.flatMap((group) => group.values);
}
