/**
 * Контекст формул эффектов от итоговых чисел листа.
 *
 * Формулы эффектов читали `actor.system.abilities` — сырые значения записи, а
 * лист показывает итоговые: черта «+1 к Харизме» живёт эффектом, и Сл «8 +
 * @prof + @mod.feat» у Харизмы 15 → 16 выходила 12, а не 13. Здесь
 * характеристики, модификаторы и бонус мастерства берутся из
 * `resolveActorStats` — тем же расчётом, что и лист.
 *
 * Отдельный модуль: конвейер (`effectPipeline.ts`) сам строит контекст
 * формул, и импорт отсюда в него замкнул бы круг. Внутри конвейера эта функция
 * запрещена — там итоговые числа ещё считаются (тест вызовов).
 */

import type { ActiveEffect, ResolvedActorStats } from './activeEffectTypes.js';
import type { DnDActor, DnDCreature } from './dndEntities.js';
import type { FormulaContext } from './formulaParser.js';

import { resolveActorStats } from './effectPipeline.js';
import {
  buildFormulaContext,
  withResolvedSheetNumbers,
} from './formulaParser.js';

/** Что можно передать готовым, чтобы не считать лист повторно */
export interface ResolvedFormulaContextOptions {
  /** Уже посчитанные числа листа — в циклах по многим формулам */
  stats?: ResolvedActorStats;
  /** Эффекты аур на карте вокруг сущности */
  ambientEffects?: readonly ActiveEffect[];
}

/**
 * Контекст формул сущности с итоговыми характеристиками, модификаторами и
 * бонусом мастерства.
 *
 * @param entity - персонаж или существо
 * @param options - готовые числа листа и эффекты аур
 * @returns контекст формул
 */
export function buildResolvedFormulaContext(
  entity: DnDActor | DnDCreature,
  options: ResolvedFormulaContextOptions = {},
): FormulaContext {
  const stats =
    options.stats ?? resolveActorStats(entity, options.ambientEffects ?? []);

  return withResolvedSheetNumbers(buildFormulaContext(entity), stats);
}
