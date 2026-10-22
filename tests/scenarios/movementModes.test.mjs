import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  change,
  createActor,
  createEffect,
  createZone,
  engine,
} from './_fixtures.mjs';

/**
 * Виды перемещения для ядра (`getMovementModes`, VTTG 0.9.751+): ходьба с
 * «Рывком» и прыжок по правилам D&D 2024 — в длину на значение Силы с
 * разбегом 10 фт, с места вдвое меньше; в высоту 3 + мод. Силы; фут прыжка
 * стоит фут хода.
 */

/**
 * Персонаж с заданной Силой и Скоростью.
 *
 * @param {number} strength - значение Силы
 * @param {number} walk - Скорость ходьбы
 * @param {object[]} activeEffects - эффекты
 * @returns {object} персонаж
 */
function hero(strength, walk = 30, activeEffects = []) {
  const actor = createActor({ activeEffects });

  actor.system = {
    ...actor.system,
    abilities: { ...actor.system.abilities, strength },
    movement: { ...actor.system.movement, walk },
  };

  return actor;
}

/**
 * Вид перемещения по id.
 *
 * @param {object} modes - виды перемещения
 * @param {string} id - id вида
 * @returns {object} вид
 */
function modeOf(modes, id) {
  const mode = modes.modes.find((entry) => entry.id === id);

  assert.ok(mode, `вид «${id}» есть`);

  return mode;
}

describe('виды перемещения D&D 2024', () => {
  const system = new engine.Dnd5eVttSystem();

  it('ходьба — вид по умолчанию: Скорость шагом, вдвое — «Рывком»', () => {
    const modes = system.getMovementModes(hero(10));

    assert.equal(modes.defaultModeId, engine.WALK_MOVEMENT_MODE_ID);

    const walk = modeOf(modes, engine.WALK_MOVEMENT_MODE_ID);

    assert.equal(walk.measure, 'path');

    assert.deepEqual(
      walk.bands.map((band) => [band.upTo, band.label]),
      [
        [30, ''],
        [60, 'Рывок'],
      ],
    );

    // Старое приложение получает те же числа
    assert.deepEqual(system.getMovementRange(hero(10)), {
      base: 30,
      extended: 60,
    });
  });

  it('прыжок с Силой 15: с места 7 фт, с разбегом 15 фт, по прямой', () => {
    const jump = modeOf(
      system.getMovementModes(hero(15)),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    assert.equal(jump.measure, 'straight');

    assert.deepEqual(
      jump.bands.map((band) => [band.label, band.upTo]),
      [
        ['Прыжок с места', 7],
        ['Прыжок с разбегом', 15],
      ],
    );

    assert.equal(jump.beyondLabel, 'Не допрыгнуть');
    // Высота: 3 + мод. Силы (+2) = 5 фт, с места — 2 фт
    assert.equal(jump.hint, 'В высоту: 2 фт с места, 5 фт с разбегом');

    // Не допрыгнуть с места — ядро ведёт ходьбой; разбег — 10 фт подхода,
    // весь путь с прыжком — не больше Скорости
    assert.deepEqual(
      jump.bands.map((band) => band.minApproach ?? 0),
      [0, 10],
    );

    assert.deepEqual(
      { ...jump.approach },
      { modeId: engine.WALK_MOVEMENT_MODE_ID },
    );

    assert.equal(jump.totalLimit, 30);
  });

  it('прыжок не длиннее хода: разбег съедает 10 фт Скорости', () => {
    const jump = modeOf(
      system.getMovementModes(hero(20, 25)),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    // Сила 20: с места 10 фт, с разбегом — 25 − 10 = 15 фт, а не 20
    assert.deepEqual(
      jump.bands.map((band) => band.upTo),
      [10, 15],
    );
  });

  it('скорость 10: на разбег хода нет — только прыжок с места', () => {
    const jump = modeOf(
      system.getMovementModes(hero(16, 10)),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    assert.deepEqual(
      jump.bands.map((band) => band.id),
      ['standing'],
    );
  });

  it('скорость 0: ни ходьбы, ни прыжка', () => {
    const modes = system.getMovementModes(hero(18, 0));

    assert.deepEqual(modeOf(modes, engine.WALK_MOVEMENT_MODE_ID).bands, []);
    assert.deepEqual(modeOf(modes, engine.JUMP_MOVEMENT_MODE_ID).bands, []);
  });

  it('эффекты: «умножить на 2» удваивает прыжок, «повысить до» задаёт минимум', () => {
    const doubled = createEffect('step-of-the-wind', {
      changes: [
        change(engine.JUMP_LONG_KEY, '2', { mode: 'multiply' }),
        change(engine.JUMP_HIGH_KEY, '2', { mode: 'multiply' }),
      ],
    });

    const stepOfTheWind = modeOf(
      system.getMovementModes(hero(10, 40, [doubled])),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    // Сила 10: 20 фт с разбегом (ход 40 − 10 = 30 его не режет), 10 с места
    assert.deepEqual(
      stepOfTheWind.bands.map((band) => band.upTo),
      [10, 20],
    );

    const jumpSpell = createEffect('jump-spell', {
      changes: [change(engine.JUMP_LONG_KEY, '30', { mode: 'upgrade' })],
    });

    const springy = modeOf(
      system.getMovementModes(hero(10, 60, [jumpSpell])),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    assert.deepEqual(
      springy.bands.map((band) => band.upTo),
      [15, 30],
    );
  });

  it('препятствие не выше четверти длины прыжка перепрыгивается', () => {
    const jump = modeOf(
      system.getMovementModes(hero(15)),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    assert.deepEqual({ ...jump.clearance }, { ratio: 0.25 });
    // Выше допуска — «врезаетесь»: оговорки нет, ядро режет
    assert.equal(jump.overClearanceLabel, undefined);
  });

  it('заклинание «Прыжок»: до 30 фт за 10 фт хода, без разбега', () => {
    const jumpSpell = createEffect('jump-spell', {
      changes: [
        change(engine.JUMP_LONG_KEY, '30', { mode: 'upgrade' }),
        change(engine.JUMP_COST_KEY, '10', { mode: 'override' }),
      ],
    });

    const jump = modeOf(
      system.getMovementModes(hero(10, 30, [jumpSpell])),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    assert.deepEqual(
      jump.bands.map((band) => [band.upTo, band.cost, band.minApproach ?? 0]),
      [[30, 10, 0]],
    );

    // Без своей цены — фут за фут, поля нет
    const plain = modeOf(
      system.getMovementModes(hero(10)),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    assert.ok(plain.bands.every((band) => band.cost === undefined));

    // Цены не хватает хода — прыжка нет
    const tired = modeOf(
      system.getMovementModes(hero(10, 5, [jumpSpell])),
      engine.JUMP_MOVEMENT_MODE_ID,
    );

    assert.deepEqual(tired.bands, []);
  });

  it('зона-провал: пешком не пройти — бесконечная цена', () => {
    const pit = createEffect('Яма', { flags: ['terrain.impassable'] });

    assert.equal(
      engine.resolveAreaTerrainCost(createZone('ca_pit', [pit])),
      Number.POSITIVE_INFINITY,
    );

    // Болото поверх ямы — всё равно провал
    const swampPit = createEffect('Болотная яма', {
      flags: ['terrain.impassable'],
      changes: [change('terrain.movementCost', '2', { mode: 'override' })],
    });

    assert.equal(
      engine.resolveAreaTerrainCost(createZone('ca_swamp_pit', [swampPit])),
      Number.POSITIVE_INFINITY,
    );
  });
});
