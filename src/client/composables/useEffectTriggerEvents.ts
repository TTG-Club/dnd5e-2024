import type {
  AttackRollMode,
  DnDSceneEntity,
  EffectTriggerAttackRole,
} from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useProjectileStore } from '@/stores/projectileStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { isActorEntity, isCreatureEntity } from '@vtt/shared';
import {
  isDndSceneEntity,
  runAttackRollTriggers,
} from '@vtt/shared/system/dnd.js';

import { isEntityInCombat, resolveActiveTurnActorId } from './encounterTurn';
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
 * D&D-сущность мира по id в момент броска.
 *
 * @param entityId - сущность
 * @returns сущность либо `undefined`
 */
function findDndWorldEntity(entityId: string): DnDSceneEntity | undefined {
  const current = useWorldEntities().findCurrentWorldEntity(entityId);

  return current && isDndSceneEntity(current) ? current : undefined;
}

/** Сторона броска атаки с другой стороной для условий */
interface AttackRollSide {
  entityId: string;
  role: EffectTriggerAttackRole;
  /** Другая сторона: цель для атакующего, атакующий для цели */
  otherId?: string;
}

/**
 * Прогоняет срабатывания броска атаки у одной стороны и отправляет итог.
 *
 * Сущность берётся из мира в момент броска, а не из листа: лист может держать
 * свою копию, и её старые хиты ушли бы боевым каналом вместе со снятием.
 *
 * @param side - сторона атаки
 * @param rollMode - режим броска для условий «с преимуществом»
 */
function settleAttackRollSide(
  side: AttackRollSide,
  rollMode: AttackRollMode,
): void {
  const { entityId, role } = side;
  const current = findDndWorldEntity(entityId);

  if (!current) {
    return;
  }

  // Deep clone: shallow spread теряет вложенные Vue reactive-свойства
  const updated = JSON.parse(JSON.stringify(current));

  if (!isDndSceneEntity(updated)) {
    return;
  }

  const result = runAttackRollTriggers(updated, role, {
    inCombat: isEntityInCombat(entityId),
    activeTurnActorId: resolveActiveTurnActorId(),
    other: side.otherId ? findDndWorldEntity(side.otherId) : undefined,
    roll: {
      hasAdvantage: rollMode === 'advantage',
      hasDisadvantage: rollMode === 'disadvantage',
    },
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
 * @param options - бросок серии снарядов и режим броска
 * @param options.projectile - цели — назначенные цели снарядов
 * @param options.rollMode - режим броска атаки
 */
export function dispatchAttackRollTriggers(
  attackerId: string,
  options: { projectile: boolean; rollMode: AttackRollMode },
): void {
  try {
    const targetIds = listAttackTargetIds(options.projectile);

    // Другая сторона атакующего однозначна только при одной цели
    settleAttackRollSide(
      {
        entityId: attackerId,
        role: 'attacker',
        otherId: targetIds.length === 1 ? targetIds[0] : undefined,
      },
      options.rollMode,
    );

    for (const targetId of targetIds) {
      settleAttackRollSide(
        { entityId: targetId, role: 'target', otherId: attackerId },
        options.rollMode,
      );
    }
  } catch (error) {
    console.error(TRIGGER_EVENTS_LOG_PREFIX, error);
  }
}
