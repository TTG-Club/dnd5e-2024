/**
 * Сл спасброска, которую не удалось посчитать.
 *
 * Сл 0 в данных значит «Сл наложившего», а формула Сл с ошибкой или без данных
 * уступает запасному числу (`effectSaveDc.ts`). Когда не посчиталось ни то,
 * ни другое — формуле не хватило значения («в черте не выбрана
 * характеристика»), а у наложившего нет Сл заклинаний, — спасбросок шёл бы
 * против нуля: любой бросок — успех, и никто не видит, почему умение «не
 * работает». Такой спасбросок не бросают: клиент не тратит ресурс и
 * предупреждает, сервер пропускает срабатывание и пишет об этом в сводку.
 *
 * @module system/dnd/effectSaveDcProblem
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { SaveDcSource } from './effectSaveDc.js';

import { labelFormulaVariable } from './consts.js';
import { resolveEffectSaveDc } from './effectAutomation.js';
import { FEAT_ABILITY_MOD_TOKEN } from './effectChoiceBinding.js';
import { EVENT_DAMAGE_TOKEN } from './effectSaveDc.js';
import { SOURCE_SAVE_DC } from './effectSchemaParts.js';
import { CAST_LEVEL_VARIABLE } from './formulaParser.js';

/** Сл спасброска, которую не из чего посчитать */
export interface UnresolvedSaveDc {
  /**
   * Формула Сл с тем, что удалось подставить. Нет — Сл записана числом 0
   * («Сл наложившего»), а у наложившего её не оказалось
   */
  formula?: string;
  /** Токены формулы, оставшиеся без значения */
  tokens: string[];
}

/** Токен формулы: `@prof`, `@mod.feat` */
const FORMULA_TOKEN_PATTERN = /@[a-z][\w.]*/gi;

/** Токен круга ячейки каста */
const CAST_LEVEL_TOKEN = `@${CAST_LEVEL_VARIABLE}`;

/** Почему у токена нет значения — там, где причина известна */
const UNRESOLVED_TOKEN_REASONS: Readonly<Record<string, string>> = {
  [FEAT_ABILITY_MOD_TOKEN]: 'в черте не выбрана характеристика',
  [EVENT_DAMAGE_TOKEN]: 'урон есть только у события урона',
  [CAST_LEVEL_TOKEN]: 'круг ячейки известен только при касте заклинания',
};

/** Слова предупреждения о непосчитанной Сл */
export const UNRESOLVED_SAVE_DC_LABELS = {
  /** Заголовок предупреждения клиента: дальше — название источника */
  title: 'Сл спасброска не посчитана',
  /** Начало пояснения про формулу: дальше — формула в кавычках */
  formulaPrefix: 'формула «',
  formulaSuffix: '»',
  /** Причина по умолчанию: дальше — токен словами */
  noValuePrefix: 'нет значения для ',
  /** Формула есть, а токенов без значения в ней нет: ошибка записи */
  brokenFormula: 'формула не считается',
  /** Сл числом 0 без источника */
  noSourceDc: 'записана «Сл наложившего», а у наложившего её нет',
  /** Чем кончилось на сервере */
  skippedSuffix: ' — спасбросок не брошен, срабатывание пропущено',
  /** Чем кончилось на клиенте до оплаты */
  notAppliedSuffix: ' — применение отменено, ничего не потрачено',
  /** Чем кончилось на клиенте, когда действие уже шло */
  effectSkippedSuffix: ' — спасбросок не брошен, эффект не наложен',
} as const;

/**
 * Находит Сл, которую не из чего посчитать: итог не больше нуля.
 *
 * @param save - Сл спасброска: числа наложившего в формулу уже подставлены
 * @param resolvedDc - итоговая Сл, против которой бросали бы
 * @returns что не посчиталось либо `null`, если Сл есть
 */
export function findUnresolvedSaveDc(
  save: SaveDcSource,
  resolvedDc: number,
): UnresolvedSaveDc | null {
  if (resolvedDc > SOURCE_SAVE_DC) {
    return null;
  }

  const { dcFormula } = save;

  if (!dcFormula) {
    return { tokens: [] };
  }

  return {
    formula: dcFormula,
    tokens: [...new Set(dcFormula.match(FORMULA_TOKEN_PATTERN) ?? [])],
  };
}

/**
 * Находит непосчитанную Сл спасброска эффекта при наложении.
 *
 * Сл «итог проверки навыка» (`applySave.dcSkill`) появляется после броска
 * проверки — до него считать её непосчитанной рано.
 *
 * @param effect - накладываемый эффект: числа наложившего уже подставлены
 * @param sourceDc - Сл источника (Сл заклинаний наложившего, Сл действия)
 * @returns что не посчиталось либо `null`
 */
export function findUnresolvedApplySaveDc(
  effect: ActiveEffect,
  sourceDc: number,
): UnresolvedSaveDc | null {
  const { applySave } = effect;

  if (!applySave || applySave.dcSkill) {
    return null;
  }

  return findUnresolvedSaveDc(
    applySave,
    resolveEffectSaveDc(applySave.dc, sourceDc),
  );
}

/**
 * Почему у токена нет значения.
 *
 * @param token - токен формулы
 * @returns причина словами
 */
function describeUnresolvedToken(token: string): string {
  return (
    UNRESOLVED_TOKEN_REASONS[token]
    ?? `${UNRESOLVED_SAVE_DC_LABELS.noValuePrefix}${labelFormulaVariable(token)}`
  );
}

/**
 * Что именно не посчиталось и почему — словами для человека.
 *
 * @param problem - непосчитанная Сл
 * @returns пояснение: «формула «8 + 2 + @mod.feat» — в черте не выбрана
 *   характеристика»
 */
export function describeUnresolvedSaveDc(problem: UnresolvedSaveDc): string {
  const { formula, tokens } = problem;

  if (formula === undefined) {
    return UNRESOLVED_SAVE_DC_LABELS.noSourceDc;
  }

  const reasons =
    tokens.length > 0
      ? tokens.map(describeUnresolvedToken).join('; ')
      : UNRESOLVED_SAVE_DC_LABELS.brokenFormula;

  return `${UNRESOLVED_SAVE_DC_LABELS.formulaPrefix}${formula}${UNRESOLVED_SAVE_DC_LABELS.formulaSuffix} — ${reasons}`;
}

/**
 * Строка сводки чата о срабатывании, которое сервер пропустил из-за
 * непосчитанной Сл.
 *
 * @param effectName - эффект, чей спасбросок не бросили
 * @param problem - непосчитанная Сл
 * @returns строка для сводки
 */
export function formatUnresolvedSaveDcNote(
  effectName: string,
  problem: UnresolvedSaveDc,
): string {
  return `${effectName}: ${UNRESOLVED_SAVE_DC_LABELS.title} (${describeUnresolvedSaveDc(problem)})${UNRESOLVED_SAVE_DC_LABELS.skippedSuffix}`;
}
