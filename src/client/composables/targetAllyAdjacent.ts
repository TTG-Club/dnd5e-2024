/**
 * «Рядом с целью союзник» — условие `target.allyAdjacent` («Тактика стаи»).
 *
 * Считается по фишкам текущей сцены: союзник — фишка того же действующего
 * отношения, что и фишка бросающего (`withTokenDisposition` ядра: отношение
 * живёт в настройках фишки сущности), не сам бросающий и не цель, в пределах
 * досягаемости от края до края, и его сущность дееспособна.
 */

import type { Token } from '@vtt/shared';

import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { getTokenEdgeDistance, withTokenDisposition } from '@vtt/shared';
import {
  getRelativeDisposition,
  isDndSceneEntity,
  resolveActorStats,
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

/** Досягаемость союзника до цели, фт */
export const ALLY_ADJACENT_REACH = 5;

/** Флаг недееспособности союзника */
const INCAPACITATED_FLAG = 'incapacitated';

/**
 * Фишка цели на сцене: выбранная целью, иначе первая фишка сущности.
 *
 * @param tokens - фишки сцены
 * @param targetEntityId - сущность цели
 * @returns фишка либо `undefined`
 */
function findTargetToken(
  tokens: readonly Token[],
  targetEntityId: string,
): Token | undefined {
  const { targetTokenId } = useTargetStore();

  const selected = tokens.find(
    (token) => token.id === targetTokenId && token.actorId === targetEntityId,
  );

  return selected ?? tokens.find((token) => token.actorId === targetEntityId);
}

/**
 * Стоит ли рядом с целью дееспособный союзник бросающего.
 *
 * @param attackerId - бросающий
 * @param targetEntityId - цель
 * @returns `true`, если союзник в 5 фт от цели
 */
export function isAllyAdjacentToTarget(
  attackerId: string,
  targetEntityId: string,
): boolean {
  const scene = useWorldStore().currentScene;

  if (!scene) {
    return false;
  }

  const tokens = scene.tokens ?? [];
  const attackerToken = tokens.find((token) => token.actorId === attackerId);
  const targetToken = findTargetToken(tokens, targetEntityId);

  if (!attackerToken || !targetToken) {
    return false;
  }

  const { findCurrentWorldEntity } = useWorldEntities();
  const attacker = findCurrentWorldEntity(attackerId);

  const attackerSide = withTokenDisposition(
    attackerToken,
    attacker && isDndSceneEntity(attacker) ? attacker : undefined,
  );

  return tokens.some((token) => {
    if (
      token.actorId === attackerId
      || token.actorId === targetEntityId
      || getTokenEdgeDistance(token, targetToken, scene.gridSettings)
        > ALLY_ADJACENT_REACH
    ) {
      return false;
    }

    const ally = findCurrentWorldEntity(token.actorId);

    return (
      ally !== undefined
      && isDndSceneEntity(ally)
      && getRelativeDisposition(attackerSide, withTokenDisposition(token, ally))
        === 'ally'
      && !resolveActorStats(ally).activeFlags.has(INCAPACITATED_FLAG)
    );
  });
}
