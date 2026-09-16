/**
 * Защитные эффекты цели в броске атаки: флаги и прибавки, которые включает
 * именно эта атака («Защита от добра и зла» — помеха исчадию, «Защита от
 * клинков» — атакующий вычитает 1к4).
 *
 * Условие входящей атаки знает вид атаки и тип атакующего; их собирает
 * бросающий клиент, цель — сущность текущего мира.
 */

import type {
  ActiveEffect,
  AttackFlagCategory,
  DndIncomingAttackContext,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import {
  buildFormulaContext,
  collectIncomingAttackFlags,
  collectIncomingAttackRollFormulas,
  resolveEntityCreatureType,
} from '@vtt/shared/system/dnd.js';

import { collectEffectsWithAuras } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/**
 * Входящая атака глазами цели.
 *
 * @param attacker - атакующий
 * @param attackType - вид атаки
 * @returns контекст входящей атаки
 */
export function buildIncomingAttackContext(
  attacker: DnDSceneEntity,
  attackType: AttackFlagCategory,
): DndIncomingAttackContext {
  return {
    attackType,
    attackerCreatureType: resolveEntityCreatureType(attacker),
  };
}

/**
 * Цель атаки и её действующие эффекты вместе с аурами на сцене.
 *
 * @param targetEntityId - цель
 * @returns цель и эффекты либо `null`, если цели в мире нет
 */
function findDefender(
  targetEntityId: string,
): { defender: DnDSceneEntity; effects: readonly ActiveEffect[] } | null {
  const defender = useWorldEntities().findCurrentDndEntity(targetEntityId);

  return defender
    ? { defender, effects: collectEffectsWithAuras(defender) }
    : null;
}

/**
 * Флаги цели, которые включает эта атака.
 *
 * @param attacker - атакующий
 * @param targetEntityId - цель
 * @param attackType - вид атаки
 * @returns флаги
 */
export function collectDefenderAttackFlags(
  attacker: DnDSceneEntity,
  targetEntityId: string,
  attackType: AttackFlagCategory,
): string[] {
  const found = findDefender(targetEntityId);

  return found
    ? collectIncomingAttackFlags(
        found.effects,
        buildIncomingAttackContext(attacker, attackType),
      )
    : [];
}

/**
 * Прибавки атакующему от эффектов цели («Атаки по носителю»).
 *
 * @param attacker - атакующий
 * @param targetEntityId - цель
 * @param attackType - вид атаки
 * @returns формулы для d20 атакующего
 */
export function collectDefenderRollFormulas(
  attacker: DnDSceneEntity,
  targetEntityId: string,
  attackType: AttackFlagCategory,
): string[] {
  const found = findDefender(targetEntityId);

  return found
    ? collectIncomingAttackRollFormulas(
        found.effects,
        buildIncomingAttackContext(attacker, attackType),
        buildFormulaContext(found.defender),
      )
    : [];
}
