import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  createTrait,
  createZone,
  engine,
  MAX_ROLL,
  MIN_ROLL,
  PLAYER_ID,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Явные срабатывания: лимит «не чаще N раз» и его сбросы, состояние на ходу,
 * черты существа, ауры, вход в зону и ответы игрока.
 */

/** Спасбросок Телосложения Сл 12 */
const CON_SAVE = { ability: 'constitution', dc: 12 };

/**
 * Существо с заданными хитами.
 *
 * @param {number} hitPoints - текущие и максимальные хиты
 * @param {object} overrides - поля существа
 * @returns {object} существо
 */
function woundedCreature(hitPoints, overrides = {}) {
  const creature = createCreature(overrides);

  creature.system.hitPoints = {
    ...creature.system.hitPoints,
    current: hitPoints,
    max: 40,
    average: 40,
  };

  return creature;
}

/**
 * Срабатывание урона в начале хода.
 *
 * @param {object} overrides - поля срабатывания
 * @returns {object} срабатывание
 */
function burnTrigger(overrides = {}) {
  return {
    id: 'trigger_burn',
    event: 'turnStart',
    actions: [{ type: 'damage', parts: [{ formula: '5', type: 'fire' }] }],
    ...overrides,
  };
}

/**
 * Ответ игрока на запрос спасброска.
 *
 * @param {boolean} passed - прошёл ли
 * @returns {object} исход запроса
 */
function answer(passed) {
  const total = passed ? 20 : 2;

  return {
    status: 'answered',
    result: { roll: total, modifier: 0, total, passed },
    respondedByUserId: PLAYER_ID,
  };
}

describe('лимит «не чаще N раз»', () => {
  it('раз в ход: второй раз в том же ходу не бьёт, конец хода сбрасывает счётчик, начало — нет', () => {
    const orc = woundedCreature(40, {
      activeEffects: [
        createEffect('burning', {
          triggers: [burnTrigger({ limit: { max: 1, per: 'turn' } })],
        }),
      ],
    });

    const first = engine.processTurnEffects(orc, 'startOfTurn');

    assert.equal(first.damageTotal, 5);
    assert.equal(first.changed, true);

    assert.deepEqual(orc.system.effectUsage, {
      'burning|trigger_burn': { used: 1, per: 'turn' },
    });

    assert.equal(engine.processTurnEffects(orc, 'startOfTurn').damageTotal, 0);

    assert.equal(engine.expireTurnEffects(orc, 'someone', 'start'), false);
    assert.equal(engine.processTurnEffects(orc, 'startOfTurn').damageTotal, 0);

    assert.equal(engine.expireTurnEffects(orc, 'someone', 'end'), true);
    assert.equal(orc.system.effectUsage, undefined);
    assert.equal(engine.processTurnEffects(orc, 'startOfTurn').damageTotal, 5);
  });

  it('раз в раунд сбрасывается новым раундом, раз в отдых — отдыхом своего вида', () => {
    const hero = createActor();

    hero.system.effectUsage = {
      'a|round': { used: 1, per: 'round' },
      'a|short': { used: 1, per: 'shortRest' },
      'a|long': { used: 2, per: 'longRest' },
    };

    assert.equal(engine.decrementActorEffectDurations(hero), true);

    assert.deepEqual(Object.keys(hero.system.effectUsage), [
      'a|short',
      'a|long',
    ]);

    const shortRest = engine.applyActorRest(hero, 'short');

    assert.deepEqual(Object.keys(shortRest.system.effectUsage), ['a|long']);

    const longRest = engine.applyActorRest(hero, 'long');

    assert.equal(longRest.system.effectUsage, undefined);

    const creature = createCreature();

    creature.system.effectUsage = { 'b|long': { used: 1, per: 'longRest' } };

    assert.equal(
      engine.applyCreatureRest(creature, 'long').system.effectUsage,
      undefined,
    );

    assert.equal(
      'effectUsage' in engine.applyActorRest(createActor(), 'long').system,
      false,
    );
  });
});

