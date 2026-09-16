import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/auraMath.ts';",
);

/** Клетка сцены, пикс. */
const CELL = 100;

/** Футов в клетке */
const FEET = 5;

/**
 * Фишка на клетке.
 *
 * @param {string} actorId - сущность
 * @param {number} column - столбец
 * @param {string} disposition - отношение
 * @returns {object} фишка
 */
function token(actorId, column, disposition) {
  return {
    id: `token_${actorId}`,
    actorId,
    x: column * CELL,
    y: 0,
    scale: 1,
    disposition,
  };
}

/**
 * Настоящий расчёт с фишками одной строки клеток.
 *
 * @param {object[]} tokens - фишки
 * @param {Set<string>} incapacitated - недееспособные сущности
 * @returns {Promise<Function>} расчёт
 */
function loadAllyAdjacent(tokens, incapacitated = new Set()) {
  return loadHandler(
    'src/client/composables/targetAllyAdjacent.ts',
    'isAllyAdjacentToTarget',
    {
      useWorldStore: () => ({
        currentScene: { tokens, gridSettings: { cellSize: CELL, scale: FEET } },
      }),
      useTargetStore: () => ({ targetTokenId: 'token_goblin' }),
      findTargetToken: (sceneTokens, entityId) =>
        sceneTokens.find((entry) => entry.actorId === entityId),
      useWorldEntities: () => ({
        findCurrentWorldEntity: (id) => ({ id }),
      }),
      isDndSceneEntity: () => true,
      resolveActorStats: (entity) => ({
        activeFlags: new Set(
          incapacitated.has(entity.id) ? ['incapacitated'] : [],
        ),
      }),
      getRelativeDisposition: engine.getRelativeDisposition,
      // Зазор между клетками одной строки: соседняя клетка — 0 фт
      getTokenEdgeDistance: (left, right) =>
        Math.max(0, (Math.abs(left.x - right.x) / CELL - 1) * FEET),
      ALLY_ADJACENT_REACH: 5,
      INCAPACITATED_FLAG: 'incapacitated',
    },
  );
}

it('союзник волка рядом с гоблином даёт «союзник рядом»', async () => {
  const isAdjacent = await loadAllyAdjacent([
    token('wolf', 0, 'hostile'),
    token('goblin', 1, 'friendly'),
    token('packmate', 2, 'hostile'),
  ]);

  assert.equal(isAdjacent('wolf', 'goblin'), true);
});

it('далёкий союзник, враг рядом и недееспособный союзник не считаются', async () => {
  const far = await loadAllyAdjacent([
    token('wolf', 0, 'hostile'),
    token('goblin', 1, 'friendly'),
    token('packmate', 4, 'hostile'),
  ]);

  assert.equal(far('wolf', 'goblin'), false, 'союзник в 10 фт от цели');

  const enemyNear = await loadAllyAdjacent([
    token('wolf', 0, 'hostile'),
    token('goblin', 1, 'friendly'),
    token('guard', 2, 'friendly'),
  ]);

  assert.equal(enemyNear('wolf', 'goblin'), false, 'рядом союзник цели');

  const sleeping = await loadAllyAdjacent(
    [
      token('wolf', 0, 'hostile'),
      token('goblin', 1, 'friendly'),
      token('packmate', 2, 'hostile'),
    ],
    new Set(['packmate']),
  );

  assert.equal(sleeping('wolf', 'goblin'), false, 'союзник спит');
});

it('сам атакующий рядом с целью союзником не считается', async () => {
  const alone = await loadAllyAdjacent([
    token('wolf', 0, 'hostile'),
    token('goblin', 1, 'friendly'),
  ]);

  assert.equal(alone('wolf', 'goblin'), false);
});
