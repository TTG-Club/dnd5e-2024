import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createCreature,
  createEffect,
  createToken,
  engine,
} from './scenarios/_fixtures.mjs';

/** Сетка со своим размером клетки: соседние фишки — в 5 фт */
const GRID = {
  type: 'custom',
  cellSize: 100,
  scale: 5,
  color: '',
  visible: true,
};

/**
 * Существо с отношением в настройках фишки.
 *
 * @param {string} id - сущность
 * @param {string} disposition - отношение
 * @param {object[]} activeEffects - эффекты
 * @returns {object} существо
 */
function creatureOf(id, disposition, activeEffects = []) {
  const creature = createCreature({ id, activeEffects });

  return { ...creature, token: { ...creature.token, disposition } };
}

/**
 * Настоящее правило движка на одной строке клеток.
 *
 * @param {object[]} entities - сущности по порядку клеток
 * @param {object} overrides - фишки сцены поверх фишек по порядку
 * @returns {boolean} есть ли союзник волка рядом с гоблином
 */
function allyAdjacent(entities, overrides = {}) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  const tokens = entities.map((entity, column) =>
    createToken(entity.id, overrides[entity.id] ?? column, 0),
  );

  return engine.hasAllyAdjacentToTarget({
    tokens,
    gridSettings: GRID,
    attackerToken: tokens[0],
    targetToken: tokens[1],
    getEntity: (entityId) => byId.get(entityId),
  });
}

const wolf = creatureOf('wolf', 'hostile');
const goblin = creatureOf('goblin', 'friendly');
const packmate = creatureOf('packmate', 'hostile');

it('союзник волка рядом с гоблином даёт «союзник рядом»', () => {
  assert.equal(allyAdjacent([wolf, goblin, packmate]), true);
});

it('отношение берётся из настроек фишки сущности, а не с фишки сцены', () => {
  const guard = creatureOf('guard', 'friendly');

  const byId = new Map(
    [wolf, goblin, guard].map((entity) => [entity.id, entity]),
  );

  // Поле фишки сцены говорит «враждебный», настройки сущности — «дружелюбный»
  const tokens = [
    createToken('wolf', 0, 0),
    createToken('goblin', 1, 0),
    createToken('guard', 2, 0, { disposition: 'hostile' }),
  ];

  assert.equal(
    engine.hasAllyAdjacentToTarget({
      tokens,
      gridSettings: GRID,
      attackerToken: tokens[0],
      targetToken: tokens[1],
      getEntity: (entityId) => byId.get(entityId),
    }),
    false,
  );
});

it('далёкий союзник, враг рядом и недееспособный союзник не считаются', () => {
  assert.equal(
    allyAdjacent([wolf, goblin, packmate], { packmate: 4 }),
    false,
    'союзник в 10 фт от цели',
  );

  assert.equal(
    allyAdjacent([wolf, goblin, creatureOf('guard', 'friendly')]),
    false,
    'рядом союзник цели',
  );

  const sleeping = creatureOf('packmate', 'hostile', [
    createEffect('Сон', { flags: ['incapacitated'] }),
  ]);

  assert.equal(allyAdjacent([wolf, goblin, sleeping]), false, 'союзник спит');
});

it('сам атакующий рядом с целью союзником не считается', () => {
  assert.equal(allyAdjacent([wolf, goblin]), false);
});

it('клиент отдаёт правилу фишки сцены, выбранную цель и живые сущности', async () => {
  const calls = [];

  const tokens = [
    createToken('wolf', 0, 0),
    createToken('goblin', 1, 0),
    { ...createToken('goblin', 3, 0), id: 'token_goblin_selected' },
  ];

  const useTargetStore = () => ({ targetTokenId: 'token_goblin_selected' });

  const findTargetToken = await loadHandler(
    'src/client/composables/targetAllyAdjacent.ts',
    'findTargetToken',
    { useTargetStore },
  );

  const isAllyAdjacentToTarget = await loadHandler(
    'src/client/composables/targetAllyAdjacent.ts',
    'isAllyAdjacentToTarget',
    {
      findTargetToken,
      useWorldStore: () => ({
        currentScene: { tokens, gridSettings: GRID },
      }),
      useWorldEntities: () => ({ findCurrentDndEntity: () => undefined }),
      hasAllyAdjacentToTarget: (scene) => {
        calls.push(scene);

        return true;
      },
    },
  );

  assert.equal(isAllyAdjacentToTarget('wolf', 'goblin'), true);
  assert.equal(calls[0].attackerToken.id, 'token_wolf');
  assert.equal(calls[0].targetToken.id, 'token_goblin_selected');
  assert.equal(calls[0].gridSettings, GRID);

  assert.equal(isAllyAdjacentToTarget('bear', 'goblin'), false, 'нет фишки');
  assert.equal(calls.length, 1);
});