describe('наложение на ходу', () => {
  /** «Отравленный» при провале спасброска в начале хода */
  const poisonTrigger = {
    id: 'trigger_stench',
    event: 'turnStart',
    save: CON_SAVE,
    actions: [
      {
        type: 'applyCondition',
        conditionKey: 'poisoned',
        duration: { type: 'rounds', value: 1 },
      },
    ],
  };

  it('провал — состояние с длительностью, успех — ничего, иммунитет — ничего', () => {
    const failed = createCreature({
      activeEffects: [createEffect('stench', { triggers: [poisonTrigger] })],
    });

    const result = withRandom([MIN_ROLL], () =>
      engine.processTurnEffects(failed, 'startOfTurn'),
    );

    const poisoned = failed.activeEffects.find(
      (effect) => effect.conditionKey === 'poisoned',
    );

    assert.equal(result.changed, true);
    assert.equal(result.saveOutcomes[0].passed, false);
    assert.equal(result.saveOutcomes[0].damageOnSuccess, undefined);

    assert.deepEqual(poisoned.duration, {
      type: 'rounds',
      value: 1,
      remaining: 1,
    });

    const passed = createCreature({
      activeEffects: [createEffect('stench', { triggers: [poisonTrigger] })],
    });

    withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(passed, 'startOfTurn'),
    );

    assert.equal(passed.activeEffects.length, 1);

    const immune = createCreature({
      activeEffects: [createEffect('stench', { triggers: [poisonTrigger] })],
    });

    immune.system.defenses = {
      ...immune.system.defenses,
      conditionImmunities: ['poisoned'],
    };

    withRandom([MIN_ROLL], () =>
      engine.processTurnEffects(immune, 'startOfTurn'),
    );

    assert.equal(immune.activeEffects.length, 1);
  });

  it('аура чужого токена накладывает, но снять ауру с субъекта нельзя', () => {
    const aura = createEffect('stench-aura', {
      aura: { radius: 10, target: 'all', applyToSelf: false, visible: true },
      triggers: [
        {
          ...poisonTrigger,
          actions: [
            ...poisonTrigger.actions,
            { type: 'removeSelf', on: 'saved' },
          ],
        },
      ],
    });

    const hero = createActor({ autoSaves: true });

    withRandom([MIN_ROLL], () =>
      engine.processTurnEffects(hero, 'startOfTurn', {
        ambientEffects: [aura],
      }),
    );

    assert.deepEqual(
      hero.activeEffects.map((effect) => effect.conditionKey),
      ['poisoned'],
    );
  });

  it('черта существа лечит на его ходу; снять черту срабатывание не может', () => {
    const troll = woundedCreature(10);

    troll.system.traits = [
      createTrait('Регенерация', [
        createEffect('regeneration', {
          recurringDamage: {
            damageParts: [{ formula: '10@heal' }],
            timing: 'startOfTurn',
          },
          recurringSave: { ability: 'wisdom', dc: 1, timing: 'startOfTurn' },
        }),
      ]),
    ];

    const result = withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(troll, 'startOfTurn'),
    );

    assert.equal(engine.resolveEntityCurrentHp(troll), 20);
    assert.equal(result.healingOutcomes.length, 1);

    assert.equal(
      result.saveOutcomes.length,
      0,
      'снимающий спасбросок черты не бросается',
    );

    assert.equal(troll.system.traits[0].activeEffects.length, 1);
  });

  it('копия эффекта не уносит срабатывания, которые накладывают её саму', () => {
    const hold = createEffect('hold', {
      conditionKey: 'restrained',
      flags: ['speed.zero'],
      triggers: [
        {
          id: 'trigger_self',
          event: 'turnStart',
          actions: [{ type: 'applySelf' }],
        },
        {
          id: 'trigger_escape',
          event: 'turnEnd',
          save: CON_SAVE,
          actions: [{ type: 'removeSelf', on: 'saved' }],
        },
        {
          id: 'trigger_enter',
          event: 'enter',
          actions: [{ type: 'applySelf' }],
        },
      ],
    });

    const hero = createActor({ autoSaves: true });

    engine.processTurnEffects(hero, 'startOfTurn', {
      ambientEffects: [
        { ...hold, aura: { radius: 5, target: 'all', applyToSelf: false } },
      ],
    });

    assert.deepEqual(
      hero.activeEffects[0].triggers.map((trigger) => trigger.id),
      ['trigger_escape'],
    );
  });
});

