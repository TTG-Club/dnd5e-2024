import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  engine,
  strikeEntity,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Спасброски от смерти: серия, урон на нуле хитов и сброс по хитам.
 */

const EMPTY = { successes: 0, failures: 0 };

/**
 * Персонаж на нуле хитов с серией.
 *
 * @param {object} deathSaves - серия
 * @param {number} maximum - максимум хитов
 * @returns {object} персонаж
 */
function downedHero(deathSaves = EMPTY, maximum = 20) {
  const hero = withHp(createActor, 0, {}, maximum);

  hero.system.deathSaves = deathSaves;

  return hero;
}

describe('серия спасбросков от смерти', () => {
  it('успех от 10, провал ниже, 20 — хит, 1 — два провала', () => {
    assert.deepEqual(engine.resolveDeathSave(EMPTY, 12, 12), {
      state: { successes: 1, failures: 0 },
      outcome: 'success',
    });

    assert.equal(engine.resolveDeathSave(EMPTY, 9, 9).outcome, 'failure');

    assert.equal(
      engine.resolveDeathSave(EMPTY, 8, 10).outcome,
      'success',
      'прибавка дотягивает до Сл',
    );

    assert.equal(engine.resolveDeathSave(EMPTY, 20, 20).outcome, 'revived');

    assert.deepEqual(engine.resolveDeathSave(EMPTY, 1, 1).state, {
      successes: 0,
      failures: 2,
    });
  });

  it('три успеха — стабилен, три провала — мёртв', () => {
    assert.deepEqual(
      engine.resolveDeathSave({ successes: 2, failures: 1 }, 15, 15),
      { state: { successes: 3, failures: 1, stable: true }, outcome: 'stable' },
    );

    assert.equal(
      engine.resolveDeathSave({ successes: 0, failures: 2 }, 1, 1).outcome,
      'dead',
    );
  });

  it('итог пишется в персонажа: 1 хит или метка смерти', () => {
    const revived = downedHero({ successes: 1, failures: 2 });

    engine.applyDeathSaveResult(
      revived,
      engine.resolveDeathSave(engine.readDeathSaves(revived), 20, 20),
    );

    assert.equal(engine.resolveEntityCurrentHp(revived), 1);
    assert.deepEqual(revived.system.deathSaves, EMPTY);

    const dead = downedHero({ successes: 0, failures: 2 });

    engine.applyDeathSaveResult(
      dead,
      engine.resolveDeathSave(engine.readDeathSaves(dead), 5, 5),
    );

    assert.equal(engine.isActorDead(dead), true);
    assert.equal(engine.needsDeathSaves(dead), false);
  });

  it('бросают только персонажи на нуле, не стабильные и живые', () => {
    assert.equal(engine.needsDeathSaves(downedHero()), true);

    assert.equal(
      engine.needsDeathSaves(
        downedHero({ ...EMPTY, successes: 3, stable: true }),
      ),
      false,
    );

    assert.equal(engine.needsDeathSaves(withHp(createActor, 5)), false);

    assert.equal(
      engine.needsDeathSaves(withHp(createCreature, 0, {}, 10)),
      false,
    );
  });

  it('помеха и преимущество — флагами «Спасброски»', () => {
    const flags = (list) => new Set(list);

    assert.equal(
      engine.resolveDeathSaveRollMode(flags(['save.advantage.death'])),
      'advantage',
    );

    assert.equal(
      engine.resolveDeathSaveRollMode(
        flags(['save.advantage.death', 'save.disadvantage.death']),
      ),
      'normal',
    );
  });
});

describe('урон и хиты', () => {
  it('урон на нуле — провал, крит — два, урон не меньше максимума — смерть', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = downedHero({ successes: 1, failures: 0 });

    strikeEntity(system, hero, 3, 'slashing');
    assert.deepEqual(hero.system.deathSaves, { successes: 1, failures: 1 });

    strikeEntity(system, hero, 3, 'slashing', { details: { critical: true } });
    assert.equal(engine.isActorDead(hero), true, 'второй и третий провал');

    const tough = downedHero(EMPTY, 20);

    strikeEntity(system, tough, 20, 'fire');
    assert.equal(engine.isActorDead(tough), true, 'урон не меньше максимума');
  });

  it('удар, опустивший до нуля, серию не двигает; остаток не меньше максимума убивает', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 5, {}, 20);

    strikeEntity(system, hero, 10, 'slashing');
    assert.equal(engine.resolveEntityCurrentHp(hero), 0);
    assert.deepEqual(engine.readDeathSaves(hero), EMPTY);
    assert.equal(engine.isActorDead(hero), false);

    const frail = withHp(createActor, 5, {}, 20);

    strikeEntity(system, frail, 25, 'slashing');
    assert.equal(engine.isActorDead(frail), true, '25 − 5 = 20');
  });

  it('стабильный от урона снова начинает серию', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = downedHero({ successes: 3, failures: 1, stable: true });

    strikeEntity(system, hero, 2, 'slashing');

    assert.deepEqual(hero.system.deathSaves, { successes: 0, failures: 1 });
    assert.equal(engine.needsDeathSaves(hero), true);
  });

  it('лечение закрывает серию и снимает метку смерти, новое падение — с нуля', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = downedHero({ successes: 2, failures: 2 });

    hero.activeEffects = engine.withActorDeathMark([], true);

    const healed = structuredClone(hero);

    engine.applyTargetDamage(healed, 5, true);
    system.settleCombatState(hero, engine.pickCombatState(healed));

    assert.equal(engine.resolveEntityCurrentHp(hero), 5);
    assert.deepEqual(hero.system.deathSaves, EMPTY);
    assert.equal(engine.isActorDead(hero), false);

    const stale = withHp(createActor, 5, {}, 20);

    stale.system.deathSaves = { successes: 1, failures: 2 };
    strikeEntity(system, stale, 5, 'slashing');

    assert.deepEqual(stale.system.deathSaves, EMPTY, 'старая серия не тянется');
  });

  it('строка чата называет итог и счёт', () => {
    assert.equal(
      engine.formatDeathSaveSummary(
        'Гримли',
        { state: { successes: 1, failures: 2 }, outcome: 'failure' },
        false,
      ),
      'Гримли: спасбросок от смерти — провал (успехи 1/3, провалы 2/3)',
    );
  });
});
