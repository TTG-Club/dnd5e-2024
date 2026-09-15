import type { EffectTriggerAttackRole } from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useProjectileStore } from '@/stores/projectileStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { isActorEntity, isCreatureEntity } from '@vtt/shared';
import {
  isDndSceneEntity,
  runAttackRollTriggers,
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

/**
 * События срабатываний эффектов, которые происходят на клиенте: бросок атаки.
 *
 * Бросок атаки делает окно броска (`DiceRollModal`), и срабатывания «на своей
 * следующей атаке» и «на следующей атаке по носителю» расходуются здесь — одной
 * точкой для макросов хотбара и для листов персонажа и существа.
 */

/** Лог-префикс событий срабатываний */
const TRIGGER_EVENTS_LOG_PREFIX = '[EffectTriggers]';

/**
 * Участвует ли сущность в идущем бою: активный начатый энкаунтер с ней.
 *
 * @param entityId - сущность
 * @returns `true`, если бой идёт и сущность в нём
 */
function isEntityInCombat(entityId: string): boolean {
  const encounter = useInitiativeStore().encounter;

  return (
    encounter?.isActive === true
    && encounter.currentTurnIndex >= 0
    && encounter.entries.some((entry) => entry.actorId === entityId)
  );
}

/**
 * Цели броска атаки: назначенные цели серии снарядов либо выбранная цель.
 *
 * @param projectile - бросок серии снарядов
 * @returns id сущностей-целей без повторов
 */
function listAttackTargetIds(projectile: boolean): string[] {
  if (!projectile) {
    const target = useTargetStore().getTargetActor();

    return target ? [target.id] : [];
  }

  const projectileStore = useProjectileStore();
  const scene = useWorldStore().currentScene;

  if (!projectileStore.isActive || !scene) {
    return [];
  }

  const tokensById = new Map(scene.tokens.map((token) => [token.id, token]));
  const targetIds = new Set<string>();

  for (const tokenId of projectileStore.assignedTargets.keys()) {
    const actorId = tokensById.get(tokenId)?.actorId;

    if (actorId) {
      targetIds.add(actorId);
    }
  }

  return [...targetIds];
}

/**
 * Прогоняет срабатывания броска атаки у одной стороны и отправляет итог.
 *
 * Сущность берётся из мира в момент броска, а не из листа: лист может держать
 * свою копию, и её старые хиты ушли бы боевым каналом вместе со снятием.
 *
 * @param entityId - сторона атаки
 * @param role - атакующий или цель
 */
function settleAttackRollSide(
  entityId: string,
  role: EffectTriggerAttackRole,
): void {
  const { findCurrentWorldEntity } = useWorldEntities();
  const current = findCurrentWorldEntity(entityId);

  if (!current || !isDndSceneEntity(current)) {
    return;
  }

  // Deep clone: shallow spread теряет вложенные Vue reactive-свойства
  const updated = JSON.parse(JSON.stringify(current));

  if (!isDndSceneEntity(updated)) {
    return;
  }

  const result = runAttackRollTriggers(updated, role, {
    inCombat: isEntityInCombat(entityId),
  });

  if (!result.changed) {
    return;
  }

  // Снятие — в КАНОНИЧЕСКОЙ сущности стора: оркестратор урона позже клонирует
  // ту же сущность цели для своего эмита, и без локального снятия его полный
  // снимок вернул бы эффект обратно. Расход идёт ДО броска, поэтому хиты тут
  // ещё прежние — запись с уроном делает оркестратор по уже очищенной сущности.
  const worldStore = useWorldStore();
  const worldId = worldStore.connectionState.currentWorldId;

  const patch = {
    activeEffects: updated.activeEffects,
    ...(result.usageChanged ? { system: updated.system } : {}),
  };

  if (worldId) {
    if (isActorEntity(updated)) {
      worldStore.updateActor(worldId, entityId, patch);
    } else if (isCreatureEntity(updated)) {
      worldStore.updateCreature(worldId, entityId, patch);
    }
  }

  const socket = useChatStore().getSocket();

  // Боевым каналом: снятие с ЦЕЛИ сервер принимает только так — полную замену
  // чужой сущности он берёт лишь от владельца
  if (socket) {
    emitEntityCombatState(socket, updated);
  }
}

/**
 * Бросок атаки состоялся (попадание или промах): расходует срабатывания
 * атакующего и целей. Зовётся ДО броска — снятие эффекта должно опередить эмит
 * урона по цели, иначе два полных снимка сущности гонятся.
 *
 * Сбой расхода не срывает сам бросок: эффект останется, а атака пройдёт.
 *
 * @param attackerId - атакующая сущность
 * @param options - бросок серии снарядов
 * @param options.projectile - цели — назначенные цели снарядов
 */
export function dispatchAttackRollTriggers(
  attackerId: string,
  options: { projectile: boolean },
): void {
  try {
    settleAttackRollSide(attackerId, 'attacker');

    for (const targetId of listAttackTargetIds(options.projectile)) {
      settleAttackRollSide(targetId, 'target');
    }
  } catch (error) {
    console.error(TRIGGER_EVENTS_LOG_PREFIX, error);
  }
}
