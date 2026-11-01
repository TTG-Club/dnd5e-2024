import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  CELL_SIZE,
  createCreature,
  createEffect,
  createToken,
  engine,
} from './scenarios/_fixtures.mjs';

/** Сетка D&D: клетка 100 пикселей, 5 футов */
const GRID = {
  type: 'custom',
  cellSize: CELL_SIZE,
  scale: 5,
  units: 'ft',
  color: '',
  visible: true,
};

/** Пол второго этажа на 10 футах: потолок первого — 10 футов */
const UPPER_FLOOR = {
  id: 'upper',
  name: '2 этаж',
  bottom: 10,
  wallHeight: 10,
};

/** Нижний этаж с высотой стен под второй */
const BASE_FLOOR = {
  id: 'base',
  name: 'Основной',
  bottom: 0,
  wallHeight: 10,
};

/**
 * Квадратный многоугольник по клеткам.
 *
 * @param {number} fromColumn - левая клетка
 * @param {number} fromRow - верхняя клетка
 * @param {number} toColumn - правая клетка (не включая)
 * @param {number} toRow - нижняя клетка (не включая)
 * @returns {object[]} вершины, пиксели
 */
function cellsPolygon(fromColumn, fromRow, toColumn, toRow) {
  return [
    { x: fromColumn * CELL_SIZE, y: fromRow * CELL_SIZE },
    { x: toColumn * CELL_SIZE, y: fromRow * CELL_SIZE },
    { x: toColumn * CELL_SIZE, y: toRow * CELL_SIZE },
    { x: fromColumn * CELL_SIZE, y: toRow * CELL_SIZE },
  ];
}

/**
 * Модель вертикали сцены.
 *
 * @param {object} options - этажи и области
 * @returns {object} модель
 */
function modelOf(options = {}) {
  return engine.buildLevelModel({ gridSettings: GRID, ...options });
}

/** Двухэтажная сцена: второй этаж — пол по всей сцене */
const twoFloors = { floors: [BASE_FLOOR, UPPER_FLOOR] };

/** Проём в полу второго этажа над клетками (3..5, 0..2) */
const hatch = {
  id: 'hatch',
  kind: 'opening',
  name: 'Люк',
  points: cellsPolygon(3, 0, 5, 2),
  floorId: 'upper',
  passes: { movement: true, sight: true, light: true, sound: true },
};