describe('вход в зону', () => {
  it('явное срабатывание входа: урон и состояние, лимит делится с началом хода в зоне', () => {
    const shared = { max: 1, per: 'turn', key: 'moonbeam' };

    const moonbeam = createEffect('moonbeam', {
      triggers: [
        {
          id: 'trigger_enter',
          event: 'enter',
          actions: [
            { type: 'damage', parts: [{ formula: '6', type: 'radiant' }] },
          ],
          limit: shared,
        },
        {
          id: 'trigger_turn',
          event: 'turnStart',
          actions: [
            { type: 'damage', parts: [{ formula: '6', type: 'radiant' }] },
          ],
          limit: shared,
        },
      ],
    });

    const zone = createZone('ca_moonbeam', [moonbeam]);
    const orc = woundedCreature(40);

    const entered = engine.syncActorAreaEffects(
      orc,
      new Set(),
      new Set([zone.id]),
      [zone],
      { isInCombat: () => true },
    );

    assert.equal(entered.damageOutcomes[0].total, 6);
    assert.equal(engine.resolveEntityCurrentHp(orc), 34);

    assert.equal(engine.processTurnEffects(orc, 'startOfTurn').damageTotal, 0);

    engine.expireTurnEffects(orc, 'someone', 'end');
    assert.equal(engine.processTurnEffects(orc, 'startOfTurn').damageTotal, 6);
  });

  it('вне боя и без сведений о бое лимит хода не ограничивает, а лимит отдыха — да', () => {
    const turnLimited = createEffect('spikes', {
      triggers: [
        {
          id: 'trigger_spikes',
          event: 'enter',
          actions: [
            { type: 'damage', parts: [{ formula: '2', type: 'piercing' }] },
          ],
          limit: { max: 1, per: 'turn' },
        },
      ],
    });

    const restLimited = createEffect('blessing', {
      triggers: [
        {
          id: 'trigger_blessing',
          event: 'enter',
          actions: [
            { type: 'damage', parts: [{ formula: '2', type: 'piercing' }] },
          ],
          limit: { max: 1, per: 'longRest' },
        },
      ],
    });

    const zones = [
      createZone('ca_spikes', [turnLimited]),
      createZone('ca_blessing', [restLimited]),
    ];

    const orc = woundedCreature(40);
    const ids = new Set(zones.map((zone) => zone.id));

    const walkIn = (options) => {
      engine.syncActorAreaEffects(orc, ids, new Set(), zones, options);

      const { damageOutcomes } = engine.syncActorAreaEffects(
        orc,
        new Set(),
        ids,
        zones,
        options,
      );

      return damageOutcomes.length;
    };

    assert.equal(walkIn({ isInCombat: () => false }), 2);
    assert.equal(walkIn({ isInCombat: () => false }), 1);
    assert.equal(walkIn(undefined), 1);

    assert.deepEqual(Object.keys(orc.system.effectUsage), [
      'area:ca_blessing|trigger_blessing',
    ]);
  });

  it('спасбросок явного входа у игрока — запросом; провал отнимает скорость и держит фишку', async () => {
    const web = createEffect('web', {
      triggers: [
        {
          id: 'trigger_web',
          event: 'enter',
          save: { ability: 'dexterity', dc: 13 },
          actions: [{ type: 'applyCondition', conditionKey: 'restrained' }],
        },
      ],
    });

    const zone = createZone('ca_web', [web], { name: 'Паутина' });
    const hero = createActor();
    const double = createRequestRoll();

    const result = engine.syncActorAreaEffects(
      hero,
      new Set(),
      new Set([zone.id]),
      [zone],
      { requestRoll: double.requestRoll },
    );

    assert.equal(result.deferred.length, 1);
    assert.equal(result.deferred[0].blocksMovement, true);
    assert.equal(double.requests[0].requesterLabel, 'Зона «Паутина»');

    double.answer(answer(false));

    const outcome = (await result.deferred[0].resolution)(hero);

    assert.equal(outcome.changed, true);

    assert.ok(
      hero.activeEffects.some((effect) => effect.conditionKey === 'restrained'),
    );
  });
});

describe('ответы игрока на явные срабатывания хода', () => {
  it('ключ ожидания с id срабатывания, ответ накладывает состояние', async () => {
    const system = new engine.Dnd5eVttSystem();

    const aura = createEffect('stench-aura', {
      aura: { radius: 10, target: 'all', applyToSelf: false, visible: true },
      triggers: [
        {
          id: 'trigger_stench',
          event: 'turnStart',
          save: CON_SAVE,
          actions: [{ type: 'applyCondition', conditionKey: 'poisoned' }],
        },
      ],
    });

    const hero = createActor();
    const double = createRequestRoll();

    const context = {
      requestRoll: double.requestRoll,
      resolveAmbientEffects: () => [aura],
    };

    const first = system.runTurnEffects(hero, 'startOfTurn', context);
    const second = system.runTurnEffects(hero, 'startOfTurn', context);

    assert.equal(first.deferred.length, 1);

    assert.equal(
      second.deferred,
      undefined,
      'пока ответа нет, второй раз не спрашивают',
    );

    double.answer(answer(false));

    const applied = (await first.deferred[0].resolution)(hero);

    assert.equal(applied.changed, true);

    assert.deepEqual(
      hero.activeEffects.map((effect) => effect.conditionKey),
      ['poisoned'],
    );
  });
});

