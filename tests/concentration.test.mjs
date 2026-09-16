import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  answeredSave,
  BLESS_CAST_ID,
  castEndingContext,
  CLERIC_ID,
  concentratingCaster,
  createActor,
  createEffect,
  createRequestRoll,
  engine,
  MAX_ROLL,
  MIN_ROLL,
  strikeEntity,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Концентрация: метка на заклинателе — обычный эффект со срабатываниями урона
 * и 0 хитов; конец каста снимает эффекты этого каста у всех и только его.
 */

describe('метка концентрации', () => {
  it('срок — как у заклинания; срабатывания урона и 0 хитов на месте', () => {
    const [mark] = concentratingCaster(40).activeEffects;

    assert.deepEqual(mark.duration, {
      type: 'minutes',
      value: 1,
      remaining: 10,
    });

    assert.equal(mark.concentration, true);

    assert.deepEqual(
      mark.triggers.map((trigger) => trigger.event),
      ['damageTaken', 'hpZero'],
    );
  });

  it('урон — спасбросок Телосложения у игрока: Сл от урона, не против магии', () => {
    const system = new engine.Dnd5eVttSystem();
    const double = createRequestRoll();
    const caster = concentratingCaster(40);

    strikeEntity(system, caster, 24, 'slashing', {
      context: { requestRoll: double.requestRoll },
    });

    const { payload } = double.requests[0];

    assert.equal(payload.dc, 12);
    assert.equal(payload.againstConcentration, true);
    assert.equal(payload.againstMagic, false);
  });

  it('провал на сервере и 0 хитов заканчивают каст и снимают метку', () => {
    const system = new engine.Dnd5eVttSystem();

    const failed = castEndingContext();
    const wounded = concentratingCaster(40);

    withRandom([MIN_ROLL], () =>
      strikeEntity(system, wounded, 10, 'slashing', failed),
    );

    assert.deepEqual(failed.ended, [[CLERIC_ID, [BLESS_CAST_ID]]]);
    assert.equal(wounded.activeEffects.length, 0);

    const dropped = castEndingContext();
    const fallen = concentratingCaster(5);

    // Бросок на максимум: спасбросок от урона пройден, но хиты упали до 0
    withRandom([MAX_ROLL], () =>
      strikeEntity(system, fallen, 10, 'slashing', dropped),
    );

    assert.deepEqual(dropped.ended, [[CLERIC_ID, [BLESS_CAST_ID]]]);
  });

  it('«Боевой заклинатель»: преимущество только на спасброске концентрации', () => {
    const flags = new Set(['save.advantage.vsConcentration']);

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags,
        ability: 'constitution',
        againstConcentration: true,
      }),
      'advantage',
    );

    assert.equal(
      engine.resolveSavingThrowRollMode({ flags, ability: 'constitution' }),
      'normal',
    );
  });

  it('истёкшая метка заканчивает свой каст', () => {
    const system = new engine.Dnd5eVttSystem();
    const { context, ended } = castEndingContext();
    const caster = concentratingCaster(40);

    caster.activeEffects[0].duration = {
      type: 'rounds',
      value: 1,
      remaining: 1,
    };

    assert.equal(system.decrementEffectDurations(caster, context), true);
    assert.deepEqual(ended, [[CLERIC_ID, [BLESS_CAST_ID]]]);
  });
});

describe('конец каста', () => {
  it('снимаются эффекты этого каста и этого заклинателя, остальные остаются', () => {
    const system = new engine.Dnd5eVttSystem();

    const blessed = createActor({
      activeEffects: [
        createEffect('bless', {
          castId: BLESS_CAST_ID,
          sourceActorId: CLERIC_ID,
        }),
        createEffect('foreign-bless', {
          castId: BLESS_CAST_ID,
          sourceActorId: 'actor_other',
        }),
        createEffect('shield', { sourceActorId: CLERIC_ID }),
      ],
    });

    const result = system.removeCastEffects(
      blessed,
      CLERIC_ID,
      new Set([BLESS_CAST_ID]),
    );

    assert.equal(result.changed, true);

    assert.deepEqual(
      blessed.activeEffects.map((effect) => effect.id),
      ['foreign-bless', 'shield'],
    );

    assert.equal(
      system.removeCastEffects(blessed, CLERIC_ID, new Set([BLESS_CAST_ID]))
        .changed,
      false,
    );
  });

  it('«прервать концентрацию» от клиента: только тот, кто управляет заклинателем', () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = concentratingCaster(40);
    const event = engine.buildEndCastsEvent(CLERIC_ID, [BLESS_CAST_ID]);

    const run = (canControl) => {
      const { context, ended } = castEndingContext({
        getEntity: (entityId) => (entityId === CLERIC_ID ? caster : undefined),
        canControl: () => canControl,
      });

      system.handleClientEvent(event, context);

      return ended;
    };

    assert.deepEqual(run(false), []);
    assert.deepEqual(run(true), [[CLERIC_ID, [BLESS_CAST_ID]]]);

    assert.deepEqual(
      engine.parseSystemClientEvent({ type: 'endCasts', casterId: CLERIC_ID }),
      null,
    );
  });
});

describe('наложенное срабатыванием эффекта каста', () => {
  /** Спасбросок Мудрости, которым снимается эффект каста */
  const WISDOM_SAVE = { ability: 'wisdom', dc: 13 };

  /**
   * Эффект каста на цели со своим срабатыванием.
   *
   * @param {object} trigger - срабатывание
   * @returns {object} эффект
   */
  function castEffect(trigger) {
    return createEffect('bless', {
      castId: BLESS_CAST_ID,
      sourceActorId: CLERIC_ID,
      magical: true,
      flags: ['attack.disadvantage'],
      triggers: [trigger],
    });
  }

  it('состояние от срабатывания уходит вместе с кастом', () => {
    const system = new engine.Dnd5eVttSystem();

    const effect = castEffect({
      id: 'trigger_prone',
      event: 'turnStart',
      actions: [{ type: 'applyCondition', conditionKey: 'prone' }],
    });

    const target = createActor({ activeEffects: [effect] });

    engine.applyTriggerEffectActions(
      target,
      {
        effect,
        trigger: effect.triggers[0],
        ambient: false,
        instance: true,
        scope: effect.id,
      },
      false,
    );

    const prone = target.activeEffects.find(
      (entry) => entry.conditionKey === 'prone',
    );

    assert.equal(prone.castId, BLESS_CAST_ID);
    assert.equal(prone.sourceActorId, CLERIC_ID);

    system.removeCastEffects(target, CLERIC_ID, new Set([BLESS_CAST_ID]));

    assert.deepEqual(target.activeEffects, []);
  });

  it('ответ игрока на спасбросок хода заканчивает каст', async () => {
    const system = new engine.Dnd5eVttSystem();
    const double = createRequestRoll();

    const { context, ended } = castEndingContext({
      requestRoll: double.requestRoll,
    });

    const target = createActor({
      autoSaves: false,
      activeEffects: [
        castEffect({
          id: 'trigger_end',
          event: 'turnEnd',
          save: WISDOM_SAVE,
          actions: [{ type: 'endCast', on: 'saved' }],
        }),
      ],
    });

    const result = system.runTurnEffects(target, 'endOfTurn', context);

    double.answer(answeredSave(true));

    const applied = (await result.deferred[0].resolution)(target);

    assert.equal(applied.changed, true);
    assert.deepEqual(ended, [[CLERIC_ID, [BLESS_CAST_ID]]]);
  });
});
