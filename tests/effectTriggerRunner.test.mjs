import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  allCreaturesAura,
  answeredSave,
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  createToken,
  createTrait,
  createZone,
  engine,
  GRID,
  MAX_ROLL,
  MIN_ROLL,
  NO_REGENERATION_TAG,
  OTHER_TURN_ACTOR_ID,
  TROLL_REGENERATION,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Явные срабатывания: лимит «не чаще N раз» и его сбросы, состояние на ходу,
 * черты существа, ауры, вход в зону и ответы игрока.
 */

/** Спасбросок Телосложения Сл 12 */
const CONSTITUTION_SAVE = { ability: 'constitution', dc: 12 };

/** Максимум хитов существа в тестах */
const CREATURE_MAX_HP = 40;

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

describe('лимит «не чаще N раз»', () => {
  it('раз в ход: второй раз в том же ходу не бьёт, конец хода сбрасывает счётчик, начало — нет', () => {
    const orc = withHp(createCreature, CREATURE_MAX_HP, {
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

    assert.equal(
      engine.expireTurnEffects(orc, OTHER_TURN_ACTOR_ID, 'start'),
      false,
    );

    assert.equal(engine.processTurnEffects(orc, 'startOfTurn').damageTotal, 0);

    assert.equal(
      engine.expireTurnEffects(orc, OTHER_TURN_ACTOR_ID, 'end'),
      true,
    );

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
    save: CONSTITUTION_SAVE,
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
      aura: allCreaturesAura(10),
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
    const troll = withHp(createCreature, 10, {}, CREATURE_MAX_HP);

    troll.system.traits = [
      createTrait('Регенерация', [
        createEffect('regeneration', {
          recurringDamage: {
            damageParts: [{ formula: `${TROLL_REGENERATION}@heal` }],
            timing: 'startOfTurn',
          },
          recurringSave: { ability: 'wisdom', dc: 1, timing: 'startOfTurn' },
        }),
      ]),
    ];

    const result = withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(troll, 'startOfTurn'),
    );

    assert.equal(engine.resolveEntityCurrentHp(troll), 10 + TROLL_REGENERATION);
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
          save: CONSTITUTION_SAVE,
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
      ambientEffects: [{ ...hold, aura: allCreaturesAura(5) }],
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
    const orc = withHp(createCreature, CREATURE_MAX_HP);

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

    engine.expireTurnEffects(orc, OTHER_TURN_ACTOR_ID, 'end');
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

    const orc = withHp(createCreature, CREATURE_MAX_HP);
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

    double.answer(answeredSave(false));

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
      aura: allCreaturesAura(10),
      triggers: [
        {
          id: 'trigger_stench',
          event: 'turnStart',
          save: CONSTITUTION_SAVE,
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

    double.answer(answeredSave(false));

    const applied = (await first.deferred[0].resolution)(hero);

    assert.equal(applied.changed, true);

    assert.deepEqual(
      hero.activeEffects.map((effect) => effect.conditionKey),
      ['poisoned'],
    );
  });
});

describe('ход наложившего', () => {
  /** Заклинатель, наложивший эффект */
  const CASTER_ID = 'actor_caster';

  /** Наложивший в бою */
  const CASTER_IN_COMBAT = {
    isSourceInCombat: (sourceId) => sourceId === CASTER_ID,
  };

  /**
   * Эффект заклинателя: 5 огнём на ходу носителя и 3 некротической энергией на
   * ходу заклинателя.
   *
   * @param {object} overrides - поля эффекта
   * @returns {object} эффект
   */
  function casterCurse(overrides = {}) {
    return createEffect('curse', {
      sourceActorId: CASTER_ID,
      triggers: [
        burnTrigger({ id: 'trigger_own' }),
        burnTrigger({
          id: 'trigger_source',
          turnOf: 'source',
          actions: [
            { type: 'damage', parts: [{ formula: '3', type: 'necrotic' }] },
          ],
        }),
      ],
      ...overrides,
    });
  }

  it('срабатывает на ходу наложившего и только его, свои срабатывания — на ходу носителя', () => {
    const turn = (options) =>
      engine.processTurnEffects(
        createCreature({ activeEffects: [casterCurse()] }),
        'startOfTurn',
        options,
      ).damageTotal;

    assert.equal(turn(CASTER_IN_COMBAT), 5, 'ход носителя');

    assert.equal(
      turn({ ...CASTER_IN_COMBAT, sourceTurnActorId: CASTER_ID }),
      3,
      'ход заклинателя',
    );

    assert.equal(
      turn({ ...CASTER_IN_COMBAT, sourceTurnActorId: 'actor_other' }),
      0,
      'чужой ход',
    );
  });

  it('наложивший не в бою или неизвестен — срабатывание идёт на ходу носителя', () => {
    const outOfCombat = createCreature({ activeEffects: [casterCurse()] });

    assert.equal(
      engine.processTurnEffects(outOfCombat, 'startOfTurn').damageTotal,
      8,
    );

    const unknownSource = createCreature({
      activeEffects: [casterCurse({ sourceActorId: undefined })],
    });

    assert.equal(
      engine.processTurnEffects(unknownSource, 'startOfTurn', CASTER_IN_COMBAT)
        .damageTotal,
      8,
    );

    assert.equal(
      engine.processTurnEffects(unknownSource, 'startOfTurn', {
        ...CASTER_IN_COMBAT,
        sourceTurnActorId: CASTER_ID,
      }).damageTotal,
      0,
    );
  });

  it('аура: «в начале хода носителя ауры» бьёт стоящих рядом на его ходу', () => {
    const balor = createCreature({ id: 'creature_balor', name: 'Балор' });

    balor.activeEffects = [
      createEffect('fire-aura', {
        aura: allCreaturesAura(5),
        triggers: [burnTrigger({ id: 'trigger_fire_aura', turnOf: 'source' })],
      }),
    ];

    const hero = withHp(createCreature, CREATURE_MAX_HP, {
      id: 'creature_hero',
    });

    const ambientEffects = engine.calculateAmbientAuras(
      createToken(hero.id, 1, 0),
      [
        {
          token: createToken(balor.id, 0, 0),
          effects: engine.collectAllAuraEffects(balor),
        },
      ],
      GRID,
    );

    assert.equal(ambientEffects[0].sourceActorId, balor.id);

    const balorInCombat = { isSourceInCombat: () => true, ambientEffects };

    assert.equal(
      engine.processTurnEffects(hero, 'startOfTurn', balorInCombat).damageTotal,
      0,
      'ход героя',
    );

    assert.equal(
      engine.processTurnEffects(hero, 'startOfTurn', {
        ...balorInCombat,
        sourceTurnActorId: balor.id,
      }).damageTotal,
      5,
      'ход балора',
    );
  });

  it('состояние от срабатывания помнит наложившего; наложенное на своём ходу не спадает в конце этого хода', () => {
    const target = createCreature({
      activeEffects: [
        createEffect('dread', {
          sourceActorId: CASTER_ID,
          triggers: [
            {
              id: 'trigger_dread',
              event: 'turnEnd',
              actions: [
                {
                  type: 'applyCondition',
                  conditionKey: 'frightened',
                  duration: {
                    type: 'turn',
                    turnAnchor: 'carrier',
                    turnTiming: 'end',
                  },
                },
              ],
            },
          ],
        }),
      ],
    });

    engine.processTurnEffects(target, 'endOfTurn');

    const frightened = target.activeEffects.find(
      (effect) => effect.conditionKey === 'frightened',
    );

    assert.equal(frightened.sourceActorId, CASTER_ID);
    assert.equal(frightened.duration.turnSkipFirst, true);
  });

  it('система: спасбросок хода наложившего спрашивают у игрока отдельно от его хода', async () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = createActor({ id: CASTER_ID });
    const double = createRequestRoll();

    const hero = createActor({
      activeEffects: [
        createEffect('hold', {
          sourceActorId: CASTER_ID,
          triggers: [
            {
              id: 'trigger_hold',
              event: 'turnEnd',
              turnOf: 'source',
              save: CONSTITUTION_SAVE,
              actions: [{ type: 'removeSelf', on: 'saved' }],
            },
          ],
        }),
      ],
    });

    const context = {
      requestRoll: double.requestRoll,
      getEntity: (entityId) => (entityId === CASTER_ID ? caster : undefined),
      isInCombat: () => true,
    };

    assert.equal(
      system.runTurnEffects(hero, 'endOfTurn', context).deferred,
      undefined,
      'на ходу носителя не спрашивают',
    );

    const sourceTurn = system.runSourceTurnEffects(
      hero,
      CASTER_ID,
      'endOfTurn',
      context,
    );

    assert.equal(sourceTurn.deferred.length, 1);

    double.answer(answeredSave(true));

    const applied = (await sourceTurn.deferred[0].resolution)(hero);

    assert.equal(applied.changed, true);
    assert.match(applied.chatSummary, /конец хода наложившего/u);
    assert.equal(hero.activeEffects.length, 0);
  });
});

describe('отметки', () => {
  /**
   * Тролль: регенерация в начале хода, если нет отметки; атака по нему ставит
   * отметку до начала его следующего хода.
   *
   * @returns {object} тролль
   */
  function createTroll() {
    const troll = withHp(
      createCreature,
      20,
      { id: 'creature_troll' },
      CREATURE_MAX_HP,
    );

    troll.activeEffects = [
      createEffect('regeneration', {
        triggers: [
          {
            id: 'trigger_regen',
            event: 'turnStart',
            condition: `self.tag !== "${NO_REGENERATION_TAG}"`,
            actions: [
              {
                type: 'damage',
                parts: [{ formula: `${TROLL_REGENERATION}@heal` }],
              },
            ],
          },
          {
            id: 'trigger_struck',
            event: 'attackRoll',
            role: 'target',
            actions: [
              {
                type: 'applyTag',
                tag: NO_REGENERATION_TAG,
                label: 'Без регенерации',
              },
            ],
          },
        ],
      }),
    ];

    return troll;
  }

  it('отметка из срабатывания выключает другое срабатывание до начала следующего хода носителя', () => {
    const troll = createTroll();

    engine.runAttackRollTriggers(troll, 'target');
    engine.runAttackRollTriggers(troll, 'target');

    const tags = troll.activeEffects.filter((effect) => effect.tag);

    assert.equal(tags.length, 1, 'повторная отметка обновляет прежнюю');
    assert.equal(tags[0].name, 'Без регенерации');

    assert.deepEqual(
      [tags[0].duration.type, tags[0].duration.turnTiming],
      ['turn', 'start'],
    );

    assert.equal(
      engine.processTurnEffects(troll, 'startOfTurn').healingOutcomes.length,
      0,
      'на ходу с отметкой регенерации нет',
    );

    engine.expireTurnEffects(troll, troll.id, 'start');
    assert.equal(engine.hasEffectTag(troll, NO_REGENERATION_TAG), false);

    assert.equal(
      engine.processTurnEffects(troll, 'startOfTurn').healingOutcomes.length,
      1,
    );
  });

  it('сводка называет отметку и условие по ней', () => {
    const [regeneration, struck] = createTroll().activeEffects[0].triggers;
    const options = { formatDc: String };

    assert.equal(
      engine.describeEffectTrigger(regeneration, options),
      `в начале хода, если на носителе нет отметки «${NO_REGENERATION_TAG}»: ${TROLL_REGENERATION} лечения`,
    );

    assert.equal(
      engine.describeEffectTrigger(struck, options),
      'после атаки по носителю: отметка «Без регенерации»',
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
          save: CONSTITUTION_SAVE,
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

    // Цель расходует «следующую атаку по носителю»; срабатывание со спасброском
    // на клиенте не бросается — его выполняет сервер, выключенный эффект не
    // срабатывает
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
