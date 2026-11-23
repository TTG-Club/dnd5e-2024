import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  CELL_SIZE,
  createCreature,
  createEffect,
  createToken,
  engine,
  MAX_ROLL,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Футы эффектов на сценах в разных единицах: на сцене в футах всё как
 * раньше, на сцене в метрах (1,5 м на клетку) предел в футах пересчитывается
 * в метры одним способом (`toSceneRangeLimit`), а не сравнивается напрямую.
 */

/** Сцена в футах: 5 футов на клетку */
const FEET_GRID = {
  type: 'custom',
  cellSize: CELL_SIZE,
  scale: 5,
  units: 'ft',
  color: '',
  visible: true,
};

/** Сцена в метрах: 1,5 м на клетку */
const METER_GRID = { ...FEET_GRID, scale: 1.5, units: 'm' };

const GRIDS = [
  ['в футах', FEET_GRID],
  ['в метрах', METER_GRID],
];

describe('toSceneRangeLimit', () => {
  it('на сцене в футах предел не меняется', () => {
    assert.equal(engine.toSceneRangeLimit(5, 'ft', 'ft'), 5);
    assert.equal(engine.toSceneRangeLimit(30, 'ft', 'ft'), 30);
  });

  it('на сцене в метрах футы пересчитываются и округляются', () => {
    assert.equal(engine.toSceneRangeLimit(5, 'ft', 'm'), 2);
    assert.equal(engine.toSceneRangeLimit(10, 'ft', 'm'), 3);
    assert.equal(engine.toSceneRangeLimit(30, 'ft', 'm'), 9);
  });
});

describe('аура: радиус в футах против сцены', () => {
  const source = createToken('paladin', 0, 0);

  /**
   * Достаёт ли аура до фишки в столбце.
   *
   * @param {number} radiusFeet - радиус ауры, фт
   * @param {number} column - столбец цели
   * @param {object} grid - сетка сцены
   * @returns {boolean} достаёт ли
   */
  const reaches = (radiusFeet, column, grid) =>
    engine.isAuraReachingTarget(
      source,
      createToken('goblin', column, 0),
      radiusFeet,
      grid,
    );

  for (const [name, grid] of GRIDS) {
    it(`аура 10 фт — две клетки, не три: сцена ${name}`, () => {
      assert.equal(reaches(10, 2, grid), true);
      assert.equal(reaches(10, 3, grid), false);
    });

    it(`аура 30 фт — шесть клеток, не семь: сцена ${name}`, () => {
      assert.equal(reaches(30, 6, grid), true);
      assert.equal(reaches(30, 7, grid), false);
    });
  }

  it('«всем в радиусе» на сцене в метрах меряет тем же радиусом', () => {
    const paladin = createCreature({ id: 'paladin' });
    const near = createCreature({ id: 'near' });
    const far = createCreature({ id: 'far' });

    const surroundings = {
      token: createToken('paladin', 0, 0),
      gridSettings: METER_GRID,
      neighbors: [
        { entity: near, token: createToken('near', 2, 0) },
        { entity: far, token: createToken('far', 4, 0) },
      ],
    };

    const found = engine.findEntitiesInArea(
      surroundings,
      { radius: 10, target: 'all' },
      paladin,
    );

    assert.deepEqual(
      found.map((entity) => entity.id),
      ['near'],
    );
  });
});

