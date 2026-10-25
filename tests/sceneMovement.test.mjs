import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  CELL_SIZE,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  MAX_ROLL,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/** Ход не потрачен, никто не парит, не левитирует и не лежит */
const BASE_STATE = {
  movementSpent: false,
  hover: false,
  levitating: false,
  prone: false,
};

/**
 * Скорости по видам.
 *
 * @param {object} overrides - что задано
 * @returns {object} скорости
 */
function speeds(overrides = {}) {
  return { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0, ...overrides };
}

/**
 * Виды перемещения по состоянию.
 *
 * @param {object} state - что отличается от {@link BASE_STATE}
 * @returns {Map<string, object>} виды по id
 */
function modesOf(state) {
  const modes = engine.buildMovementModes(
    30,
    { standingLong: 7, runningLong: 15, standingHigh: 2, runningHigh: 5 },
    { ...BASE_STATE, movement: speeds(), ...state },
  );

  return new Map(modes.modes.map((mode) => [mode.id, mode]));
}

describe('полёт и левитация — виды перемещения', () => {
  it('полёт — своей Скоростью, включается состоянием и держит в воздухе', () => {
    const fly = modesOf({ movement: speeds({ fly: 60 }) }).get('fly');

    assert.equal(fly.bands[0].upTo, 60, 'Скорость полёта, не ходьбы');
    assert.equal(fly.bands[1].upTo, 120, 'с «Рывком»');
    assert.equal(fly.persistent, true);
    assert.equal(fly.aloft, true, 'летун не падает');
    assert.equal(fly.vertical.allowed, true, 'меняет высоту вверх и вниз');
    assert.deepEqual(fly.clearance, {}, 'над низкой стеной пролетает');
  });

  it('без Скорости полёта вида нет', () => {
    assert.equal(modesOf({}).has('fly'), false);
  });

  it('сбитый с ног летун не держится в воздухе, парящий — держится', () => {
    const prone = modesOf({ movement: speeds({ fly: 60 }), prone: true });

    const hovering = modesOf({
      movement: speeds({ fly: 60 }),
      prone: true,
      hover: true,
    });

    assert.equal(prone.get('fly').aloft, false);
    assert.equal(hovering.get('fly').aloft, true);
  });

  it('скорость 0 («Схваченный») — летун не держится', () => {
    // `speed.zero` обнуляет все Скорости до видов перемещения
    const grappled = modesOf({
      movement: speeds({ walk: 0, fly: 0 }),
      hover: false,
    });

    assert.equal(grappled.has('fly'), false);
  });

  it('левитация — только вверх и вниз, до 20 футов', () => {
    const levitate = modesOf({ levitating: true }).get('levitate');

    assert.equal(levitate.bands[0].upTo, 0, 'по плану не двигает');
    assert.equal(levitate.persistent, true);
    assert.equal(levitate.aloft, true);
    assert.equal(levitate.vertical.maxRise, 20);
    assert.equal(levitate.vertical.maxDrop, 20);
  });

  it('плавание и лазание без своей Скорости — фут за два', () => {
    const modes = modesOf({ movement: speeds({ climb: 30 }) });

    assert.equal(modes.get('swim').bands[0].upTo, 15);
    assert.equal(modes.get('climb').bands[0].upTo, 30);
    assert.equal(modes.get('swim').vertical.allowed, true);
    assert.equal(modes.get('climb').aloft, true, 'лазающий держится за стену');
  });

  it('копание и плавание опускают ниже пола, полёт и лазание — нет', () => {
    const modes = modesOf({ movement: speeds({ burrow: 10, fly: 30 }) });

    assert.equal(modes.get('burrow').vertical.belowFloor, true);
    assert.equal(modes.get('swim').vertical.belowFloor, true);
    assert.equal(modes.get('fly').vertical.belowFloor, undefined);
    assert.equal(modes.get('climb').vertical.belowFloor, undefined);
  });

  it('копание — только со Скоростью копания', () => {
    assert.equal(modesOf({}).has('burrow'), false);

    assert.equal(
      modesOf({ movement: speeds({ burrow: 10 }) }).get('burrow').bands[0].upTo,
      10,
    );
  });

  it('прыжок в высоту поднимает фишку', () => {
    assert.equal(modesOf({}).get('jump').vertical.maxRise, 5);
  });

  it('ход потрачен — у видов пустые участки', () => {
    const modes = modesOf({
      movement: speeds({ fly: 60 }),
      movementSpent: true,
    });

    assert.deepEqual(modes.get('fly').bands, []);
  });

  it('эффект «Полёт» даёт вид полёта через Скорость полёта', () => {
    const system = new engine.Dnd5eVttSystem();

    const flying = createCreature({
      activeEffects: [
        createEffect('Полёт', {
          changes: [{ key: 'movement.fly', mode: 'override', value: '60' }],
        }),
      ],
    });

    const { modes } = system.getMovementModes(flying);
    const fly = modes.find((mode) => mode.id === 'fly');

    assert.equal(fly?.bands[0].upTo, 60);
  });

  it('флаг «Левитация» даёт вид левитации', () => {
    const system = new engine.Dnd5eVttSystem();

    const levitating = createCreature({
      activeEffects: [
        createEffect('Левитация', { flags: ['movement.levitate'] }),
      ],
    });

    assert.ok(
      system
        .getMovementModes(levitating)
        .modes.some((mode) => mode.id === 'levitate'),
    );
  });
});

