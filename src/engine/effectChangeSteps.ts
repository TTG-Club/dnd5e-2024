/**
 * Растущее и убывающее изменение: «−1 к броскам за каждый следующий ход, до
 * −5», «+1к урону каждый раунд».
 *
 * Такое правило не выражается одним числом: значение меняется со временем, и
 * его состояние обязано пережить пересчёт листа. Поэтому шаг не считается на
 * лету, а ДВИГАЕТ значение самой строки изменения на границе периода — как
 * длительность, которая тикает в `duration.remaining`. Конвейер листа при этом
 * ничего о шаге не знает: он видит обычную строку с числом.
 *
 * Шаг работает только у строки с ПЛОСКИМ числом: у формулы («1к6», «@mod.spell»)
 * двигать нечего — её значение считается заново при каждом броске.
 *
 * @module system/dnd/effectChangeSteps
 */

import type { ActiveEffect, EffectChange } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isEffectDormant, parseFormNumber } from './activeEffectTypes.js';

/** Как часто двигается значение */
export const EFFECT_CHANGE_STEP_PERIODS = ['turn', 'round'] as const;

/**
 * Период шага: ход носителя (начало его хода) или раунд боя. Вне боя ни тот,
 * ни другой не наступают — шаг стоит на месте, как и длительность в раундах.
 */
export type EffectChangeStepPeriod =
  (typeof EFFECT_CHANGE_STEP_PERIODS)[number];

/** Наибольший шаг за период: больше похоже на ошибку автора, чем на правило */
export const MAX_EFFECT_CHANGE_STEP = 100;

/** Шаг изменения: на сколько и как часто двигается значение строки */
export interface EffectChangeStep {
  /** На сколько за период; отрицательное — значение убывает */
  by: number;
  /** Как часто */
  per: EffectChangeStepPeriod;
  /**
   * Предел, дальше которого значение не уходит. Нет поля — растёт, пока эффект
   * держится.
   */
  until?: number;
}

/**
 * Сдвинет ли шаг значение строки: двигается только плоское число. Форма
 * предупреждает по этой же проверке, чтобы окно и движок не расходились.
 *
 * @param value - значение строки изменения
 * @returns `true`, если значение — плоское число
 */
export function canStepEffectChangeValue(value: string): boolean {
  return parseFormNumber(value) !== undefined;
}

/**
 * Двигает значение строки на шаг, не переходя предел.
 *
 * Предел — именно предел, а не цель: шаг «+2 до 5» от 4 даст 5, а не 6. С какой
 * стороны к нему идут, видно по знаку шага.
 *
 * @param change - строка изменения
 * @returns новая строка либо она сама, если двигать нечего
 */
function advanceChange(change: EffectChange): EffectChange {
  const step = change.step;
  const current = step ? parseFormNumber(change.value) : undefined;

  if (!step || current === undefined || step.by === 0) {
    return change;
  }

  const moved = current + step.by;
  const limit = step.until;

  let next = moved;

  if (limit !== undefined) {
    next = step.by > 0 ? Math.min(moved, limit) : Math.max(moved, limit);
  }

  return next === current ? change : { ...change, value: String(next) };
}

/**
 * Копия эффекта с продвинутыми значениями.
 *
 * @param effect - эффект
 * @param period - какой период наступил
 * @returns эффект либо его копия, если что-то сдвинулось
 */
function advanceEffect(
  effect: ActiveEffect,
  period: EffectChangeStepPeriod,
): ActiveEffect {
  if (!effect.changes.some((change) => change.step?.per === period)) {
    return effect;
  }

  const changes = effect.changes.map((change) =>
    change.step?.per === period ? advanceChange(change) : change,
  );

  return changes.some((change, at) => change !== effect.changes[at])
    ? { ...effect, changes }
    : effect;
}

/**
 * Двигает растущие и убывающие изменения на сущности.
 *
 * Отключённый эффект стоит на месте: выключенный «Нарастающий страх» не должен
 * досчитываться в тишине и вернуться сразу на пределе.
 *
 * @param entity - носитель (мутируется)
 * @param period - наступивший период
 * @returns `true`, если что-то сдвинулось
 */
export function advanceEffectChangeSteps(
  entity: DnDSceneEntity,
  period: EffectChangeStepPeriod,
): boolean {
  const effects = entity.activeEffects;

  if (!effects || effects.length === 0) {
    return false;
  }

  const moved = effects.map((effect) =>
    isEffectDormant(effect) ? effect : advanceEffect(effect, period),
  );

  if (!moved.some((effect, at) => effect !== effects[at])) {
    return false;
  }

  entity.activeEffects = moved;

  return true;
}
