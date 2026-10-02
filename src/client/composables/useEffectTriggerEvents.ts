import type { IncomingAttackContext } from '@vtt/shared';
import type {
  AttackRollMode,
  DnDSceneEntity,
  EffectTriggerAttackRole,
} from '@vtt/shared/system/dnd.js';

import { useProjectileStore } from '@/stores/projectileStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import {
  buildAttackRollEvent,
  hasServerAttackRollTriggers,
  isDndSceneEntity,
  runAttackRollTriggers,
  toTriggerAttackKinds,
} from '@vtt/shared/system/dnd.js';

import {
  isEntityInCombat,
  resolveActiveTurnActorId,
  resolveCombatRound,
} from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import { emitSystemClientEvent } from './systemClientEvents';
import { useWorldEntities } from './useWorldEntities';

/**
 * События срабатываний эффектов, которые происходят на клиенте: бросок атаки.
 *
 * Бросок атаки делает окно броска (`DiceRollModal`). Простые срабатывания («на
 * своей следующей атаке», «на следующей атаке по носителю» — снятие и
 * наложения) расходуются здесь до броска, одной точкой для макросов хотбара и
 * листов. Срабатывания со спасброском, уроном и действиями другой стороне
 * выполняет сервер: окно сообщает о броске, когда урон атаки уже записан.
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
  attackType?: IncomingAttackContext['attackType'],
): void {
  const { entityId, role } = side;

  // Боевым каналом: снятие с ЦЕЛИ сервер принимает только так — полную замену
  // чужой сущности он берёт лишь от владельца. Снимок несёт разницу эффектов:
  // запись урона, которую оркестратор соберёт позже из стора (ответ сервера
  // ещё не пришёл), снятый здесь эффект не вернёт — правка стора на месте
  // для этого больше не нужна
  changeEntityCombatState(entityId, (current) => {
    // Deep clone: shallow spread теряет вложенные Vue reactive-свойства
    const updated: DnDSceneEntity = JSON.parse(JSON.stringify(current));

    const result = runAttackRollTriggers(updated, role, {
      inCombat: isEntityInCombat(entityId),
      activeTurnActorId: resolveActiveTurnActorId(),
      combatRound: resolveCombatRound(),
      other: side.otherId ? findDndWorldEntity(side.otherId) : undefined,
      roll: {
        hasAdvantage: rollMode === 'advantage',
        hasDisadvantage: rollMode === 'disadvantage',
      },
      ...(attackType
        ? { attack: { kinds: toTriggerAttackKinds(attackType) } }
        : {}),
    });

    return result.changed ? updated : null;
  });
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
 * @param options.attackType - чем бьют: условия об атаке читают вид
 * @returns цели броска — для сообщения серверу после урона
 */
export function dispatchAttackRollTriggers(
  attackerId: string,
  options: {
    projectile: boolean;
    rollMode: AttackRollMode;
    attackType?: IncomingAttackContext['attackType'];
  },
): string[] {
  const targetIds = listAttackTargetIds(options.projectile);

  try {
    // Другая сторона атакующего однозначна только при одной цели
    settleAttackRollSide(
      {
        entityId: attackerId,
        role: 'attacker',
        otherId: targetIds.length === 1 ? targetIds[0] : undefined,
      },
      options.rollMode,
      options.attackType,
    );

    for (const targetId of targetIds) {
      settleAttackRollSide(
        { entityId: targetId, role: 'target', otherId: attackerId },
        options.rollMode,
        options.attackType,
      );
    }
  } catch (error) {
    console.error(TRIGGER_EVENTS_LOG_PREFIX, error);
  }

  return targetIds;
}

/**
 * Сообщает серверу о броске атаки, когда его урон уже записан: сервер выполнит
 * срабатывания со спасброском, уроном и действиями другой стороне. Если таких
 * у сторон нет, событие не шлётся.
 *
 * @param attackerId - атакующая сущность
 * @param targetIds - цели броска
 * @param rollMode - режим броска атаки
 * @param landed - попал ли бросок; не задано — к этому времени неизвестно
 *   (серия снарядов: броски делает вызывающий уже после события)
 * @param critical - попадание критическое: урон срабатываний цели этой атаки
 *   удвоит кости
 */
export function reportAttackRoll(
  attackerId: string,
  targetIds: readonly string[],
  rollMode: AttackRollMode,
  landed?: boolean,
  critical = false,
): void {
  const attacker = findDndWorldEntity(attackerId);

  const needsServer =
    (attacker !== undefined
      && hasServerAttackRollTriggers(attacker, 'attacker'))
    || targetIds.some((targetId) => {
      const target = findDndWorldEntity(targetId);

      return (
        target !== undefined && hasServerAttackRollTriggers(target, 'target')
      );
    });

  if (needsServer) {
    emitSystemClientEvent(
      buildAttackRollEvent(attackerId, targetIds, rollMode, landed, critical),
    );
  }
}
