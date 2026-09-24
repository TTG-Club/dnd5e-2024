import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

import {
  DEFAULT_EFFECT_ACTION_COST,
  formatEffectActionCost,
  listEffectActiveActions,
} from '@vtt/shared/system/dnd.js';

import { EFFECT_ACTIVE_ACTION_LABELS } from '../constants';

/**
 * Подпись кнопки действия действующего заклинания вместе с ценой:
 * «Действие · Бонусное действие». Ходом распоряжается человек — цена это
 * пометка, а не запрет.
 *
 * @param effect - эффект строки
 * @returns подпись кнопки
 */
export function formatActiveActionLabel(effect: ActiveEffect): string {
  const [trigger] = listEffectActiveActions(effect);
  const { run, costSeparator } = EFFECT_ACTIVE_ACTION_LABELS;

  if (!trigger?.cost || trigger.cost === DEFAULT_EFFECT_ACTION_COST) {
    return run;
  }

  return `${run}${costSeparator}${formatEffectActionCost(trigger.cost, trigger.moveCostFeet)}`;
}
