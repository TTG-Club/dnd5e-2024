/**
 * Предупреждение о Сл спасброска, которую не из чего посчитать.
 *
 * Спасбросок против Сл 0 прошёл бы любой: умение «не работает», действие
 * потрачено, а причины не видно. Поэтому такое применение останавливается до
 * оплаты, а человек видит, что именно не посчиталось.
 */

import type {
  ActiveEffect,
  Spell,
  UnresolvedSaveDc,
} from '@vtt/shared/system/dnd.js';

import {
  describeUnresolvedSaveDc,
  findUnresolvedApplySaveDc,
  UNRESOLVED_SAVE_DC_LABELS,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { getTargetSpellEffects } from './spellResolutionShared';
import { bindTargetEffectsToCaster } from './targetEffectSourceBinding';

/** Приставка id уведомления: одно на источник, сколько бы целей он ни задел */
const UNRESOLVED_SAVE_DC_TOAST_PREFIX = 'unresolved-save-dc:';

/** Эффект источника с непосчитанной Сл */
export interface UnresolvedEffectSaveDc {
  /** Эффект, чей спасбросок не бросить */
  effect: ActiveEffect;
  /** Что не посчиталось */
  problem: UnresolvedSaveDc;
}

/**
 * Ищет среди эффектов «на цель» тот, чью Сл при наложении не посчитать.
 * Числа наложившего подставляются так же, как при самом наложении.
 *
 * @param spell - заклинание или псевдо-заклинание применения
 * @param casterId - кто накладывает
 * @param sourceDc - Сл источника: ею заменяется Сл 0 эффекта
 * @returns первый такой эффект либо `null`
 */
export function findUnresolvedTargetSaveDc(
  spell: Spell,
  casterId: string,
  sourceDc: number,
): UnresolvedEffectSaveDc | null {
  const effects = bindTargetEffectsToCaster(
    getTargetSpellEffects(spell),
    spell,
    casterId,
  );

  for (const effect of effects) {
    const problem = findUnresolvedApplySaveDc(effect, sourceDc);

    if (problem) {
      return { effect, problem };
    }
  }

  return null;
}

/**
 * Показывает, что спасбросок не бросить: что не посчиталось и чем кончилось.
 *
 * @param sourceName - заклинание, умение или предмет
 * @param problem - непосчитанная Сл
 * @param outcomeSuffix - чем кончилось: применение отменено или эффект не лёг
 */
export function warnUnresolvedSaveDc(
  sourceName: string,
  problem: UnresolvedSaveDc,
  outcomeSuffix: string,
): void {
  useSystemToastStore().add({
    // Один источник — одно уведомление, а не по одному на каждую цель области
    id: `${UNRESOLVED_SAVE_DC_TOAST_PREFIX}${sourceName}`,
    title: `${UNRESOLVED_SAVE_DC_LABELS.title}: ${sourceName}`,
    description: `${describeUnresolvedSaveDc(problem)}${outcomeSuffix}`,
    color: 'warning',
  });
}
