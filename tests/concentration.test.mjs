import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createEffect,
  createRequestRoll,
  engine,
  MIN_ROLL,
  strikeEntity,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Концентрация: метка на заклинателе — обычный эффект со срабатываниями урона
 * и 0 хитов; конец каста снимает эффекты этого каста у всех и только его.
 */

/** Заклинатель */
const CASTER_ID = 'actor_cleric';

/** Каст «Благословения» */
const BLESS_CAST_ID = 'cast_bless';

/** Заклинание с концентрацией на минуту */
const BLESS = {
  name: 'Благословение',
  durationUnit: 'minute',
  durationValue: 1,
};

/**
 * Заклинатель с меткой концентрации и хитами.
 *
 * @param {number} hitPoints - текущие хиты (максимум 40)
 * @param {object[]} extraEffects - другие эффекты
 * @returns {object} заклинатель
 */
function concentratingCaster(hitPoints, extraEffects = []) {
  const caster = createActor({
    id: CASTER_ID,
    activeEffects: [
      engine.buildConcentrationEffect({
        spell: BLESS,
        casterId: CASTER_ID,
        castId: BLESS_CAST_ID,
      }),
      ...extraEffects,
    ],
  });

  caster.system.hitPoints = { current: hitPoints, max: 40, temp: 0 };

  return caster;
}

/**
 * Контекст ядра, который запоминает законченные касты.
 *
 * @param {object} overrides - другие возможности ядра
 * @returns {{ context: object, ended: Array }} контекст и журнал
 */
function castEndingContext(overrides = {}) {
  const ended = [];

  return {
    ended,
    context: {
      endCasts: (casterId, castIds) => ended.push([casterId, castIds]),
      ...overrides,
    },
  };
}

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

    assert.deepEqual(failed.ended, [[CASTER_ID, [BLESS_CAST_ID]]]);
    assert.equal(wounded.activeEffects.length, 0);

    const dropped = castEndingContext();
    const fallen = concentratingCaster(5);

    // Бросок на максимум: спасбросок от урона пройден, но хиты упали до 0
    withRandom([0.999], () =>
      strikeEntity(system, fallen, 10, 'slashing', dropped),
    );

    assert.deepEqual(dropped.ended, [[CASTER_ID, [BLESS_CAST_ID]]]);
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
    assert.deepEqual(ended, [[CASTER_ID, [BLESS_CAST_ID]]]);
  });
});

describe('конец каста', () => {
  it('снимаются эффекты этого каста и этого заклинателя, остальные остаются', () => {
    const system = new engine.Dnd5eVttSystem();

    const blessed = createActor({
      activeEffects: [
        createEffect('bless', {
          castId: BLESS_CAST_ID,
          sourceActorId: CASTER_ID,
        }),
        createEffect('foreign-bless', {
          castId: BLESS_CAST_ID,
          sourceActorId: 'actor_other',
        }),
        createEffect('shield', { sourceActorId: CASTER_ID }),
      ],
    });

    const result = system.removeCastEffects(
      blessed,
      CASTER_ID,
      new Set([BLESS_CAST_ID]),
    );

    assert.equal(result.changed, true);

    assert.deepEqual(
      blessed.activeEffects.map((effect) => effect.id),
      ['foreign-bless', 'shield'],
    );

    assert.equal(
      system.removeCastEffects(blessed, CASTER_ID, new Set([BLESS_CAST_ID]))
        .changed,
      false,
    );
  });

  it('«прервать концентрацию» от клиента: только тот, кто управляет заклинателем', () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = concentratingCaster(40);
    const event = engine.buildEndCastsEvent(CASTER_ID, [BLESS_CAST_ID]);

    const run = (canControl) => {
      const { context, ended } = castEndingContext({
        getEntity: (entityId) => (entityId === CASTER_ID ? caster : undefined),
        canControl: () => canControl,
      });

      system.handleClientEvent(event, context);

      return ended;
    };

    assert.deepEqual(run(false), []);
    assert.deepEqual(run(true), [[CASTER_ID, [BLESS_CAST_ID]]]);

    assert.deepEqual(
      engine.parseSystemClientEvent({ type: 'endCasts', casterId: CASTER_ID }),
      null,
    );
  });
});