describe('3D-расстояние и досягаемость', () => {
  it('летун в 10 футах над средним существом — в 10 футах', () => {
    const measured = engine.measureLevelDistance(
      modelOf(),
      { token: createToken('fighter', 0, 0) },
      { token: createToken('flyer', 0, 0, { aboveFloor: 10 }) },
    );

    assert.equal(measured.distance, 10);
    assert.equal(measured.horizontalDistance, 0);
    assert.equal(measured.blocked, false);
  });

  it('летун, касающийся макушки, — в досягаемости 5 футов', () => {
    const measured = engine.measureLevelDistance(
      modelOf(),
      { token: createToken('fighter', 0, 0) },
      { token: createToken('flyer', 1, 0, { aboveFloor: 5 }) },
    );

    assert.equal(measured.distance, 5);
  });

  it('на полу соседние фишки — 5 футов, как плоская мера', () => {
    const measured = engine.measureLevelDistance(
      modelOf(twoFloors),
      { token: createToken('fighter', 0, 0) },
      { token: createToken('goblin', 1, 1) },
    );

    assert.equal(measured.distance, 5);
  });

  it('удар сквозь пол не достаёт: этаж выше без проёма', () => {
    const model = modelOf({
      floors: [
        { ...BASE_FLOOR, wallHeight: 5 },
        { ...UPPER_FLOOR, bottom: 5 },
      ],
    });

    const reach = engine.getLevelReachDistance(
      model,
      { token: createToken('goblin', 0, 0) },
      { token: createToken('ogre', 0, 0, { floorId: 'upper' }) },
    );

    assert.equal(reach, Number.POSITIVE_INFINITY);
  });

  it('сквозь открытый люк — достаёт на 3D-расстояние', () => {
    const measured = engine.measureLevelDistance(
      modelOf({ ...twoFloors, structures: [hatch] }),
      { token: createToken('goblin', 3, 0) },
      { token: createToken('archer', 4, 0, { floorId: 'upper' }) },
    );

    assert.equal(measured.blocked, false);
    assert.equal(measured.distance, 10);
  });

  it('закрытый люк — снова перекрытие', () => {
    const closed = {
      ...hatch,
      kind: 'hatch',
      state: 'closed',
      access: 'none',
    };

    const measured = engine.measureLevelDistance(
      modelOf({ ...twoFloors, structures: [closed] }),
      { token: createToken('goblin', 3, 0) },
      { token: createToken('archer', 3, 0, { floorId: 'upper' }) },
    );

    assert.equal(measured.blocked, true);
  });

  it('лучник с края балкона достаёт до двора, из глубины — нет', () => {
    // Пол второго этажа — только балкон над клетками 4..8
    const balcony = {
      ...twoFloors,
      structures: [
        {
          id: 'balcony-contour',
          kind: 'floor-contour',
          floorId: 'upper',
          points: cellsPolygon(4, 0, 8, 4),
        },
      ],
    };

    const model = modelOf(balcony);
    const goblin = { token: createToken('goblin', 2, 1) };

    const edge = engine.measureLevelDistance(model, goblin, {
      token: createToken('archer', 4, 1, { floorId: 'upper' }),
    });

    const deep = engine.measureLevelDistance(model, goblin, {
      token: createToken('archer', 6, 1, { floorId: 'upper' }),
    });

    assert.equal(edge.blocked, false);
    assert.equal(deep.blocked, true);
  });

  it('рост по размеру и лёжа ниже', () => {
    const ogre = createCreature({ system: { ...createCreature().system } });

    ogre.system.size = 'large';
    assert.equal(engine.resolveDndEntityHeight(ogre), 10);

    const prone = {
      ...ogre,
      activeEffects: [createEffect('prone', { conditionKey: 'prone' })],
    };

    assert.equal(engine.resolveDndEntityHeight(prone), 5);
  });
});

describe('«Тактика стаи» и этажи', () => {
  /**
   * Существо с отношением в настройках фишки.
   *
   * @param {string} id - сущность
   * @param {string} disposition - отношение
   * @returns {object} существо
   */
  function creatureOf(id, disposition) {
    const creature = createCreature({ id });

    return { ...creature, token: { ...creature.token, disposition } };
  }

  const wolf = creatureOf('wolf', 'hostile');
  const goblin = creatureOf('goblin', 'friendly');
  const packmate = creatureOf('packmate', 'hostile');

  const byId = new Map(
    [wolf, goblin, packmate].map((entry) => [entry.id, entry]),
  );

  /**
   * Союзники волка рядом с гоблином.
   *
   * @param {object} packmateOverrides - где стоит второй волк
   * @param {object[]} floors - этажи сцены
   * @returns {object[]} союзники рядом
   */
  function alliesNearGoblin(packmateOverrides, floors) {
    const tokens = [
      createToken('wolf', 0, 0),
      createToken('goblin', 1, 0),
      createToken('packmate', 2, 0, packmateOverrides),
    ];

    return engine.listAdjacentAllies({
      tokens,
      gridSettings: GRID,
      floors,
      attackerId: 'wolf',
      targetToken: tokens[1],
      getEntity: (entityId) => byId.get(entityId),
    });
  }

  it('союзник рядом на том же этаже — в счёт', () => {
    assert.equal(alliesNearGoblin({}, twoFloors.floors).length, 1);
  });

  it('союзник этажом выше за перекрытием — не в счёт', () => {
    const floors = [
      { ...BASE_FLOOR, wallHeight: 5 },
      { ...UPPER_FLOOR, bottom: 5 },
    ];

    assert.equal(alliesNearGoblin({ floorId: 'upper' }, floors).length, 0);
  });

  it('союзник-летун высоко над целью — не рядом', () => {
    assert.equal(alliesNearGoblin({ aboveFloor: 15 }, undefined).length, 0);
  });
});

