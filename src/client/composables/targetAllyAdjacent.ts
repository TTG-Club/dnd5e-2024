/**
 * Союзники рядом с целью — для условий «союзник рядом» («Тактика стаи»).
 *
 * Правило живёт в движке (`listAdjacentAllies`); здесь — только фишки
 * текущей сцены, выбранная цель и живые сущности мира.
 */

import type { Token } from '@vtt/shared';
import type { AdjacentAllyState } from '@vtt/shared/system/dnd.js';

import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { listAdjacentAllies } from '@vtt/shared/system/dnd.js';

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
 * Союзники бросающего рядом с целью и их состояния.
 *
 * @param attackerId - бросающий
 * @param targetEntityId - цель
 * @returns союзники; нет сцены или фишек — пусто
 */
export function findAlliesAdjacentToTarget(
  attackerId: string,
  targetEntityId: string,
): AdjacentAllyState[] {
  const scene = useWorldStore().currentScene;

  if (!scene) {
    return [];
  }

  const tokens = scene.tokens ?? [];
  const targetToken = findTargetToken(tokens, targetEntityId);

  if (!targetToken) {
    return [];
  }

  return listAdjacentAllies({
    tokens,
    gridSettings: scene.gridSettings,
    attackerId,
    targetToken,
    getEntity: useWorldEntities().findCurrentDndEntity,
  });
}
