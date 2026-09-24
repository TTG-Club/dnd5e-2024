import type {
  DnDSceneEntity,
  EffectTargetKey,
  RollContext,
} from '@vtt/shared/system/dnd.js';

import { computed } from 'vue';

import { useProjectileStore } from '@/stores/projectileStore';
import { useWorldStore } from '@/stores/worldStore';
import {
  buildCarrierContext,
  buildFormulaContext,
  collectBonusRollFormulas,
  getAttackFlagCategoryOfKeys,
  isDndSceneEntity,
} from '@vtt/shared/system/dnd.js';

import { collectDefenderRollFormulas } from './incomingAttack';
import { findAlliesAdjacentToTarget } from './targetAllyAdjacent';
import { useBonusDamageParts } from './useBonusDamageParts';
import { useResolvedStats } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/** Сборщик кубиковых бонусов d20-проверки по фактическому режиму броска. */
export type RollBonusEvaluator = (context: RollContext) => string[];

/**
 * Цель, переданная явно (цель серии снарядов), с «союзником рядом» от
 * бросающего: без бросающего его не посчитать.
 *
 * @param target - цель из контекста
 * @param attackerId - бросающий
 * @returns цель для условий
 */
function withAdjacentAllies(
  target: RollContext['target'],
  attackerId: string,
): RollContext['target'] {
  if (!target?.entityId || target.adjacentAllies !== undefined) {
    return target;
  }

  return {
    ...target,
    adjacentAllies: findAlliesAdjacentToTarget(attackerId, target.entityId),
  };
}

/**
 * Создаёт сборщик актуальных бонусных костей для окна атаки или спасброска.
 * Читает носителя и ауры при броске, чтобы снятый после открытия окна эффект не сработал.
 * У атаки к своим прибавкам добавляются прибавки от эффектов цели («Атаки по
 * носителю»).
 * @param getEntity - текущая сущность, выполняющая бросок
 * @param targetKeys - ключ бонуса атаки, спасброска или проверки; у спасброска
 *   концентрации их два
 * @returns сборщик формул по фактическому режиму броска
 */
export function buildRollBonusEvaluator(
  getEntity: () => DnDSceneEntity | null | undefined,
  targetKeys: EffectTargetKey | readonly EffectTargetKey[],
): RollBonusEvaluator {
  const keys = typeof targetKeys === 'string' ? [targetKeys] : targetKeys;
  const attackType = getAttackFlagCategoryOfKeys(keys);
  const { combinedEffects } = useResolvedStats(computed(getEntity));
  const { buildTargetHpContext } = useBonusDamageParts();

  return (context) => {
    const entity = getEntity();

    if (!entity) {
      return [];
    }

    const rollContext = {
      ...context,
      // Явно переданная неизвестная цель не заменяется отдельно выбранным токеном.
      target:
        'target' in context
          ? withAdjacentAllies(context.target, entity.id)
          : buildTargetHpContext(undefined, entity.id),
      self: buildCarrierContext(entity),
    };

    const formulaContext = buildFormulaContext(entity);
    const targetEntityId = rollContext.target?.entityId;

    const ownFormulas = keys.flatMap((targetKey) =>
      collectBonusRollFormulas(
        combinedEffects.value,
        targetKey,
        rollContext,
        formulaContext,
      ),
    );

    return attackType && targetEntityId
      ? [
          ...ownFormulas,
          ...collectDefenderRollFormulas(entity, targetEntityId, attackType),
        ]
      : ownFormulas;
  };
}

/**
 * Фиксирует кубиковые бонусы по назначенным токенам до расхода эффектов атаки.
 * Общий выбранный токен не участвует: условия проверяются для каждой цели серии.
 * @param context - режим броска серии
 * @param evaluateBonuses - сборщик актуальных эффектов атакующего
 * @returns формулы каждой назначенной цели; отсутствующие сущности пропускаются
 */
export function collectProjectileRollBonuses(
  context: RollContext,
  evaluateBonuses: RollBonusEvaluator,
): ReadonlyMap<string, readonly string[]> {
  const projectileStore = useProjectileStore();
  const scene = useWorldStore().currentScene;
  const formulasByTarget = new Map<string, readonly string[]>();

  if (!projectileStore.isActive || !scene) {
    return formulasByTarget;
  }

  const { getCurrentWorldEntities } = useWorldEntities();
  const { buildTargetHpContext } = useBonusDamageParts();

  const entitiesById = new Map(
    getCurrentWorldEntities().map((entity) => [entity.id, entity]),
  );

  const tokensById = new Map(scene.tokens.map((token) => [token.id, token]));

  for (const tokenId of projectileStore.assignedTargets.keys()) {
    const token = tokensById.get(tokenId);
    const target = token?.actorId ? entitiesById.get(token.actorId) : undefined;

    if (!target || !isDndSceneEntity(target)) {
      continue;
    }

    formulasByTarget.set(
      tokenId,
      evaluateBonuses({
        ...context,
        target: buildTargetHpContext(target),
      }),
    );
  }

  return formulasByTarget;
}
