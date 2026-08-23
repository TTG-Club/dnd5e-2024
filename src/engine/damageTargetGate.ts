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

import { resolveEntityCreatureType } from './creatureTypeGate.js';
import { targetHpGateMatches } from './effectPipeline.js';
import { resolveEntityCurrentHp, resolveEntityMaxHp } from './hitPoints.js';

/** Гейты ветки урона: по состоянию хитов цели и по её типу существа. */
export interface DamageTargetGates {
  /** Ветка применяется только к целям в этом состоянии хитов */
  targetGate?: TargetHpGate;
  /** Ветка применяется только к целям этого типа существа */
  targetTypeGate?: CreatureCategory;
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

  if (!gates.targetGate) {
    return true;
  }

  return targetHpGateMatches(
    gates.targetGate,
    resolveEntityCurrentHp(entity),
    resolveEntityMaxHp(entity),
  );
}
