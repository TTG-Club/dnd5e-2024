import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Расстояние от сущности до самой себя — 0.
 *
 * Плашка «на кого применить?» мерила расстояние до выбранной фишки, а фишка
 * цели из кандидатов «своих» фишек выбрасывается (гоблин целится в другую
 * копию того же существа). Для себя список оказывался пуст, расстояния не
 * было — «Никто не выбран», и выпить своё зелье было нельзя (живая проверка
 * 03.10, Б1).
 */

const engine = await loadEngineBundle(`
  export { checkSpellRange } from './src/engine/attackUtils.ts';
  export { getTokenEdgeDistance } from '@vtt/shared';
`);

const RANGE_CHECK_PATH = 'src/client/composables/useSceneRangeCheck.ts';

/** Клетка сцены, пикс. */
const CELL = 100;

/** Сетка сцены: клетка — 5 футов */
const GRID = { cellSize: CELL, distance: 5, units: 'ft' };

/** Применение «на цель» с дальностью касания */
const TOUCH_USE = {
  id: 'potion',
  name: 'Зелье лечения',
  deliveryType: 'touch',
};

/**
 * Фишка на клетке сцены.
 *
 * @param {string} id - фишка
 * @param {string} actorId - сущность
 * @param {number} column - столбец
 * @returns {object} фишка
 */
function token(id, actorId, column) {
  return {
    id,
    actorId,
    x: column * CELL,
    y: 0,
    width: CELL,
    height: CELL,
    scale: 1,
  };
}

/**
 * Настоящие измерение и проверка дальности над сценой с этими фишками.
 *
 * @param {object[]} tokens - фишки сцены
 * @returns {Promise<object>} `measure` и `checkSpell`
 */
async function loadRangeCheck(tokens) {
  const ports = {
    useWorldStore: () => ({
      currentScene: { tokens, gridSettings: GRID },
      currentWorld: null,
    }),
    resolveTokenScale: () => 1,
    getTokenEdgeDistance: engine.getTokenEdgeDistance,
    DISTANCE_UNIT_SHORT: { ft: 'фт' },
    checkSpellRange: engine.checkSpellRange,
    Math,
  };

  ports.measureTokenDistanceOnScene = await loadHandler(
    RANGE_CHECK_PATH,
    'measureTokenDistanceOnScene',
    ports,
  );

  return {
    measure: ports.measureTokenDistanceOnScene,
    checkSpell: await loadHandler(
      RANGE_CHECK_PATH,
      'checkSpellRangeOnScene',
      ports,
    ),
  };
}

describe('расстояние до своей фишки', () => {
  it('единственная фишка применившего — расстояние 0, получатель в пределах дальности', async () => {
    const { measure, checkSpell } = await loadRangeCheck([
      token('hero-token', 'hero', 0),
      token('ogre-token', 'ogre', 6),
    ]);

    assert.equal(measure('hero', 'hero-token').distance, 0);

    const rangeCheck = checkSpell(TOUCH_USE, 'hero', 'hero-token');

    assert.equal(rangeCheck.allowed, true);
    assert.equal(rangeCheck.distance, 0);
  });

  it('чужая фишка меряется как раньше', async () => {
    const { measure } = await loadRangeCheck([
      token('hero-token', 'hero', 0),
      token('ogre-token', 'ogre', 6),
    ]);

    assert.equal(
      measure('hero', 'ogre-token').distance,
      Math.round(
        engine.getTokenEdgeDistance(
          token('hero-token', 'hero', 0),
          token('ogre-token', 'ogre', 6),
          GRID,
        ),
      ),
    );

    assert.ok(measure('hero', 'ogre-token').distance > 0);
  });

  it('копия того же существа — расстояние до ближайшей другой копии, а не 0', async () => {
    const { measure } = await loadRangeCheck([
      token('goblin-a', 'goblin', 0),
      token('goblin-b', 'goblin', 3),
    ]);

    assert.equal(
      measure('goblin', 'goblin-b').distance,
      Math.round(
        engine.getTokenEdgeDistance(
          token('goblin-a', 'goblin', 0),
          token('goblin-b', 'goblin', 3),
          GRID,
        ),
      ),
    );

    assert.ok(measure('goblin', 'goblin-b').distance > 0);
  });

  it('у атакующего нет фишки на сцене — расстояния нет', async () => {
    const { measure } = await loadRangeCheck([token('ogre-token', 'ogre', 6)]);

    assert.equal(measure('hero', 'ogre-token'), null);
  });
});
