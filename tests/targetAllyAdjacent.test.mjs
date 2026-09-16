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
 * Выполнено ли условие о союзнике в броске.
 *
 * @param {object[]} adjacentAllies - союзники рядом с целью
 * @param {string} condition - условие броска
 * @returns {boolean} выполнено ли условие
 */
function holds(adjacentAllies, condition = 'target.allyAdjacent') {
  return engine.evaluateConditionPart(condition, {
    hasAdvantage: false,
    hasDisadvantage: false,
    target: { currentHp: 1, maxHp: 1, adjacentAllies },
  });
}

/**
 * Настоящее правило движка на одной строке клеток.
 *
 * @param {object[]} entities - сущности по порядку клеток
 * @param {object} overrides - фишки сцены поверх фишек по порядку
 * @param {string} condition - условие броска
 * @returns {boolean} выполнено ли условие для волка против гоблина
 */
function allyAdjacent(entities, overrides = {}, condition = undefined) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  const tokens = entities.map((entity, column) =>
    createToken(entity.id, overrides[entity.id] ?? column, 0),
  );

  const allies = engine.listAdjacentAllies({
    tokens,
    gridSettings: GRID,
    attackerId: entities[0].id,
    targetToken: tokens[1],
    getEntity: (entityId) => byId.get(entityId),
  });

  return holds(allies, condition);
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

  const allies = engine.listAdjacentAllies({
    tokens,
    gridSettings: GRID,
    attackerId: 'wolf',
    targetToken: tokens[1],
    getEntity: (entityId) => byId.get(entityId),
  });

  assert.deepEqual(allies, []);
});

it('другая фишка той же записи — союзник, атакует ближайшая к цели', () => {
  const byId = new Map([wolf, goblin].map((entity) => [entity.id, entity]));

  const scene = (tokens) =>
    engine.listAdjacentAllies({
      tokens,
      gridSettings: GRID,
      attackerId: 'wolf',
      targetToken: tokens[0],
      getEntity: (entityId) => byId.get(entityId),
    });

  // Стая из одного существа: две фишки волка по бокам гоблина
  const pack = [
    createToken('goblin', 1, 0),
    { ...createToken('wolf', 0, 0), id: 'token_wolf_left' },
    { ...createToken('wolf', 2, 0), id: 'token_wolf_right' },
  ];

  assert.equal(scene(pack).length, 1);

  // Вторая фишка далеко: бьёт ближняя, союзника рядом нет
  const alone = [
    createToken('goblin', 1, 0),
    { ...createToken('wolf', 5, 0), id: 'token_wolf_far' },
    { ...createToken('wolf', 0, 0), id: 'token_wolf_near' },
  ];

  assert.deepEqual(scene(alone), []);

  assert.deepEqual(
    scene([createToken('goblin', 1, 0)]),
    [],
    'у атакующего нет фишки',
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

  assert.equal(
    allyAdjacent([wolf, goblin, sleeping], {}, 'target.allyAdjacentAny'),
    true,
    '«в любом состоянии» — спящий тоже в счёт',
  );
});

it('союзник в выбранном состоянии и без него', () => {
  const prone = creatureOf('packmate', 'hostile', [
    createEffect('Лежит', { conditionKey: 'prone' }),
  ]);

  const withProne = 'target.allyAdjacentWith === "prone"';
  const withoutProne = 'target.allyAdjacentWithout === "prone"';

  assert.equal(allyAdjacent([wolf, goblin, prone], {}, withProne), true);
  assert.equal(allyAdjacent([wolf, goblin, packmate], {}, withProne), false);
  assert.equal(allyAdjacent([wolf, goblin, prone], {}, withoutProne), false);
  assert.equal(allyAdjacent([wolf, goblin, packmate], {}, withoutProne), true);
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

  const findAlliesAdjacentToTarget = await loadHandler(
    'src/client/composables/targetAllyAdjacent.ts',
    'findAlliesAdjacentToTarget',
    {
      findTargetToken,
      useWorldStore: () => ({
        currentScene: { tokens, gridSettings: GRID },
      }),
      useWorldEntities: () => ({ findCurrentDndEntity: () => undefined }),
      listAdjacentAllies: (scene) => {
        calls.push(scene);

        return [{ conditions: [] }];
      },
    },
  );

  assert.deepEqual(findAlliesAdjacentToTarget('wolf', 'goblin'), [
    { conditions: [] },
  ]);

  assert.equal(calls[0].attackerId, 'wolf');
  assert.equal(calls[0].targetToken.id, 'token_goblin_selected');
  assert.equal(calls[0].gridSettings, GRID);

  assert.deepEqual(
    // Массив из песочницы обработчика — сравниваем копию
    [...findAlliesAdjacentToTarget('wolf', 'orc')],
    [],
    'нет фишки цели',
  );

  assert.equal(calls.length, 1);
});
