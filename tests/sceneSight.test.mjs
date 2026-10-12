import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
} from './scenarios/_fixtures.mjs';

/**
 * «Видит ли одно существо другое» — правило D&D поверх фактов ядра
 * (`src/engine/sceneSight.ts`). Ядро отдаёт геометрию и свет, правило собирает
 * система: зрение смотрящего, слепота, невидимость, тёмное зрение.
 */

/** Дальность тёмного зрения в сценариях, фт */
const DARKVISION_FEET = 60;

/**
 * Факты ядра о паре фишек: по умолчанию цель рядом, на свету и ничем не
 * закрыта.
 *
 * @param {object} overrides - что отличается
 * @returns {object} факты
 */
function factsOf(overrides = {}) {
  return {
    lineOfSight: true,
    inVisionCone: true,
    distance: 30,
    targetLight: 'bright',
    viewerLight: 'bright',
    seenLight: 'bright',
    ...overrides,
  };
}

/**
 * Зрение смотрящего по умолчанию: включено, без предела дальности, тёмного
 * зрения нет.
 *
 * @param {object} overrides - что отличается
 * @returns {object} зрение
 */
function abilityOf(overrides = {}) {
  return { enabled: true, range: 0, darkvision: 0, ...overrides };
}

/**
 * Существо с настройками зрения фишки.
 *
 * @param {string} id - сущность
 * @param {object} vision - настройки зрения фишки
 * @param {object[]} activeEffects - эффекты
 * @returns {object} существо
 */
function creatureWith(id, vision = {}, activeEffects = []) {
  const creature = createCreature({ id, activeEffects });

  creature.token = {
    ...creature.token,
    vision: { enabled: true, range: 0, darkvision: 0, angle: 360, ...vision },
  };

  return creature;
}

/**
 * Источник фактов: у каждой сущности одна фишка, факты одни на все пары.
 *
 * @param {object | null} facts - факты, которые отдаёт ядро
 * @returns {object} источник
 */
function sourceOf(facts) {
  return {
    getSightBetween: () => facts,
    listTokenIds: (entity) => [`token_${entity.id}`],
  };
}

describe('правило «видит» по фактам ядра', () => {
  it('цель на свету и ничем не закрыта — видна', () => {
    assert.equal(engine.canSeeByFacts(factsOf(), abilityOf()), true);
  });

  it('стена, сектор обзора и выключенное зрение — не видна', () => {
    assert.equal(
      engine.canSeeByFacts(factsOf({ lineOfSight: false }), abilityOf()),
      false,
    );

    assert.equal(
      engine.canSeeByFacts(factsOf({ inVisionCone: false }), abilityOf()),
      false,
    );

    assert.equal(
      engine.canSeeByFacts(factsOf(), abilityOf({ enabled: false })),
      false,
    );
  });

  it('дальше дальности зрения фишки — не видна; ноль дальности — без предела', () => {
    assert.equal(
      engine.canSeeByFacts(factsOf({ distance: 65 }), abilityOf({ range: 60 })),
      false,
    );

    assert.equal(
      engine.canSeeByFacts(factsOf({ distance: 60 }), abilityOf({ range: 60 })),
      true,
    );

    assert.equal(
      engine.canSeeByFacts(factsOf({ distance: 500 }), abilityOf()),
      true,
    );
  });

  it('в темноте видно только на дальность тёмного зрения', () => {
    const dark = factsOf({ seenLight: 'dark', targetLight: 'dark' });

    assert.equal(engine.canSeeByFacts(dark, abilityOf()), false);

    assert.equal(
      engine.canSeeByFacts(dark, abilityOf({ darkvision: DARKVISION_FEET })),
      true,
    );

    assert.equal(
      engine.canSeeByFacts(
        { ...dark, distance: 65 },
        abilityOf({ darkvision: DARKVISION_FEET }),
      ),
      false,
    );
  });

  it('тусклый свет — тоже свет', () => {
    assert.equal(
      engine.canSeeByFacts(factsOf({ seenLight: 'dim' }), abilityOf()),
      true,
    );
  });

  it('цель освещена только с невидимой стороны — видимая часть в темноте', () => {
    assert.equal(
      engine.canSeeByFacts(
        factsOf({ targetLight: 'bright', seenLight: 'dark' }),
        abilityOf(),
      ),
      false,
    );
  });
});