describe('ауры по вертикали', () => {
  const source = createToken('paladin', 0, 0);

  it('летун над аурой в 10 футов: зазор 15 — мимо, 5 — в ауре', () => {
    const high = createToken('flyer', 0, 0, { aboveFloor: 20 });
    const low = createToken('flyer', 0, 0, { aboveFloor: 10 });
    const levels = engine.buildGridAuraLevels(GRID);

    assert.equal(
      engine.isAuraReachingTarget(
        source,
        high,
        10,
        GRID,
        engine.resolveAuraVertical(levels, source, high),
      ),
      false,
    );

    assert.equal(
      engine.isAuraReachingTarget(
        source,
        low,
        10,
        GRID,
        engine.resolveAuraVertical(levels, source, low),
      ),
      true,
    );
  });

  it('без высоты — тот же ответ, что по плану', () => {
    const target = createToken('goblin', 2, 0);
    const levels = engine.buildGridAuraLevels(GRID);

    assert.equal(
      engine.isAuraReachingTarget(
        source,
        target,
        10,
        GRID,
        engine.resolveAuraVertical(levels, source, target),
      ),
      engine.isAuraReachingTarget(source, target, 10, GRID),
    );
  });

  it('сквозь перекрытие аура не проходит', () => {
    const levels = { model: modelOf(twoFloors) };
    const above = createToken('ally', 0, 0, { floorId: 'upper' });

    assert.equal(
      engine.isAuraReachingTarget(
        source,
        above,
        30,
        GRID,
        engine.resolveAuraVertical(levels, source, above),
      ),
      false,
    );
  });

  it('хук ядра auraReachesVertically: зазор против радиуса', () => {
    const system = new engine.Dnd5eVttSystem();
    const subject = (bottom, top) => ({ verticalRange: { bottom, top } });

    assert.equal(
      system.auraReachesVertically(
        { radius: 10 },
        subject(0, 5),
        subject(15, 20),
      ),
      true,
    );

    assert.equal(
      system.auraReachesVertically(
        { radius: 10 },
        subject(0, 5),
        subject(20, 25),
      ),
      false,
    );
  });
});

