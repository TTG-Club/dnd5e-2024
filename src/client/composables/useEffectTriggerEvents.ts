import type { IncomingAttackContext } from '@vtt/shared';
import type {
  AttackRollMode,
  DnDSceneEntity,
  EffectTriggerAttackRole,
  HeldAttackEffect,
} from '@vtt/shared/system/dnd.js';

import type { AttackRollSnapshot } from './attackRollSnapshot';

import { useProjectileStore } from '@/stores/projectileStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import {
  buildAttackRollEvent,
  cloneEntityData,
  hasServerAttackRollTriggers,
  isDndSceneEntity,
  listHeldAttackEffects,
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
 *
 * Израсходованный эффект действует на саму эту атаку и уходит после неё:
 * расход уезжает на сервер сразу, а бросок запоминает израсходованные эффекты
 * в снимке (`AttackRollSnapshot`) — по нему разбор считает удар, пришёл ответ
 * сервера или нет (`attackRollSnapshot.ts`).
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
 * @param attackType - чем бьют: условия об атаке читают вид
 * @returns эффекты стороны, израсходованные броском, — какими были до него;
 *   расхода не было — пусто
 */
function settleAttackRollSide(
  side: AttackRollSide,
  rollMode: AttackRollMode,
  attackType?: IncomingAttackContext['attackType'],
): HeldAttackEffect[] {
  const { entityId, role } = side;

  let held: HeldAttackEffect[] = [];

  // Боевым каналом: снятие с ЦЕЛИ сервер принимает только так — полную замену
  // чужой сущности он берёт лишь от владельца. Снимок несёт разницу эффектов:
  // запись урона, которую оркестратор соберёт позже из стора (ответ сервера
  // ещё не пришёл), снятый здесь эффект не вернёт — правка стора на месте
  // для этого больше не нужна
  changeEntityCombatState(entityId, (current) => {
    // Deep clone: shallow spread теряет вложенные Vue reactive-свойства
    const updated = cloneEntityData(current);

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

    if (!result.changed) {
      return null;
    }

    // Копии: запись стора ответ сервера заменит, а удар считается по
    // эффектам, какими они были до расхода
    held = cloneEntityData(
      listHeldAttackEffects(
        current.activeEffects ?? [],
        updated.activeEffects ?? [],
      ),
    );

    return updated;
  });

  return held;
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
 * @returns снимок броска: цели (для сообщения серверу после урона) и
 *   эффекты сторон, израсходованные броском, — по ним считается этот удар
 */
export function dispatchAttackRollTriggers(
  attackerId: string,
  options: {
    projectile: boolean;
    rollMode: AttackRollMode;
    attackType?: IncomingAttackContext['attackType'];
  },
): AttackRollSnapshot {
  const targetIds = listAttackTargetIds(options.projectile);
  const held = new Map<string, HeldAttackEffect[]>();

  /**
   * Расходует срабатывания стороны и запоминает израсходованные эффекты.
   *
   * @param side - сторона атаки
   */
  const settle = (side: AttackRollSide): void => {
    const consumed = settleAttackRollSide(
      side,
      options.rollMode,
      options.attackType,
    );

    if (consumed.length > 0) {
      held.set(side.entityId, consumed);
    }
  };

  try {
    // Другая сторона атакующего однозначна только при одной цели
    settle({
      entityId: attackerId,
      role: 'attacker',
      otherId: targetIds.length === 1 ? targetIds[0] : undefined,
    });

    for (const targetId of targetIds) {
      settle({ entityId: targetId, role: 'target', otherId: attackerId });
    }
  } catch (error) {
    console.error(TRIGGER_EVENTS_LOG_PREFIX, error);
  }

  return { attackerId, targetIds, held };
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
