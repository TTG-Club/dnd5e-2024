/**
 * «Рядом с целью союзник» — условие `target.allyAdjacent` («Тактика стаи»).
 *
 * Правило живёт в движке (`hasAllyAdjacentToTarget`); здесь — только фишки
 * текущей сцены, выбранная цель и живые сущности мира.
 */

import type { Token } from '@vtt/shared';

import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { hasAllyAdjacentToTarget } from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

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
 * @returns `true`, если союзник рядом с целью
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

  return hasAllyAdjacentToTarget({
    tokens,
    gridSettings: scene.gridSettings,
    attackerToken,
    targetToken,
    getEntity: useWorldEntities().findCurrentDndEntity,
  });
}
