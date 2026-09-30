/**
 * Спасбросок против того, кто его вызвал: «Защита от зла и добра» даёт
 * преимущество на спасброски, которые вызвали аберрация, небожитель,
 * элементаль, фея, исчадие или нежить.
 *
 * Такой эффект — обычный эффект с условием броска
 * `source.creatureType === "…"` (`creatureTypeCondition.ts`): на числа листа
 * он не влияет, его флаги (преимущество, помеха) и прибавки к спасброску
 * включаются только в спасброске, который вызвало существо нужного типа. Тип
 * источника спасбросок несёт в обстоятельствах (`sourceCreatureType`): клиент
 * берёт его у заклинателя или существа, сервер — у эффекта, который наложивший
 * пометил при наложении.
 *
 * Одна точка на все пути спасброска: свой бросок на клиенте, бросок по запросу
 * и бросок сервера.
 *
 * @module system/dnd/saveSourceConditions
 */

import type { AbilityType } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { CreatureCategory } from './creatureTypes.js';
import type { FormulaContext } from './formulaParser.js';

import { listSavingThrowBonusKeys } from './attackUtils.js';
import {
  collectRollConditionFlags,
  evaluateConditionalBonuses,
} from './effectPipeline.js';

/** Что источник спасброска добавляет к нему */
export interface SaveSourceAdjustments {
  /** Флаги эффектов, чьё условие об источнике выполнено */
  flags: string[];
  /** Плоская прибавка к спасброску от тех же эффектов */
  bonus: number;
}

/** Источник неизвестен — прибавлять нечего */
const NO_SOURCE_ADJUSTMENTS: SaveSourceAdjustments = { flags: [], bonus: 0 };

/** Обстоятельства спасброска, которые читает поправка по источнику */
export interface SaveSourceCircumstances {
  /** Тип того, кто вызвал спасбросок */
  sourceCreatureType?: CreatureCategory;
  /** Спасбросок концентрации: своя прибавка тоже в счёте */
  againstConcentration?: boolean;
}

/**
 * Флаги и прибавка спасброска от эффектов с условием об его источнике.
 *
 * @param effects - действующие эффекты бросающего (с аурами карты)
 * @param ability - характеристика спасброска
 * @param circumstances - тип источника и концентрация
 * @param formulaContext - контекст формул бросающего, если значения — формулы
 * @returns флаги и прибавка; без типа источника — пусто
 */
export function resolveSaveSourceAdjustments(
  effects: readonly ActiveEffect[],
  ability: AbilityType,
  circumstances: SaveSourceCircumstances,
  formulaContext?: FormulaContext,
): SaveSourceAdjustments {
  const { sourceCreatureType } = circumstances;

  if (!sourceCreatureType) {
    return NO_SOURCE_ADJUSTMENTS;
  }

  // В контексте только источник: условия о цели, броске атаки и союзниках
  // здесь данных не находят и не выполняются
  const rollContext = {
    hasAdvantage: false,
    hasDisadvantage: false,
    source: { creatureType: sourceCreatureType },
  };

  const bonus = listSavingThrowBonusKeys(ability, circumstances).reduce(
    (total, key) =>
      total
      + evaluateConditionalBonuses(effects, key, rollContext, formulaContext),
    0,
  );

  return {
    flags: collectRollConditionFlags(effects, rollContext),
    bonus,
  };
}

/**
 * Действующие флаги вместе с добавленными — без копии, если добавлять нечего.
 *
 * @param flags - действующие флаги бросающего
 * @param extra - флаги от условий броска
 * @returns флаги для режима броска
 */
export function withExtraFlags(
  flags: ReadonlySet<string>,
  extra: readonly string[],
): ReadonlySet<string> {
  return extra.length > 0 ? new Set([...flags, ...extra]) : flags;
}
