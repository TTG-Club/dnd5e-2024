import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createCreature, engine } from './scenarios/_fixtures.mjs';

/**
 * Перезарядка и «раз в N ходов» у действий существа (`actionLimit.ts`,
 * `actionLimitTurn.ts`): трата, отсчёт ходов, запрос броска в начале хода и
 * возврат отдыхом.
 */

/** Кто ответил на запрос */
const GM_ID = 'user_gm';

/**
 * Дракон с «Дыханием (перезарядка 5–6)» и «Вихрем (раз в 3 хода)».
 *
 * @returns {object} существо после нормализации (у записей есть `id`)
 */
function dragon() {
  const creature = createCreature({ id: 'creature_dragon', name: 'Дракон' });

  creature.system.actions = [
    { name: 'Дыхание', description: [], recharge: 'D5' },
    { name: 'Вихрь', description: [], cooldownTurns: 3 },
    { name: 'Укус', description: [] },
  ];

  engine.normalizeCreature(creature);

  return creature;
}

/**
 * Ключ и ограничение записи по названию.
 *
 * @param {object} creature - существо
 * @param {string} name - название записи
 * @returns {{ key: string, limit: object }} ключ и ограничение
 */
function target(creature, name) {
  const action = creature.system.actions.find((entry) => entry.name === name);

  return {
    key: engine.buildActionLimitKey(action.id),
    limit: engine.resolveActionLimit(action),
  };
}

/**
 * Существо после траты записи в бою.
 *
 * @param {object} creature - существо
 * @param {string} name - название записи
 * @returns {object} то же существо (журнал записан)
 */
function spend(creature, name) {
  const { key, limit } = target(creature, name);

  const ledger = engine.spendActionLimit(
    engine.readTriggerUsage(creature),
    key,
    limit,
    true,
  );

  engine.writeTriggerUsage(creature, ledger);

  return creature;
}

/**
 * Состояние записи в бою.
 *
 * @param {object} creature - существо
 * @param {string} name - название записи
 * @returns {object} состояние ограничения
 */
function stateOf(creature, name) {
  const { key, limit } = target(creature, name);

  return engine.readActionLimitState(
    engine.readTriggerUsage(creature),
    key,
    limit,
    true,
  );
}

/** Двойник запроса броска: запоминает запросы, отвечает по команде */
function createRequestRoll() {
  const requests = [];
  const resolvers = [];

  return {
    requests,
    requestRoll: (options) => {
      requests.push(options);

      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    },
    answer: (outcome) => {
      const resolve = resolvers.shift();

      assert.ok(resolve, 'Нет висящего запроса');
      resolve(outcome);
    },
  };
}

describe('нормализация ограничений', () => {
  it('приводит перезарядку к ключу и убирает негодное «раз в N ходов»', () => {
    const creature = createCreature();

    creature.system.actions = [
      { name: 'А', description: [], recharge: 'D5', cooldownTurns: 3 },
      { name: 'Б', description: [], cooldownTurns: 1 },
      { name: 'В', description: [], cooldownTurns: 2.5 },
      { name: 'Г', description: [], recharge: 'x' },
    ];

    engine.normalizeCreature(creature);

    const [both, one, fraction, broken] = creature.system.actions;

    assert.equal(both.recharge, 'd5');
    assert.equal(both.cooldownTurns, undefined);
    assert.equal(one.cooldownTurns, undefined);
    assert.equal(fraction.cooldownTurns, undefined);
    assert.equal(broken.recharge, undefined);
  });
});