describe('зрение существа', () => {
  it('берётся из настроек фишки', () => {
    const scout = creatureWith('creature_scout', {
      range: 120,
      darkvision: DARKVISION_FEET,
    });

    assert.deepEqual(engine.resolveSightAbility(scout), {
      enabled: true,
      range: 120,
      darkvision: DARKVISION_FEET,
    });
  });

  it('выключенное зрение фишки и ослепление — зрения нет', () => {
    const noVision = creatureWith('creature_golem', { enabled: false });

    const blinded = creatureWith('creature_bat', {}, [
      createEffect('Ослепление', { flags: ['vision.blinded'] }),
    ]);

    assert.equal(engine.resolveSightAbility(noVision).enabled, false);
    assert.equal(engine.resolveSightAbility(blinded).enabled, false);
  });

  it('правка сущности на месте видна сразу: кэша по объекту нет', () => {
    const hero = creatureWith('creature_hero');

    assert.equal(engine.resolveSightAbility(hero).enabled, true);

    // Так правит сущность сервер: объект тот же, эффекты новые
    hero.activeEffects = [
      createEffect('Ослепление', { flags: ['vision.blinded'] }),
    ];

    assert.equal(engine.resolveSightAbility(hero).enabled, false);
  });
});

describe('видимость и свет сцены для правил', () => {
  const viewer = creatureWith('creature_viewer');
  const target = creatureWith('creature_target');

  it('без источника фактов видимости нет', () => {
    assert.equal(engine.createSceneSight(undefined), undefined);
  });

  it('нет фактов о паре — ответ «неизвестно», а не «не видит»', () => {
    const sight = engine.createSceneSight(sourceOf(null));

    assert.equal(sight.canSee(viewer, target), undefined);
    assert.equal(sight.lightOf(viewer), undefined);
  });

  it('сущности нет на сцене — ответ «неизвестно»', () => {
    const sight = engine.createSceneSight({
      getSightBetween: () => factsOf(),
      listTokenIds: () => [],
    });

    assert.equal(sight.canSee(viewer, target), undefined);
  });

  it('видит цель на свету и не видит за стеной', () => {
    assert.equal(
      engine.createSceneSight(sourceOf(factsOf())).canSee(viewer, target),
      true,
    );

    assert.equal(
      engine
        .createSceneSight(sourceOf(factsOf({ lineOfSight: false })))
        .canSee(viewer, target),
      false,
    );
  });

  it('невидимую цель не видит никто, как бы светло ни было', () => {
    const hidden = creatureWith('creature_hidden', {}, [
      createEffect('Невидимость', { flags: ['vision.invisible'] }),
    ]);

    assert.equal(
      engine.createSceneSight(sourceOf(factsOf())).canSee(viewer, hidden),
      false,
    );
  });

  it('копий существа несколько — берётся лучшая пара', () => {
    const sight = engine.createSceneSight({
      getSightBetween: (viewerTokenId) =>
        factsOf({ lineOfSight: viewerTokenId === 'near' }),
      listTokenIds: (entity) =>
        entity.id === viewer.id ? ['far', 'near'] : ['token_target'],
    });

    assert.equal(sight.canSee(viewer, target), true);
  });

  it('освещённость существа — свет его места', () => {
    assert.equal(
      engine
        .createSceneSight(sourceOf(factsOf({ viewerLight: 'dim' })))
        .lightOf(viewer),
      'dim',
    );
  });
});