describe('«союзник рядом с целью»: 5 фт против сцены', () => {
  const wolf = createCreature({ id: 'wolf' });
  const goblin = createCreature({ id: 'goblin' });
  const packmate = createCreature({ id: 'packmate' });

  const withDisposition = (creature, disposition) => ({
    ...creature,
    token: { ...creature.token, disposition },
  });

  const byId = new Map(
    [
      withDisposition(wolf, 'hostile'),
      withDisposition(goblin, 'friendly'),
      withDisposition(packmate, 'hostile'),
    ].map((entity) => [entity.id, entity]),
  );

  /**
   * Сколько союзников волка рядом с гоблином.
   *
   * @param {number} packmateColumn - столбец второго волка
   * @param {object} grid - сетка сцены
   * @returns {number} союзников рядом
   */
  const alliesNear = (packmateColumn, grid) => {
    const tokens = [
      createToken('wolf', 0, 0),
      createToken('goblin', 1, 0),
      createToken('packmate', packmateColumn, 0),
    ];

    return engine.listAdjacentAllies({
      tokens,
      gridSettings: grid,
      attackerId: 'wolf',
      targetToken: tokens[1],
      getEntity: (entityId) => byId.get(entityId),
    }).length;
  };

  for (const [name, grid] of GRIDS) {
    it(`соседняя клетка — рядом, через клетку — нет: сцена ${name}`, () => {
      assert.equal(alliesNear(2, grid), 1);
      assert.equal(alliesNear(3, grid), 0);
    });
  }
});

describe('помощь выбраться: «рядом» — 5 фт против сцены', () => {
  /**
   * Настоящий `listEntitiesNear` на сцене из строки фишек. Мера — от края до
   * края по клеткам в единицах сцены, как у меры ядра на плоской сетке.
   *
   * @param {object} grid - сетка сцены
   * @param {Record<string, number>} columns - столбцы фишек по сущностям
   * @returns {Promise<Function>} список соседей сущности
   */
  async function loadNear(grid, columns) {
    const tokens = Object.entries(columns).map(([id, column]) =>
      createToken(id, column, 0),
    );

    const unitsPerCell = grid.scale;

    const listEntitiesNear = await loadHandler(
      'src/client/composables/effectEscapeAction.ts',
      'listEntitiesNear',
      {
        useWorldStore: () => ({
          currentScene: { tokens, gridSettings: grid },
        }),
        createSceneLevelMeasure: () => (from, to) => ({
          distance:
            Math.max(0, Math.abs(from.x - to.x) / CELL_SIZE - 1) * unitsPerCell
            + unitsPerCell * Number(from.x !== to.x),
          blocked: false,
        }),
        toReachDistance: engine.toReachDistance,
        toSceneFeetLimit: engine.toSceneFeetLimit,
        useWorldEntities: () => ({
          findCurrentDndEntity: (id) => ({ id }),
        }),
      },
    );

    // Массив из песочницы обработчика — в массив теста
    return (entityId) =>
      Array.from(
        listEntitiesNear(entityId, engine.DEFAULT_REACH_FEET),
        (entity) => entity.id,
      );
  }

  for (const [name, grid] of GRIDS) {
    it(`соседняя клетка — рядом, через клетку — нет: сцена ${name}`, async () => {
      const near = await loadNear(grid, { grappled: 0, ally: 1, far: 2 });

      assert.deepEqual(near('grappled'), ['ally']);
    });
  }
});

describe('countSceneRangeSteps: шаги в футах по пути на сцене', () => {
  it('на сцене в футах — делением, как раньше', () => {
    assert.equal(engine.countSceneRangeSteps(10, 5, 'ft'), 2);
    assert.equal(engine.countSceneRangeSteps(9.6, 5, 'ft'), 1);
    assert.equal(engine.countSceneRangeSteps(35, 10, 'ft'), 3);
  });

  it('на сцене в метрах клетка 1,5 м — шаг в 5 футов', () => {
    assert.equal(engine.countSceneRangeSteps(1.5, 5, 'm'), 1);
    assert.equal(engine.countSceneRangeSteps(4.5, 5, 'm'), 3);
    assert.equal(engine.countSceneRangeSteps(15, 5, 'm'), 10);
    assert.equal(engine.countSceneRangeSteps(3, 10, 'm'), 1);
    assert.equal(engine.countSceneRangeSteps(1.5, 10, 'm'), 0);
  });
});

