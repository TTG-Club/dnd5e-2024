/**
 * Прибавки, которые считаются не на листе, а в момент события: «+5 к
 * получаемым временным хитам» — при выдаче хитов, «досягаемость +10 футов» —
 * при проверке расстояния атаки.
 *
 * Такая строка эффекта — обычная прибавка (`add`) с формулой, но числа на
 * листе у неё нет: конвейер статов её пропускает (`isOffSheetChangeKey`), а
 * читает тот, кому она нужна ({@link sumOffSheetChange}).
 *
 * @module system/dnd/offSheetChanges
 */

import type { DnDSceneEntity } from './dndEntities.js';

import { ATTACK_REACH_KEY } from './activeEffectTypes.js';
import { DEFAULT_REACH_FEET } from './attackUtils.js';
import { collectActiveEffects } from './effectPipeline.js';
import { buildFormulaContext, evaluateFormula } from './formulaParser.js';

/**
 * Сумма прибавок события по ключу со всех действующих эффектов сущности.
 * Формула с ошибкой ничего не прибавляет.
 *
 * @param entity - носитель эффектов
 * @param key - ключ прибавки
 * @returns сумма, целым числом
 */
export function sumOffSheetChange(entity: DnDSceneEntity, key: string): number {
  const changes = collectActiveEffects(entity).flatMap((effect) =>
    effect.changes.filter(
      (change) => change.key === key && change.mode === 'add',
    ),
  );

  if (changes.length === 0) {
    return 0;
  }

  const context = buildFormulaContext(entity);

  const total = changes.reduce((sum, change) => {
    try {
      return sum + evaluateFormula(change.value, context);
    } catch {
      // Автор ошибся в формуле — прибавки нет
      return sum;
    }
  }, 0);

  return Math.trunc(total);
}

/**
 * Оружие или действие с досягаемостью атакующего: «увеличить досягаемость
 * этой атаки на 10 футов» (строка `attack.reach` его эффектов). Дальнобойной
 * атаке прибавка ничего не меняет — её дистанцию досягаемость не задаёт.
 *
 * @param source - оружие или действие существа
 * @param attacker - кто атакует
 * @returns тот же источник, если прибавки нет, иначе копия
 */
export function withMeleeReachBonus<Source extends { reach?: number }>(
  source: Source,
  attacker: DnDSceneEntity,
): Source {
  const bonus = sumOffSheetChange(attacker, ATTACK_REACH_KEY);

  return bonus === 0
    ? source
    : {
        ...source,
        reach: Math.max(0, (source.reach ?? DEFAULT_REACH_FEET) + bonus),
      };
}