describe('бросок атаки', () => {
  /** «Следующая атака с преимуществом», раз в ход */
  const focus = createEffect('focus', {
    flags: ['attack.advantage'],
    triggers: [
      {
        id: 'trigger_focus',
        event: 'attackRoll',
        actions: [{ type: 'applyCondition', conditionKey: 'prone' }],
        limit: { max: 1, per: 'turn' },
      },
    ],
  });

  it('роль, лимит в бою и вне боя; со спасброском и выключенное не срабатывают', () => {
    const vex = createEffect('vex', { consumeOn: 'attackOnCarrier' });

    const guarded = createEffect('guarded', {
      triggers: [
        {
          id: 'trigger_guarded',
          event: 'attackRoll',
          save: CON_SAVE,
          actions: [{ type: 'removeSelf' }],
        },
      ],
    });

    const sleeping = createEffect('sleeping', {
      disabled: true,
      consumeOn: 'carrierAttack',
    });

    const hero = createActor({
      activeEffects: [focus, vex, guarded, sleeping],
    });

    const conditionsOf = () =>
      hero.activeEffects.flatMap((effect) =>
        effect.conditionKey ? [effect.conditionKey] : [],
      );

    const first = engine.runAttackRollTriggers(hero, 'attacker', {
      inCombat: true,
    });

    assert.deepEqual(first, { changed: true, usageChanged: true });
    assert.deepEqual(conditionsOf(), ['prone']);

    const second = engine.runAttackRollTriggers(hero, 'attacker', {
      inCombat: true,
    });

    assert.deepEqual(second, { changed: false, usageChanged: false });

    const outOfCombat = engine.runAttackRollTriggers(hero, 'attacker', {
      inCombat: false,
    });

    assert.equal(outOfCombat.usageChanged, true, 'остаток счётчика стёрт');
    assert.equal(hero.system.effectUsage, undefined);

    engine.runAttackRollTriggers(hero, 'target');

    // Цель расходует «следующую атаку по носителю»; спасбросок на броске атаки
    // не бросается, выключенный эффект не срабатывает
    assert.deepEqual(
      hero.activeEffects
        .filter((effect) => !effect.conditionKey)
        .map((effect) => effect.id),
      ['focus', 'guarded', 'sleeping'],
    );
  });

  it('счётчики едут боевым каналом; снимок без поля их не стирает', () => {
    const attacker = createActor({ activeEffects: [focus] });

    engine.runAttackRollTriggers(attacker, 'attacker', { inCombat: true });

    const state = engine.pickCombatState(attacker);

    assert.deepEqual(state.effectUsage, {
      'focus|trigger_focus': { used: 1, per: 'turn' },
    });

    const server = createActor({ activeEffects: [focus] });

    assert.equal(engine.applyCombatState(server, state), true);
    assert.deepEqual(server.system.effectUsage, state.effectUsage);

    const { effectUsage: _dropped, ...legacyState } = state;

    assert.equal(engine.applyCombatState(server, legacyState), false);
    assert.deepEqual(server.system.effectUsage, state.effectUsage);

    assert.equal(
      engine.applyCombatState(server, {
        ...state,
        effectUsage: { broken: { used: 'много', per: 'turn' } },
      }),
      true,
    );

    assert.equal(server.system.effectUsage, undefined);
  });
});

describe('урон эффекта по частям', () => {
  it('половина от суммы частей, защиты — после половины', () => {
    const hero = createActor();
    const rollFormula = (formula) => ({ total: Number(formula), values: [] });

    const halved = engine.rollEffectDamageParts(
      [
        { formula: '3', type: 'fire' },
        { formula: '3', type: 'cold' },
      ],
      engine.resolveActorStats(hero),
      hero,
      { scale: 0.5, rollFormula },
    );

    assert.equal(halved.total, 3);

    assert.deepEqual(
      halved.lines.map((line) => line.applied),
      [2, 1],
    );

    hero.system.defenses = {
      ...hero.system.defenses,
      vulnerabilities: ['fire'],
    };

    const vulnerable = engine.rollEffectDamageParts(
      [{ formula: '9', type: 'fire' }],
      engine.resolveActorStats(hero),
      hero,
      { scale: 0.5, rollFormula },
    );

    assert.equal(vulnerable.total, 8, '9 → половина 4 → уязвимость 8');
    assert.equal(vulnerable.outcome, 'vulnerability');
  });
});