describe('перемещение: «за каждые N фт» и падение против сцены', () => {
  /**
   * Контекст ядра со сценой нужной сетки.
   *
   * @param {object} grid - сетка сцены
   * @returns {object} контекст срабатываний
   */
  const contextOf = (grid) => ({
    getSceneSurroundings: (entity) => ({
      token: createToken(entity.id, 0, 0),
      gridSettings: grid,
      neighbors: [],
    }),
  });

  /**
   * Сколько урона «Шипы» (1 за каждые 10 футов) нанесли за путь.
   *
   * @param {number} cells - клеток пути
   * @param {object} grid - сетка сцены
   * @returns {number} урон
   */
  function thornsDamage(cells, grid) {
    const system = new engine.Dnd5eVttSystem();

    const thorns = createEffect('Шипы', {
      triggers: [
        {
          id: 'trigger_thorns',
          event: 'moved',
          everyFeet: 10,
          actions: [{ type: 'damage', parts: [{ formula: '1@dmg.piercing' }] }],
        },
      ],
    });

    const walker = withHp(createCreature, 40, { activeEffects: [thorns] });

    system.applyMovementEffects(
      walker,
      {
        from: createToken(walker.id, 0, 0),
        to: createToken(walker.id, cells, 0),
        distance: cells * grid.scale,
        steps: [],
        forced: false,
        stopped: false,
      },
      contextOf(grid),
    );

    return 40 - engine.resolveEntityCurrentHp(walker);
  }

  for (const [name, grid] of GRIDS) {
    it(`шесть клеток — три срабатывания «за 10 футов»: сцена ${name}`, () => {
      assert.equal(thornsDamage(6, grid), 3);
    });
  }

  for (const [name, grid] of GRIDS) {
    it(`падение с шести клеток — 3к6: сцена ${name}`, () => {
      const system = new engine.Dnd5eVttSystem();
      const victim = withHp(createCreature, 40);
      const height = 6 * grid.scale;

      const result = withRandom([MAX_ROLL], () =>
        system.applyMovementEffects(
          victim,
          {
            from: createToken('victim', 0, 0, { aboveFloor: height }),
            to: createToken('victim', 0, 0),
            distance: 0,
            steps: [],
            forced: false,
            stopped: false,
            verticalDistance: height,
            fell: true,
          },
          contextOf(grid),
        ),
      );

      assert.equal(engine.resolveEntityCurrentHp(victim), 40 - 18);

      assert.match(
        result.chatSummary,
        grid.units === 'ft' ? /падает на 30 фт: 3к6/ : /падает на 9 м: 3к6/,
      );
    });
  }
});

describe('толчок и сдвиг зоны: футы действия против сцены', () => {
  for (const [name, grid] of GRIDS) {
    it(`толчок на 10 футов — на две клетки: сцена ${name}`, () => {
      const position = engine.resolveForcedMovePosition(
        { type: 'move', kind: 'push', distance: 10 },
        {
          target: createToken('goblin', 1, 0),
          origin: createToken('ogre', 0, 0),
          gridSettings: grid,
        },
      );

      assert.deepEqual(position, { x: 3 * CELL_SIZE, y: 0 });
    });

    it(`зона сдвигается на 10 футов — на две клетки: сцена ${name}`, () => {
      const offset = engine.resolveAreaShift(
        { type: 'moveArea', kind: 'away', distance: 10 },
        {
          id: 'zone',
          points: [
            { x: 0, y: 0 },
            { x: CELL_SIZE, y: 0 },
            { x: CELL_SIZE, y: CELL_SIZE },
            { x: 0, y: CELL_SIZE },
          ],
        },
        {
          recipient: createToken('goblin', 4, 0),
          gridSettings: grid,
        },
      );

      assert.ok(offset, 'зона сдвинулась');

      assert.ok(
        Math.abs(Math.hypot(offset.dx, offset.dy) - 2 * CELL_SIZE) < 1,
        `сдвиг ${offset.dx}`,
      );
    });
  }
});
