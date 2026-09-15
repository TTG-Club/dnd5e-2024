import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createActor, createCreature, engine } from './_fixtures.mjs';

/**
 * Каталог: состояния D&D 5e 2024 (`docs/EFFECT_SCENARIOS.md`, раздел «Состояния»).
 * Состояние накладывается тем же путём, что атака или заклинание.
 */

/**
 * Статы сущности с наложенными состояниями.
 *
 * @param {object} entity - сущность
 * @param {string[]} conditionKeys - состояния
 * @returns {object} статы
 */
function statsWithConditions(entity, conditionKeys) {
  const effects = conditionKeys.map((conditionKey) =>
    engine.buildConditionActiveEffect(conditionKey),
  );

  entity.activeEffects = engine.applyEffectsToEntity(
    entity,
    effects,
    'condition',
  );

  return engine.resolveActorStats(entity);
}

/**
 * Режим рукопашной и дальнобойной атаки по цели.
 *
 * @param {Set<string>} attackerFlags - флаги атакующего
 * @param {Set<string>} targetFlags - флаги цели
 * @returns {{ melee: string, ranged: string }} режимы
 */
function attackModes(attackerFlags, targetFlags) {
  return {
    melee: engine.resolveAttackRollMode({
      attackerFlags,
      attackType: 'melee',
      targetFlags,
    }),
    ranged: engine.resolveAttackRollMode({
      attackerFlags,
      attackType: 'ranged',
      targetFlags,
    }),
  };
}

/** Флаги без состояний */
const NO_FLAGS = new Set();

describe('каталог: состояния', () => {
  it('[CD01] Лежащий ничком: рукопашные по нему с преимуществом, дальнобойные с помехой, сам — с помехой', () => {
    const prone = statsWithConditions(createCreature(), ['prone']).activeFlags;

    assert.deepEqual(attackModes(NO_FLAGS, prone), {
      melee: 'advantage',
      ranged: 'disadvantage',
    });

    assert.deepEqual(attackModes(prone, NO_FLAGS), {
      melee: 'disadvantage',
      ranged: 'disadvantage',
    });
  });

  it('[CD02] Схваченный: скорость 0', () => {
    const stats = statsWithConditions(createActor(), ['grappled']);

    assert.equal(engine.resolveTotalMovementSpeed(stats), 0);
  });

  it('[CD03] Парализованный: недееспособен, автопровал Силы и Ловкости, атаки по нему с преимуществом', () => {
    const flags = statsWithConditions(createActor(), ['paralyzed']).activeFlags;

    assert.ok(flags.has('incapacitated'));
    assert.ok(flags.has('save.autoFail.strength'));
    assert.ok(flags.has('save.autoFail.dexterity'));
    assert.equal(attackModes(NO_FLAGS, flags).melee, 'advantage');
  });

  it.todo(
    '[CD03b] Парализованный: попадание в пределах 5 фт — всегда крит — пробел (нет дистанции атаки в движке)',
  );

  it('[CD04] Невидимый против Ослеплённого: невидимый бьёт с преимуществом, слепой по невидимому — с помехой', () => {
    const invisible = statsWithConditions(createActor(), [
      'invisible',
    ]).activeFlags;

    const blinded = statsWithConditions(createCreature(), [
      'blinded',
    ]).activeFlags;

    assert.equal(attackModes(invisible, blinded).melee, 'advantage');
    assert.equal(attackModes(blinded, invisible).melee, 'disadvantage');
    assert.equal(engine.resolveInitiativeRollMode(invisible), 'advantage');
  });

  it('[CD05] Истощение 3: −6 к d20-тестам и −15 фт скорости', () => {
    const hero = createActor();
    const baseline = engine.resolveActorStats(hero);

    hero.activeEffects = engine.withExhaustionLevel([], 3);

    const stats = engine.resolveActorStats(hero);

    assert.equal(stats.saves.wisdom - baseline.saves.wisdom, -6);
    assert.equal(stats.attackBonuses.melee - baseline.attackBonuses.melee, -6);
    assert.equal(stats.initiative - baseline.initiative, -6);
    assert.equal(stats.movement.walk, baseline.movement.walk - 15);

    hero.activeEffects = engine.withExhaustionLevel(hero.activeEffects, 0);
    assert.deepEqual(hero.activeEffects, []);
  });

  it('[CD06] Окаменевший: сопротивление всему урону и иммунитет к Отравлению', () => {
    const creature = createCreature();
    const stats = statsWithConditions(creature, ['petrified']);

    assert.ok(stats.damageDefenses.resistances.has('fire'));
    assert.ok(stats.activeFlags.has('incapacitated'));

    const poisoned = engine.buildConditionActiveEffect('poisoned');

    assert.equal(
      engine
        .applyEffectsToEntity(creature, [poisoned], 'condition')
        .some((effect) => effect.conditionKey === 'poisoned'),
      false,
    );
  });

  it('[CD07] Отравленный: помеха на атаки и проверки характеристик', () => {
    const flags = statsWithConditions(createActor(), ['poisoned']).activeFlags;

    assert.equal(attackModes(flags, NO_FLAGS).melee, 'disadvantage');

    assert.equal(
      engine.resolveAbilityCheckRollMode({
        flags,
        ability: 'wisdom',
        skill: 'perception',
      }),
      'disadvantage',
    );
  });

  it('[CD08] Повторное наложение того же состояния заменяет прежнее, разные складываются', () => {
    const hero = createActor();

    statsWithConditions(hero, ['poisoned']);
    statsWithConditions(hero, ['poisoned']);
    assert.equal(hero.activeEffects.length, 1);

    statsWithConditions(hero, ['prone']);
    assert.equal(hero.activeEffects.length, 2);
  });

  it('[CD09] Недееспособный: флаг и помеха на инициативу', () => {
    const flags = statsWithConditions(createActor(), [
      'incapacitated',
    ]).activeFlags;

    assert.ok(flags.has('incapacitated'));
    assert.equal(engine.resolveInitiativeRollMode(flags), 'disadvantage');
  });

  it('[CD10] Преимущество и помеха гасят друг друга: отравленный атакует лежащего рукопашной', () => {
    const poisoned = statsWithConditions(createActor(), [
      'poisoned',
    ]).activeFlags;

    const prone = statsWithConditions(createCreature(), ['prone']).activeFlags;

    assert.equal(attackModes(poisoned, prone).melee, 'normal');
  });

  it.todo(
    '[CD11] Бессознательный: падает ничком и роняет предметы — пробел (побочные действия состояния)',
  );
});
