import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createEntityServer,
  loadEntityWrites,
} from './helpers/combatWrite.mjs';
import {
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Боевой снимок, в котором ничего не меняется, не шлётся.
 *
 * Цель спаслась и урона нет («-0 HP»), удар пришёлся по цели, которой нечего
 * терять, — помощник записи всё равно слал снимок, сервер его отвергал, а ядро
 * писало в журнал «снимок отвергнут системой: неверная форма либо ничего не
 * изменилось» (живая проверка 03.10, З8). Вызывающему копия по-прежнему
 * возвращается: сводку в чат он пишет как раньше.
 */

/** Хиты цели */
const TARGET_HP = 20;

/** Эффект, который ложится на цель */
const SLOWED = createEffect('slowed', { name: 'Замедленный' });

/**
 * Мир клиента и сервер с одной целью.
 *
 * @param {number} hitPoints - хиты цели
 * @returns {Promise<object>} помощники записи, цель и сервер
 */
async function setup(hitPoints = TARGET_HP) {
  const target = withHp(createCreature, hitPoints, {}, TARGET_HP);
  const world = new Map([[target.id, structuredClone(target)]]);

  const writes = await loadEntityWrites({
    world,
    recordCombatBaseline: engine.recordCombatBaseline,
    changesCombatState: engine.changesCombatState,
  });

  const server = createEntityServer(engine, structuredClone(target));

  return { target, server, ...writes };
}

describe('пустой боевой снимок', () => {
  it('цели нечего менять — снимок не шлётся, копия возвращается', async () => {
    const { target, changeEntityCombatState, emitted } = await setup();

    const copy = changeEntityCombatState(target.id, (current) => ({
      ...current,
    }));

    assert.equal(emitted.length, 0);
    assert.equal(copy.id, target.id, 'вызывающий получает копию для сводки');
  });

  it('заранее посчитанная копия без изменений не шлётся', async () => {
    const { target, sendComputedCombatState, emitted } = await setup();

    assert.equal(
      sendComputedCombatState(target, structuredClone(target)),
      true,
    );

    assert.equal(emitted.length, 0);
  });

  it('урон, эффект и расход журнала шлются как раньше', async () => {
    const { target, changeEntityCombatState, emitted } = await setup();

    changeEntityCombatState(target.id, (current) =>
      withHp(() => structuredClone(current), TARGET_HP - 5, {}, TARGET_HP),
    );

    changeEntityCombatState(target.id, (current) => ({
      ...current,
      activeEffects: [...(current.activeEffects ?? []), SLOWED],
    }));

    changeEntityCombatState(target.id, (current) =>
      engine.withTriggerUsage(current, {
        'effect|trigger': { used: 1, per: 'turn' },
      }),
    );

    assert.equal(emitted.length, 3);
  });

  it('удар по лежащему на нуле хитов шлётся: он двигает спасброски от смерти', async () => {
    const { target, changeEntityCombatState, emitted } = await setup(0);

    changeEntityCombatState(target.id, (current) => {
      const copy = structuredClone(current);

      engine.recordDamageHit(copy, { amount: 0, dealt: 7 });

      return copy;
    });

    assert.equal(emitted.length, 1);
  });

  it('клиент не шлёт ровно то, что сервер отверг бы', async () => {
    const { target, server } = await setup();

    const unchanged = structuredClone(target);

    engine.recordCombatBaseline(unchanged, target);

    assert.equal(engine.changesCombatState(target, unchanged), false);

    assert.equal(
      new engine.Dnd5eVttSystem().settleCombatState(
        server.entity,
        engine.pickCombatState(unchanged),
      ).accepted,
      false,
    );

    const hurt = withHp(
      () => structuredClone(target),
      TARGET_HP - 5,
      {},
      TARGET_HP,
    );

    engine.recordCombatBaseline(hurt, target);

    assert.equal(engine.changesCombatState(target, hurt), true);

    assert.equal(
      new engine.Dnd5eVttSystem().settleCombatState(
        server.entity,
        engine.pickCombatState(hurt),
      ).accepted,
      true,
    );
  });
});
