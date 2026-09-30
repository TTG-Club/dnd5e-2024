/**
 * Трата хода носителя в бою — для ограничения «за ход действие или бонусное
 * действие, не оба» («Замедление», `actionRestrictions.ts`).
 *
 * Записывается там же, где стоит проверка запрета: каст заклинания, действие
 * статблока, «вырваться», действие эффекта. Счётчик живёт в счётчиках хода
 * носителя и уезжает боевым каналом; обнуляет его сервер в конце хода. У
 * носителя без флага и вне боя ничего не пишется.
 */

import type { EffectActionCost } from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { recordActionSpend } from '@vtt/shared/system/dnd.js';

import { resolveCombatRound } from './encounterTurn';
import { useWorldEntities } from './useWorldEntities';

/**
 * Отмечает трату хода носителя.
 *
 * @param entityId - кто тратит
 * @param cost - что тратит; нет — трата не считается
 */
export function recordEntityActionSpend(
  entityId: string | undefined,
  cost: EffectActionCost | undefined,
): void {
  // Вне боя хода нет — и обнулить счётчик было бы некому
  if (resolveCombatRound() === undefined) {
    return;
  }

  const entity = useWorldEntities().findCurrentDndEntity(entityId);
  const ledger = entity ? recordActionSpend(entity, cost) : undefined;
  const socket = useChatStore().getSocket();

  if (!entity || !ledger || !socket) {
    return;
  }

  emitEntityCombatState(socket, {
    ...entity,
    system: { ...entity.system, effectUsage: ledger },
  });
}
