import type {
  AttackFlagCategory,
  AttackRollMode,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import { useAuraStore } from '@/stores/auraStore';
import { useTargetStore } from '@/stores/targetStore';
import {
  isDnDEffect,
  resolveActorStats,
  resolveAttackRollMode,
} from '@vtt/shared/system/dnd.js';

/** Что известно о броске атаки, кроме флагов */
export interface TargetedAttackRollOptions {
  /** Внешняя помеха: стрельба дальше нормальной дистанции */
  forceDisadvantage?: boolean;
}

/**
 * Стартовый режим броска атаки по выбранной цели.
 *
 * Одна точка для всех путей атаки — лист и хотбар, оружие, заклинания, действия
 * и заклинания существа: флаги атакующего (свои и от аур на сцене, общие и
 * профильные), флаги «атак по цели» и внешняя помеха читаются одинаково. Раньше
 * лист собирал режим сам, и профильные флаги («помеха на дальнобойные атаки»)
 * на нём не работали.
 *
 * @param attacker - атакующая сущность
 * @param attackType - вид атаки
 * @param options - внешняя помеха
 * @returns режим броска
 */
export function resolveTargetedAttackRollMode(
  attacker: DnDSceneEntity,
  attackType: AttackFlagCategory,
  options: TargetedAttackRollOptions = {},
): AttackRollMode {
  // Ауры контракт отдаёт нейтральной базой — сужаем к D&D-форме
  const ambientEffects = useAuraStore()
    .getAmbientEffectsForActor(attacker.id)
    .filter(isDnDEffect);

  return resolveAttackRollMode({
    attackerFlags: resolveActorStats(attacker, ambientEffects).activeFlags,
    attackType,
    targetFlags: useTargetStore().getTargetFlags(),
    forceDisadvantage: options.forceDisadvantage,
  });
}
