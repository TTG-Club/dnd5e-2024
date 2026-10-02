import type {
  AttackFlagCategory,
  AttackRollMode,
  AttackRollModeReasons,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import { useTargetStore } from '@/stores/targetStore';
import {
  buildCarrierContext,
  collectRollConditionFlags,
  DEFAULT_CRIT_THRESHOLD,
  explainAttackRollMode,
  resolveActorStats,
  resolveAttackRollMode,
  resolveRollCritThreshold,
} from '@vtt/shared/system/dnd.js';

import {
  buildIncomingAttackContext,
  collectDefenderAttackFlags,
  listDefenderEffects,
} from './incomingAttack';
import { useBonusDamageParts } from './useBonusDamageParts';
import {
  buildEntityFormulaContext,
  collectEffectsWithAuras,
  listAmbientEffects,
} from './useResolvedStats';

/** Что известно о броске атаки, кроме флагов */
export interface TargetedAttackRollOptions {
  /** Внешняя помеха: стрельба дальше нормальной дистанции */
  forceDisadvantage?: boolean;
}

/** Стартовый режим броска атаки и то, откуда он взялся */
export interface TargetedAttackRoll {
  /** Режим броска */
  mode: AttackRollMode;
  /** Источники преимущества и помехи — их показывает окно броска */
  reasons: AttackRollModeReasons;
}

/**
 * Стартовый режим броска атаки по выбранной цели и его причины.
 *
 * Одна точка для всех путей атаки — лист и хотбар, оружие, заклинания, действия
 * и заклинания существа: флаги атакующего (свои и от аур на сцене, общие и
 * профильные), флаги «атак по цели» и внешняя помеха читаются одинаково. Раньше
 * лист собирал режим сам, и профильные флаги («помеха на дальнобойные атаки»)
 * на нём не работали. Эффекты «только в бросках» добавляют флаги, если их
 * условие выполнено в этой атаке: у атакующего — «Тактика стаи», у цели —
 * «Защита от добра и зла».
 *
 * Причины считаются по тем же флагам, что и режим: окно броска называет
 * источник помехи, а не просто включает её.
 *
 * @param attacker - атакующая сущность
 * @param attackType - вид атаки
 * @param options - внешняя помеха
 * @returns режим броска и его причины
 */
export function resolveTargetedAttackRoll(
  attacker: DnDSceneEntity,
  attackType: AttackFlagCategory,
  options: TargetedAttackRollOptions = {},
): TargetedAttackRoll {
  const ambientEffects = listAmbientEffects(attacker.id);
  const attackerEffects = collectEffectsWithAuras(attacker);

  const target = useBonusDamageParts().buildTargetHpContext(
    undefined,
    attacker.id,
  );

  const rollContext = {
    hasAdvantage: false,
    hasDisadvantage: false,
    target,
    self: buildCarrierContext(attacker),
  };

  const rollFlags = collectRollConditionFlags(attackerEffects, rollContext);

  const defenderFlags = target
    ? collectDefenderAttackFlags(attacker, target.entityId, attackType)
    : [];

  const attackerFlags = new Set([
    ...resolveActorStats(attacker, ambientEffects).activeFlags,
    ...rollFlags,
  ]);

  const targetFlags = new Set([
    ...useTargetStore().getTargetFlags(),
    ...defenderFlags,
  ]);

  const isBeyondNormalRange = options.forceDisadvantage === true;

  return {
    mode: resolveAttackRollMode({
      attackerFlags,
      attackType,
      targetFlags,
      forceDisadvantage: isBeyondNormalRange,
    }),
    reasons: explainAttackRollMode({
      attackType,
      attackerFlags,
      attackerEffects,
      rollContext,
      targetFlags,
      targetEffects: target ? listDefenderEffects(target.entityId) : [],
      incomingAttack: target
        ? buildIncomingAttackContext(attacker, attackType)
        : undefined,
      isBeyondNormalRange,
    }),
  };
}

/**
 * Порог крита атаки по выбранной цели: порог листа и строки эффектов с
 * условием о цели («крит на 19–20 по существам из вашего Гримуара»).
 *
 * @param attacker - атакующая сущность
 * @param sheetThreshold - порог листа; нет — порог по правилам
 * @returns порог крита для окна броска
 */
export function resolveTargetedCritThreshold(
  attacker: DnDSceneEntity,
  sheetThreshold: number | undefined,
): number | undefined {
  const target = useBonusDamageParts().buildTargetHpContext(
    undefined,
    attacker.id,
  );

  if (!target) {
    return sheetThreshold;
  }

  return resolveRollCritThreshold(
    collectEffectsWithAuras(attacker),
    sheetThreshold ?? DEFAULT_CRIT_THRESHOLD,
    {
      hasAdvantage: false,
      hasDisadvantage: false,
      target,
      self: buildCarrierContext(attacker),
    },
    buildEntityFormulaContext(attacker),
  );
}
