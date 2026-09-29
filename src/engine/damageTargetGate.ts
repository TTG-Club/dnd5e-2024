/**
 * Доходит ли часть урона до конкретной цели.
 *
 * Части урона разворачивает единое ядро `expandDamageParts`: условные слагаемые
 * (`@target.full`, `@target.type.undead`) оно превращает в ветки с гейтами, а
 * решение «эта ветка про эту цель или нет» принимает уже тот, кто урон
 * применяет. Мест применения три — оркестратор заклинаний, урон эффекта при
 * наложении и периодический урон, — и правило у них обязано быть одно: ветку,
 * забывшую про гейт, катают ВСЕМ, и `@target.full` превращается в двойной урон
 * (обе ветки сразу).
 *
 * @module system/dnd/damageTargetGate
 */

import type { CreatureCategory } from './creatureTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { TargetHpGate } from './spellUtils.js';

import { hasEntityCondition } from './activeEffectTypes.js';
import { BLOODIED_CONDITION_KEY } from './conditionKeys.js';
import { resolveEntityCreatureType } from './creatureTypeGate.js';
import { targetHpGateMatches } from './effectPipeline.js';
import {
  isEntityBloodied,
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
} from './hitPoints.js';

/** Гейты ветки урона: по состоянию хитов цели и по её типу существа. */
export interface DamageTargetGates {
  /** Ветка применяется только к целям в этом состоянии хитов */
  targetGate?: TargetHpGate;
  /** Ветка применяется только к целям этого типа существа */
  targetTypeGate?: CreatureCategory;
  /** Ветка применяется только к целям с этим состоянием (`@target.status.*`) */
  targetStatusGate?: string;
}

/**
 * Проходит ли ветка урона гейты для этой цели.
 *
 * Ветка без гейтов достаётся любой цели. Тип сверяется первым: он дешевле хитов
 * и чаще отсекает.
 *
 * @param gates - гейты ветки урона
 * @param entity - сущность-цель
 * @returns `true`, если ветка применяется к этой цели
 */
export function damageReachesTarget(
  gates: DamageTargetGates,
  entity: DnDSceneEntity,
): boolean {
  if (
    gates.targetTypeGate
    && resolveEntityCreatureType(entity) !== gates.targetTypeGate
  ) {
    return false;
  }

  if (
    gates.targetStatusGate
    && !entityHasDamageStatus(entity, gates.targetStatusGate)
  ) {
    return false;
  }

  if (!gates.targetGate) {
    return true;
  }

  return targetHpGateMatches(
    gates.targetGate,
    resolveEntityCurrentHp(entity),
    resolveEntityMaxHp(entity),
  );
}

/**
 * Есть ли у сущности состояние — для условий урона (`@target.status.*`,
 * `@self.status.*`, урон «или» по состоянию). «Окровавленный» считается и по
 * значку, и по одним хитам: правило значка мастер может поменять или выключить
 * в «Мастерской», а правило 2024 года — про хиты, и урон существ от этого
 * меняться не должен.
 *
 * @param entity - персонаж или существо
 * @param status - ключ состояния
 * @returns `true`, если состояние есть
 */
export function entityHasDamageStatus(
  entity: DnDSceneEntity,
  status: string,
): boolean {
  if (status === BLOODIED_CONDITION_KEY && isEntityBloodied(entity)) {
    return true;
  }

  return hasEntityCondition(entity, status);
}
