/**
 * Трата хода носителя в бою — для ограничений «за ход одно из» («Замедление»:
 * действие или бонусное действие; «Психическая плеть Таши»: ещё и
 * перемещение) и «одна атака за ход» (`actionRestrictions.ts`).
 *
 * Записывается там же, где стоит проверка запрета: каст заклинания, удар
 * оружием, действие статблока, «вырваться», действие эффекта. Счётчик живёт в
 * счётчиках хода носителя и уезжает боевым каналом; обнуляет его сервер в
 * конце хода. У носителя без флага и вне боя ничего не пишется. Перемещение
 * пишет сервер сам — он его и видит.
 *
 * Здесь же предупреждение об ударе вне своего хода носителю без
 * провоцированных атак («Электрошок»).
 */

import type { EffectActionCost } from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import {
  recordActionSpend,
  resolveOpportunityAttackWarning,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  isEntityInCombat,
  resolveActiveTurnActorId,
  resolveCombatRound,
} from './encounterTurn';
import { listAmbientEffects } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/** Подписи предупреждения об ударе вне своего хода */
const OPPORTUNITY_ATTACK_WARNING_LABELS = {
  title: 'Удар вне своего хода',
  suffix: '. Если это не провоцированная атака — продолжайте.',
} as const;

/**
 * Отмечает трату хода носителя.
 *
 * @param entityId - кто тратит
 * @param cost - что тратит; нет — трата не считается
 * @param attack - трата — атака действием «Атака» (удар оружием, атака из
 *   раздела «Действия» статблока): её считает «одна атака за ход»
 */
export function recordEntityActionSpend(
  entityId: string | undefined,
  cost: EffectActionCost | undefined,
  attack = false,
): void {
  // Вне боя хода нет — и обнулить счётчик было бы некому
  if (resolveCombatRound() === undefined) {
    return;
  }

  const entity = useWorldEntities().findCurrentDndEntity(entityId);

  const ledger = entity
    ? recordActionSpend(entity, cost, {
        attack,
        ambientEffects: listAmbientEffects(entity.id),
      })
    : undefined;

  const socket = useChatStore().getSocket();

  if (!entity || !ledger || !socket) {
    return;
  }

  emitEntityCombatState(socket, {
    ...entity,
    system: { ...entity.system, effectUsage: ledger },
  });
}

/**
 * Предупреждает об ударе вне своего хода, если носителю запрещены
 * провоцированные атаки. Удар не отменяет: вне хода бьют и по заготовленному
 * действию — решает стол.
 *
 * @param entityId - кто бьёт
 */
export function warnOpportunityAttack(entityId: string): void {
  // Вне боя и в свой ход провоцированных атак не бывает
  if (!isEntityInCombat(entityId) || resolveActiveTurnActorId() === entityId) {
    return;
  }

  const entity = useWorldEntities().findCurrentDndEntity(entityId);

  const warning = entity
    ? resolveOpportunityAttackWarning(entity, listAmbientEffects(entityId))
    : null;

  if (warning !== null) {
    useSystemToastStore().add({
      title: OPPORTUNITY_ATTACK_WARNING_LABELS.title,
      description: `${warning}${OPPORTUNITY_ATTACK_WARNING_LABELS.suffix}`,
      color: 'warning',
    });
  }
}