describe('шаблоны в объёме', () => {
  /** Огненный шар: сфера радиусом 20 футов с центром во дворе */
  const fireball = {
    id: 'fireball',
    type: 'circle',
    originX: 250,
    originY: 200,
    targetX: 650,
    targetY: 200,
  };

  /** Сцена с балконом над клетками 4..8 на 10 футах */
  const balconyScene = {
    ...twoFloors,
    structures: [
      {
        id: 'balcony-contour',
        kind: 'floor-contour',
        floorId: 'upper',
        points: cellsPolygon(4, 0, 8, 4),
      },
    ],
  };

  it('сфера огненного шара задевает стоящего на балконе', () => {
    const onBalcony = createToken('archer', 4, 1, { floorId: 'upper' });

    const found = engine.findTokensInTemplate(
      fireball,
      [onBalcony],
      CELL_SIZE,
      {
        model: modelOf(balconyScene),
      },
    );

    assert.deepEqual(
      found.map((token) => token.id),
      ['token_archer'],
    );
  });

  it('сфера с балкона задевает двор за краем балкона', () => {
    const below = createToken('goblin', 2, 1);

    const found = engine.findTokensInTemplate(
      { ...fireball, floorId: 'upper' },
      [below],
      CELL_SIZE,
      { model: modelOf(balconyScene) },
    );

    assert.deepEqual(
      found.map((token) => token.id),
      ['token_goblin'],
    );
  });

  it('сплошная стена на одном этаже блокирует сферу', () => {
    const behindWall = createToken('goblin', 4, 1);

    const sceneWithWall = {
      ...twoFloors,
      gridSettings: GRID,
      drawings: [
        {
          id: 'solid-wall',
          type: 'wall',
          points: [300, 0, 300, 400],
          vision: 'normal',
          light: 'normal',
        },
      ],
    };

    const candidates = engine.listAreaCandidates(
      fireball,
      [behindWall],
      CELL_SIZE,
      [createCreature({ id: 'goblin' })],
      sceneWithWall,
    );

    assert.deepEqual(candidates, []);
  });

  it('сфера не жжёт сквозь пол комнату над точкой начала', () => {
    const above = createToken('archer', 2, 2, { floorId: 'upper' });

    const found = engine.findTokensInTemplate(fireball, [above], CELL_SIZE, {
      model: modelOf(twoFloors),
    });

    assert.equal(found.length, 0);
  });

  it('сфера: летун на 25 футах над центром — вне шара', () => {
    const flyer = createToken('flyer', 2, 2, { aboveFloor: 25 });
    const levels = { model: modelOf() };

    assert.equal(
      engine.findTokensInTemplate(fireball, [flyer], CELL_SIZE, levels).length,
      0,
    );

    assert.equal(
      engine.findTokensInTemplate(fireball, [flyer], CELL_SIZE).length,
      1,
    );
  });

  it('цилиндр — своей высоты, круг — сфера', () => {
    const origin = { x: 250, y: 200, z: 0 };
    const cylinder = { ...fireball, type: 'cylinder', height: 40 };
    const highPoint = { x: 300, y: 200, z: 30 };

    assert.equal(
      engine.isPointInTemplateVolume(highPoint, origin, cylinder, CELL_SIZE, 5),
      true,
    );

    assert.equal(
      engine.isPointInTemplateVolume(highPoint, origin, fireball, CELL_SIZE, 5),
      false,
    );

    assert.equal(
      engine.isPointInTemplateVolume(
        { ...highPoint, z: 45 },
        origin,
        cylinder,
        CELL_SIZE,
        5,
      ),
      false,
    );
  });

  it('куб вверх на сторону, линия — на полширины', () => {
    const origin = { x: 0, y: 0, z: 0 };

    const cube = {
      ...fireball,
      type: 'rect',
      originX: 0,
      originY: 0,
      targetX: 300,
      targetY: 300,
    };

    const line = {
      ...fireball,
      type: 'ray',
      originX: 0,
      originY: 50,
      targetX: 600,
      targetY: 50,
      width: 100,
    };

    assert.equal(
      engine.isPointInTemplateVolume(
        { x: 150, y: 150, z: 14 },
        origin,
        cube,
        CELL_SIZE,
        5,
      ),
      true,
    );

    assert.equal(
      engine.isPointInTemplateVolume(
        { x: 150, y: 150, z: 16 },
        origin,
        cube,
        CELL_SIZE,
        5,
      ),
      false,
    );

    assert.equal(
      engine.isPointInTemplateVolume(
        { x: 300, y: 50, z: 2 },
        { x: 0, y: 50, z: 0 },
        line,
        CELL_SIZE,
        5,
      ),
      true,
    );

    assert.equal(
      engine.isPointInTemplateVolume(
        { x: 300, y: 50, z: 5 },
        { x: 0, y: 50, z: 0 },
        line,
        CELL_SIZE,
        5,
      ),
      false,
    );
  });

  it('конус объёмный: вверх раскрывается так же, как вбок', () => {
    const cone = {
      ...fireball,
      type: 'cone',
      originX: 0,
      originY: 0,
      targetX: 600,
      targetY: 0,
    };

    const origin = { x: 0, y: 0, z: 0 };

    // На 20 футах по оси ширина 20: полширины 10 вверх — в конусе, 12 — нет
    assert.equal(
      engine.isPointInTemplateVolume(
        { x: 400, y: 0, z: 9 },
        origin,
        cone,
        CELL_SIZE,
        5,
      ),
      true,
    );

    assert.equal(
      engine.isPointInTemplateVolume(
        { x: 400, y: 0, z: 12 },
        origin,
        cone,
        CELL_SIZE,
        5,
      ),
      false,
    );
  });

  it('хук isPointInTemplate3d на высоте начала совпадает с плоским', () => {
    const system = new engine.Dnd5eVttSystem();
    const origin = { x: 250, y: 200, z: 0 };

    for (const point of [
      { x: 250, y: 260, z: 0 },
      { x: 700, y: 200, z: 0 },
    ]) {
      assert.equal(
        system.isPointInTemplate3d(point, CELL_SIZE, fireball, origin),
        system.isPointInTemplate(point.x, point.y, CELL_SIZE, fireball),
      );
    }
  });
});
