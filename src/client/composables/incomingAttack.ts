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
  EffectTargetKey,
} from '@vtt/shared/system/dnd.js';

import { useAuraStore } from '@/stores/auraStore';
import {
  buildFormulaContext,
  collectActiveEffects,
  collectIncomingAttackFlags,
  collectIncomingAttackRollFormulas,
  combineEffectsWithAmbient,
  isDnDEffect,
  isDndSceneEntity,
  resolveEntityCreatureType,
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

/** Вид атаки по ключу прибавки к атаке */
const ATTACK_TYPE_BY_KEY: Partial<Record<EffectTargetKey, AttackFlagCategory>> =
  {
    'attack.melee': 'melee',
    'attack.ranged': 'ranged',
    'attack.spell': 'spell',
  };

/**
 * Вид атаки, к броску которой относятся ключи прибавок.
 *
 * @param keys - ключи прибавок броска
 * @returns вид атаки либо `undefined`, если бросок не атака
 */
export function resolveAttackTypeOfKeys(
  keys: readonly EffectTargetKey[],
): AttackFlagCategory | undefined {
  return keys
    .map((key) => ATTACK_TYPE_BY_KEY[key])
    .find((attackType) => attackType !== undefined);
}

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
  const defender = useWorldEntities().findCurrentWorldEntity(targetEntityId);

  if (!defender || !isDndSceneEntity(defender)) {
    return null;
  }

  // Ауры контракт отдаёт нейтральной базой — сужаем к D&D-форме
  const ambient = useAuraStore()
    .getAmbientEffectsForActor(defender.id)
    .filter(isDnDEffect);

  return {
    defender,
    effects: combineEffectsWithAmbient(collectActiveEffects(defender), ambient),
  };
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