describe('перезарядка 5–6', () => {
  it('трата закрывает действие до успешного броска', async () => {
    const system = new engine.Dnd5eVttSystem();
    const creature = spend(dragon(), 'Дыхание');

    assert.deepEqual(stateOf(creature, 'Дыхание'), {
      status: 'spent',
      recharge: 'd5',
    });

    const double = createRequestRoll();

    const result = system.runTurnEffects(creature, 'startOfTurn', {
      requestRoll: double.requestRoll,
    });

    assert.equal(result.deferred.length, 1);
    assert.equal(double.requests[0].payload.kind, 'actionRecharge');
    assert.equal(double.requests[0].payload.recharge, 'd5');

    // Провал: 4 — всё ещё потрачено
    double.answer({
      status: 'answered',
      result: { kind: 'actionRecharge', total: 4 },
      respondedByUserId: GM_ID,
    });

    const failed = (await result.deferred[0].resolution)(creature);

    assert.equal(failed.changed, false);
    assert.equal(stateOf(creature, 'Дыхание').status, 'spent');

    // Следующий ход: 5 — снова доступно
    const next = system.runTurnEffects(creature, 'startOfTurn', {
      requestRoll: double.requestRoll,
    });

    double.answer({
      status: 'answered',
      result: { kind: 'actionRecharge', total: 5 },
      respondedByUserId: GM_ID,
    });

    const passed = (await next.deferred[0].resolution)(creature);

    assert.equal(passed.changed, true);
    // Бросил человек — общей строки в чат нет: он сам выбрал, кому показать
    assert.equal(passed.chatSummary, null);
    assert.equal(stateOf(creature, 'Дыхание').status, 'ready');
  });

  it('не спрашивает второй раз, пока ждёт ответа', () => {
    const system = new engine.Dnd5eVttSystem();
    const creature = spend(dragon(), 'Дыхание');
    const double = createRequestRoll();
    const context = { requestRoll: double.requestRoll };

    system.runTurnEffects(creature, 'startOfTurn', context);
    system.runTurnEffects(creature, 'startOfTurn', context);

    assert.equal(double.requests.length, 1);
  });

  it('отказ оставляет потраченным, «некому бросить» — бросает сервер', async () => {
    const system = new engine.Dnd5eVttSystem();
    const creature = spend(dragon(), 'Дыхание');
    const double = createRequestRoll();

    const declined = system.runTurnEffects(creature, 'startOfTurn', {
      requestRoll: double.requestRoll,
    });

    double.answer({ status: 'declined' });
    assert.equal(await declined.deferred[0].resolution, null);

    const noRecipient = system.runTurnEffects(creature, 'startOfTurn', {
      requestRoll: double.requestRoll,
    });

    double.answer({ status: 'noRecipient' });

    const applied = (await noRecipient.deferred[0].resolution)(creature);

    assert.match(applied.chatSummary, /перезарядка «Дыхание»/);
  });

  it('нейтральный бросок ядра тоже читается', () => {
    assert.equal(
      engine.readActionRechargeAnswer({
        neutral: true,
        formula: '1d6',
        total: 6,
        rollData: { dice: [] },
      }),
      6,
    );

    assert.equal(engine.readActionRechargeAnswer({ total: 9 }), null);
  });
});

describe('раз в 3 хода', () => {
  it('применённое в ход 1 снова доступно в ход 4', () => {
    const system = new engine.Dnd5eVttSystem();
    const creature = spend(dragon(), 'Вихрь');

    assert.deepEqual(stateOf(creature, 'Вихрь'), {
      status: 'cooldown',
      turnsLeft: 3,
    });

    const left = [2, 1];

    for (const turnsLeft of left) {
      const result = system.runTurnEffects(creature, 'startOfTurn', {});

      assert.equal(result.changed, true);

      assert.deepEqual(stateOf(creature, 'Вихрь'), {
        status: 'cooldown',
        turnsLeft,
      });
    }

    system.runTurnEffects(creature, 'startOfTurn', {});

    assert.equal(stateOf(creature, 'Вихрь').status, 'ready');
  });

  it('вне боя не ограничивает и не тратится', () => {
    const creature = dragon();
    const { key, limit } = target(creature, 'Вихрь');

    assert.equal(engine.spendActionLimit({}, key, limit, false), null);

    const ledger = { [key]: { used: 2, per: 'cooldown' } };

    assert.equal(
      engine.readActionLimitState(ledger, key, limit, false).status,
      'ready',
    );

    assert.deepEqual(engine.spendActionLimit(ledger, key, limit, false), {});
  });
});

describe('отдых и журнал', () => {
  it('короткий отдых возвращает и перезарядку, и «раз в N ходов»', () => {
    const creature = spend(spend(dragon(), 'Дыхание'), 'Вихрь');

    const kept = engine.pruneTriggerUsage(
      creature,
      engine.restLimitPeriodsOf('short'),
    );

    assert.equal(kept, undefined);
  });

  it('журнал боевого канала принимает новые периоды', () => {
    const ledger = engine.parseTriggerUsage({
      a: { used: 1, per: 'recharge' },
      b: { used: 3, per: 'cooldown' },
      c: { used: 1, per: 'weekly' },
    });

    assert.deepEqual(Object.keys(ledger), ['a', 'b']);
  });

  it('группа заклинаний с перезарядкой ждёт броска тем же путём', () => {
    const creature = dragon();

    creature.system.spellcastingBlocks = [
      {
        id: 'block',
        name: 'Магия',
        groups: [{ id: 'group', mode: 'recharge', recharge: 'd6', spells: [] }],
      },
    ];

    const key = engine.buildSpellGroupLimitKey('group');

    engine.writeTriggerUsage(creature, { [key]: { used: 1, per: 'recharge' } });

    assert.deepEqual(
      engine.listSpentRecharges(creature, engine.readTriggerUsage(creature)),
      [{ key, name: 'Магия', recharge: 'd6' }],
    );
  });
});