describe('факты из контекста срабатывания ядра', () => {
  const hero = createActor({ id: 'actor_hero' });

  /**
   * Сцена, на которой у сущности есть фишка.
   *
   * @param {object} entity - сущность
   * @returns {object} сцена вокруг неё
   */
  function surroundingsOf(entity) {
    return {
      token: createToken(entity.id, 0, 0),
      gridSettings: GRID,
      neighbors: [],
    };
  }

  it('старое ядро фактов не отдаёт — источника нет', () => {
    assert.equal(engine.createContextSightSource(undefined), undefined);

    assert.equal(
      engine.createContextSightSource({
        getSceneSurroundings: surroundingsOf,
      }),
      undefined,
    );
  });

  it('фишку сущности называет сцена, факты — ядро', () => {
    const asked = [];

    const source = engine.createContextSightSource({
      getSceneSurroundings: surroundingsOf,
      getSightBetween: (viewerTokenId, targetTokenId) => {
        asked.push([viewerTokenId, targetTokenId]);

        return factsOf();
      },
    });

    assert.deepEqual(source.listTokenIds(hero), ['token_actor_hero']);

    source.getSightBetween('token_actor_hero', 'token_creature_wolf');

    assert.deepEqual(asked, [['token_actor_hero', 'token_creature_wolf']]);
  });

  it('сущности нет на сцене — фишек нет', () => {
    const source = engine.createContextSightSource({
      getSceneSurroundings: () => null,
      getSightBetween: () => factsOf(),
    });

    assert.deepEqual(source.listTokenIds(hero), []);
  });
});

describe('видимость в броске атаки', () => {
  const attacker = creatureWith('creature_attacker');
  const target = creatureWith('creature_target');

  /**
   * Видимость сцены, где каждая сторона видит или не видит другую.
   *
   * @param {boolean} attackerSees - атакующий видит цель
   * @param {boolean} targetSees - цель видит атакующего
   * @returns {object} видимость
   */
  function sightOf(attackerSees, targetSees) {
    return {
      canSee: (viewer) =>
        viewer.id === attacker.id ? attackerSees : targetSees,
      lightOf: () => 'bright',
    };
  }

  it('обе стороны видят друг друга — бросок не меняется', () => {
    assert.deepEqual(
      engine.resolveAttackSight(sightOf(true, true), attacker, target),
      { isTargetUnseen: false, isAttackerUnseen: false },
    );
  });

  it('цель не видна — помеха; атакующий не виден — преимущество', () => {
    assert.deepEqual(
      engine.resolveAttackSight(sightOf(false, true), attacker, target),
      { isTargetUnseen: true, isAttackerUnseen: false },
    );

    assert.deepEqual(
      engine.resolveAttackSight(sightOf(true, false), attacker, target),
      { isTargetUnseen: false, isAttackerUnseen: true },
    );
  });

  it('видимость неизвестна или цели нет — бросок не меняется', () => {
    const unknown = { canSee: () => undefined, lightOf: () => undefined };
    const plain = { isTargetUnseen: false, isAttackerUnseen: false };

    assert.deepEqual(
      engine.resolveAttackSight(unknown, attacker, target),
      plain,
    );

    assert.deepEqual(
      engine.resolveAttackSight(undefined, attacker, target),
      plain,
    );

    assert.deepEqual(
      engine.resolveAttackSight(sightOf(false, false), attacker, undefined),
      plain,
    );

    assert.deepEqual(
      engine.resolveAttackSight(sightOf(false, false), attacker, attacker),
      plain,
    );
  });

  it('окно броска называет причину помехи и преимущества', () => {
    const reasons = engine.explainAttackRollMode({
      attackType: 'melee',
      attackerFlags: new Set(),
      attackerEffects: [],
      rollContext: { hasAdvantage: false, hasDisadvantage: false },
      targetFlags: new Set(),
      targetEffects: [],
      isBeyondNormalRange: false,
      isTargetUnseen: true,
      isAttackerUnseen: true,
    });

    assert.deepEqual(reasons, {
      advantage: ['цель не видит атакующего'],
      disadvantage: ['цель не видна'],
    });
  });

  it('преимущество от невидимого атакующего и помеха гасят друг друга', () => {
    const attackerFlags = new Set([engine.UNSEEN_ATTACKER_ADVANTAGE_FLAG]);

    assert.equal(
      engine.resolveAttackRollMode({ attackerFlags, attackType: 'melee' }),
      'advantage',
    );

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags,
        attackType: 'melee',
        forceDisadvantage: true,
      }),
      'normal',
    );
  });
});