describe('падение', () => {
  it('1к6 за каждые 10 футов, не больше 20к6', () => {
    assert.equal(engine.resolveFallDiceCount(5), 0);
    assert.equal(engine.resolveFallDiceCount(30), 3);
    assert.equal(engine.resolveFallDiceCount(35), 3);
    assert.equal(engine.resolveFallDiceCount(500), 20);
    assert.equal(engine.resolveFallDamageFormula(30), '3к6');
  });

  it('падение на 30 футов: 3к6 дробящего и ничком', () => {
    const system = new engine.Dnd5eVttSystem();
    const victim = withHp(createCreature, 40);

    const result = withRandom([MAX_ROLL], () =>
      system.applyMovementEffects(victim, {
        from: createToken('victim', 0, 0, { aboveFloor: 30 }),
        to: createToken('victim', 0, 0),
        distance: 0,
        steps: [],
        forced: false,
        stopped: false,
        verticalDistance: 30,
        fell: true,
      }),
    );

    assert.equal(
      engine.resolveEntityCurrentHp(victim),
      40 - 18,
      '3к6 по максимуму',
    );

    assert.equal(engine.hasEntityCondition(victim, 'prone'), true, 'ничком');
    assert.equal(result.changed, true);
    assert.match(result.chatSummary, /падает на 30 фт: 3к6 = 18/);
  });

  it('сопротивление дробящему режет урон падения', () => {
    const tough = withHp(createCreature, 40, {
      activeEffects: [
        createEffect('Каменная кожа', { flags: ['resistance.bludgeoning'] }),
      ],
    });

    const outcome = engine.applyFallToEntity(tough, 30, () => ({ total: 10 }));

    assert.equal(outcome.damage, 5);
  });

  it('«Падение пёрышком» — без урона и на ноги', () => {
    const feather = withHp(createCreature, 40, {
      activeEffects: [
        createEffect('Падение пёрышком', { flags: ['fall.featherFall'] }),
      ],
    });

    const outcome = engine.applyFallToEntity(feather, 60, () => ({
      total: 20,
    }));

    assert.equal(outcome.damage, 0);
    assert.equal(outcome.prone, false);
    assert.equal(engine.resolveEntityCurrentHp(feather), 40);
  });

  it('спуск без падения урона не даёт, подъём — футы пути', () => {
    const system = new engine.Dnd5eVttSystem();
    const flyer = withHp(createCreature, 40);

    const result = system.applyMovementEffects(flyer, {
      from: createToken('flyer', 0, 0),
      to: createToken('flyer', 0, 0, { aboveFloor: 30 }),
      distance: 0,
      steps: [],
      forced: false,
      stopped: false,
      verticalDistance: 30,
    });

    assert.equal(engine.resolveEntityCurrentHp(flyer), 40);
    assert.equal(engine.hasEntityCondition(flyer, 'prone'), false);
    assert.equal(result.chatSummary, null);
  });

  it('«за каждые 10 футов» считает и подъём своим ходом', () => {
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

    const climber = withHp(createCreature, 40, { activeEffects: [thorns] });

    system.applyMovementEffects(climber, {
      from: createToken('climber', 0, 0),
      to: createToken('climber', 1, 0, { aboveFloor: 20 }),
      distance: 10,
      steps: [],
      forced: false,
      stopped: false,
      verticalDistance: 20,
    });

    assert.equal(
      engine.resolveEntityCurrentHp(climber),
      37,
      '10 по плану + 20 вверх',
    );
  });

  it('хук resolveUnsupported: без опоры — падает', () => {
    const system = new engine.Dnd5eVttSystem();

    const context = {
      token: createToken('victim', 0, 0),
      reason: 'no-floor',
      landingFloorId: 'base',
      fallHeight: 20,
    };

    assert.equal(system.resolveUnsupported(createCreature(), context), 'fall');
  });
});

