/**
 * 3D-мера текущей сцены для проверок дальности и досягаемости на клиенте.
 *
 * Правило — в движке (`sceneLevels.ts`): этажи, высота полёта, рост по
 * размеру, перекрытие без проёма и стены на высоте своего отрезка (удар и
 * заклинание по цели идут тем же 3D-лучом, что и взгляд). Здесь только
 * подстановка сцены, масштаба фишки и сущности мира. Модель вертикали и луч
 * строятся один раз на меру: в цикле по фишкам сцены их не пересобирать.
 */

import type { Scene, Token } from '@vtt/shared';
import type { LevelDistance } from '@vtt/shared/system/dnd.js';

import { resolveTokenScale } from '@/core/entityUtils';
import { useWorldStore } from '@/stores/worldStore';
import {
  buildLevelSight,
  measureLevelDistance,
  toLevelSubject,
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

/** Мера между двумя фишками одной сцены */
export type SceneLevelMeasure = (tokenA: Token, tokenB: Token) => LevelDistance;

/**
 * Мера расстояния между фишками сцены в 3D с признаком преграды: перекрытия
 * или стены.
 *
 * @param scene - сцена фишек
 * @returns мера
 */
export function createSceneLevelMeasure(scene: Scene): SceneLevelMeasure {
  const { currentWorld } = useWorldStore();
  const { findCurrentDndEntity } = useWorldEntities();
  const preparedSight = buildLevelSight(scene);

  /**
   * Фишка как участник меры: масштаб и рост её сущности.
   *
   * @param token - фишка
   * @returns участник
   */
  const toSubject = (token: Token) =>
    toLevelSubject(
      token,
      findCurrentDndEntity(token.actorId),
      resolveTokenScale(currentWorld, token),
    );

  return (tokenA, tokenB) =>
    measureLevelDistance(
      preparedSight.model,
      toSubject(tokenA),
      toSubject(tokenB),
      preparedSight,
    );
}