describe('толчок по вертикали', () => {
  const push = { type: 'move', kind: 'push', distance: 10 };

  it('летуна над головой толкает вверх и от себя', () => {
    const origin = createToken('ogre', 0, 0);
    const target = createToken('flyer', 1, 0, { aboveFloor: 5 });

    const position = engine.resolveForcedMovePosition(push, {
      target,
      origin,
      gridSettings: GRID,
      vertical: {
        target: { bottom: 5, top: 10 },
        origin: { bottom: 0, top: 5 },
      },
    });

    assert.ok(position.aboveFloor > 5, 'выше');
    assert.ok(position.x >= target.x, 'дальше от толкающего');
  });

  it('строго над толкающим — только вверх', () => {
    const position = engine.resolveForcedMovePosition(push, {
      target: createToken('flyer', 0, 0, { aboveFloor: 5 }),
      origin: createToken('ogre', 0, 0),
      gridSettings: GRID,
      vertical: {
        target: { bottom: 5, top: 10 },
        origin: { bottom: 0, top: 5 },
      },
    });

    assert.deepEqual(position, { x: 0, y: 0, aboveFloor: 15 });
  });

  it('на одной высоте — как раньше, без высоты', () => {
    const position = engine.resolveForcedMovePosition(push, {
      target: createToken('goblin', 1, 0),
      origin: createToken('ogre', 0, 0),
      gridSettings: GRID,
      vertical: {
        target: { bottom: 0, top: 5 },
        origin: { bottom: 0, top: 10 },
      },
    });

    assert.deepEqual(position, { x: 3 * CELL_SIZE, y: 0 });
  });

  it('притягивание вниз не загоняет под пол', () => {
    const pull = { type: 'move', kind: 'pull', distance: 30 };

    const position = engine.resolveForcedMovePosition(pull, {
      target: createToken('flyer', 0, 0, { aboveFloor: 10 }),
      origin: createToken('ogre', 0, 0),
      gridSettings: GRID,
      vertical: {
        target: { bottom: 10, top: 15 },
        origin: { bottom: 0, top: 5 },
      },
    });

    assert.equal(position.aboveFloor, 0);
  });
});

describe('вид фишки по эффектам (сервер)', () => {
  /**
   * Контекст правил со сменой вида у ядра.
   *
   * @param {object} entity - сущность
   * @param {string | undefined} activeModeId - включённый вид фишки
   * @param {boolean} withSetter - ядро умеет менять вид
   * @returns {{ context: object, calls: Array }} контекст и вызовы
   */
  function contextOf(entity, activeModeId, withSetter = true) {
    const calls = [];

    const token = createToken(entity.id, 0, 0, {
      activeMovementModeId: activeModeId,
    });

    return {
      calls,
      context: {
        getSceneSurroundings: () => ({
          token,
          gridSettings: GRID,
          neighbors: [],
        }),
        ...(withSetter
          ? {
              setTokenMovementMode: (tokenId, modeId) =>
                calls.push([tokenId, modeId]),
            }
          : {}),
      },
    };
  }

  it('«Левитация» поднимает цель сама', () => {
    const target = createCreature({
      activeEffects: [
        createEffect('Левитация', { flags: ['movement.levitate'] }),
      ],
    });

    const { context, calls } = contextOf(target, undefined);

    engine.reconcileMovementMode(target, context);
    assert.deepEqual(calls, [[`token_${target.id}`, 'levitate']]);
  });

  it('кончился «Полёт» — вид выключен, летуна уронит ядро', () => {
    const walker = createCreature();
    const { context, calls } = contextOf(walker, 'fly');

    engine.reconcileMovementMode(walker, context);
    assert.deepEqual(calls, [[`token_${walker.id}`, null]]);
  });

  it('«Полёт» действует — взлёт выбирает летун, вид не трогается', () => {
    const flyer = createCreature({
      activeEffects: [
        createEffect('Полёт', {
          changes: [{ key: 'movement.fly', mode: 'override', value: '60' }],
        }),
      ],
    });

    for (const activeModeId of [undefined, 'fly']) {
      const { context, calls } = contextOf(flyer, activeModeId);

      engine.reconcileMovementMode(flyer, context);
      assert.deepEqual(calls, []);
    }
  });

  it('старое ядро без смены вида — сверка молчит', () => {
    const walker = createCreature();
    const { context, calls } = contextOf(walker, 'fly', false);

    engine.reconcileMovementMode(walker, context);
    assert.deepEqual(calls, []);
  });
});
