import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createToken,
  createZone,
  engine,
  GRID,
  sightFacts,
} from './scenarios/_fixtures.mjs';

/**
 * «Видит ли одно существо другое» — правило D&D поверх фактов ядра
 * (`src/engine/sceneSight.ts`). Ядро отдаёт геометрию и свет, правило собирает
 * система: зрение смотрящего, слепота, невидимость, тёмное зрение.
 */

/** Дальность тёмного зрения в сценариях, фт */
const DARKVISION_FEET = 60;

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
    assert.equal(engine.canSeeByFacts(sightFacts(), abilityOf()), true);
  });

  it('стена, сектор обзора и выключенное зрение — не видна', () => {
    assert.equal(
      engine.canSeeByFacts(sightFacts({ lineOfSight: false }), abilityOf()),
      false,
    );

    assert.equal(
      engine.canSeeByFacts(sightFacts({ inVisionCone: false }), abilityOf()),
      false,
    );

    assert.equal(
      engine.canSeeByFacts(sightFacts(), abilityOf({ enabled: false })),
      false,
    );
  });

  it('дальше дальности зрения фишки — не видна; ноль дальности — без предела', () => {
    assert.equal(
      engine.canSeeByFacts(
        sightFacts({ distance: 65 }),
        abilityOf({ range: 60 }),
      ),
      false,
    );

    assert.equal(
      engine.canSeeByFacts(
        sightFacts({ distance: 60 }),
        abilityOf({ range: 60 }),
      ),
      true,
    );

    assert.equal(
      engine.canSeeByFacts(sightFacts({ distance: 500 }), abilityOf()),
      true,
    );
  });

  it('в темноте видно только на дальность тёмного зрения', () => {
    const dark = sightFacts({ seenLight: 'dark', targetLight: 'dark' });

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
      engine.canSeeByFacts(sightFacts({ seenLight: 'dim' }), abilityOf()),
      true,
    );
  });

  it('цель освещена только с невидимой стороны — видимая часть в темноте', () => {
    assert.equal(
      engine.canSeeByFacts(
        sightFacts({ targetLight: 'bright', seenLight: 'dark' }),
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
      getSightBetween: () => sightFacts(),
      listTokenIds: () => [],
    });

    assert.equal(sight.canSee(viewer, target), undefined);
  });

  it('видит цель на свету и не видит за стеной', () => {
    assert.equal(
      engine.createSceneSight(sourceOf(sightFacts())).canSee(viewer, target),
      true,
    );

    assert.equal(
      engine
        .createSceneSight(sourceOf(sightFacts({ lineOfSight: false })))
        .canSee(viewer, target),
      false,
    );
  });

  it('невидимую цель не видит никто, как бы светло ни было', () => {
    const hidden = creatureWith('creature_hidden', {}, [
      createEffect('Невидимость', { flags: ['vision.invisible'] }),
    ]);

    assert.equal(
      engine.createSceneSight(sourceOf(sightFacts())).canSee(viewer, hidden),
      false,
    );
  });

  it('копий существа несколько — берётся лучшая пара', () => {
    const sight = engine.createSceneSight({
      getSightBetween: (viewerTokenId) =>
        sightFacts({ lineOfSight: viewerTokenId === 'near' }),
      listTokenIds: (entity) =>
        entity.id === viewer.id ? ['far', 'near'] : ['token_target'],
    });

    assert.equal(sight.canSee(viewer, target), true);
  });

  it('освещённость существа — свет его места', () => {
    assert.equal(
      engine
        .createSceneSight(sourceOf(sightFacts({ viewerLight: 'dim' })))
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

        return sightFacts();
      },
    });

    assert.deepEqual(source.listTokenIds(hero), ['token_actor_hero']);

    source.getSightBetween('token_actor_hero', 'token_creature_wolf');

    assert.deepEqual(asked, [['token_actor_hero', 'token_creature_wolf']]);
  });

  it('сущности нет на сцене — фишек нет', () => {
    const source = engine.createContextSightSource({
      getSceneSurroundings: () => null,
      getSightBetween: () => sightFacts(),
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

describe('свет сцены там, где другой стороны нет: зона, отдых, включение', () => {
  /** Отметка, которую ставит срабатывание «только в темноте» */
  const DARK_TAG = 'inDark';

  /**
   * Эффект, который на событии ставит отметку, только если носитель в темноте.
   *
   * @param {string} event - событие срабатывания
   * @param {object} overrides - остальные поля эффекта
   * @returns {object} эффект
   */
  function darkOnlyEffect(event, overrides = {}) {
    return createEffect(`Тень (${event})`, {
      triggers: [
        {
          id: `trigger_${event}`,
          event,
          condition: 'self.light === "dark"',
          actions: [{ type: 'applyTag', tag: DARK_TAG }],
        },
      ],
      ...overrides,
    });
  }

  /**
   * Стоит ли на сущности отметка «в темноте».
   *
   * @param {object} entity - сущность или её изменённые поля
   * @returns {boolean} сработало ли
   */
  function isMarked(entity) {
    return (entity.activeEffects ?? []).some(
      (effect) => effect.tag === DARK_TAG,
    );
  }

  /**
   * Свет сцены с одной освещённостью на всех.
   *
   * @param {string} light - освещённость
   * @returns {object} видимость и свет
   */
  function lightOf(light) {
    return { canSee: () => undefined, lightOf: () => light };
  }

  it('вход в зону: условие «в темноте» читает свет сцены у ядра', () => {
    const system = new engine.Dnd5eVttSystem();

    /**
     * Входит в зону и отвечает, сработал ли её эффект.
     *
     * @param {string | undefined} light - освещённость; нет — старое ядро
     * @returns {boolean} сработало ли
     */
    const enterZone = (light) => {
      const wolf = createCreature({ id: 'creature_wolf' });
      const zone = createZone('zone_shade', [darkOnlyEffect('enter')]);

      system.syncAreaEffects(wolf, new Set(), new Set([zone.id]), [zone], {
        getSceneSurroundings: () => ({
          token: createToken(wolf.id, 0, 0),
          gridSettings: GRID,
          neighbors: [],
        }),
        ...(light
          ? { getSightBetween: () => sightFacts({ viewerLight: light }) }
          : {}),
      });

      return isMarked(wolf);
    };

    assert.equal(enterZone('dark'), true);
    assert.equal(enterZone('bright'), false);
    assert.equal(enterZone(undefined), false, 'без фактов условие молчит');
  });

  it('отдых: условие «в темноте» читает свет сцены у клиента', () => {
    /**
     * Отдыхает и отвечает, сработал ли эффект.
     *
     * @param {object | undefined} sight - свет сцены; нет — сцена не открыта
     * @returns {boolean} сработало ли
     */
    const rest = (sight) => {
      const hero = createActor({ activeEffects: [darkOnlyEffect('rest')] });

      return isMarked(
        engine.applyActorRest(hero, 'long', {
          triggerAnswers: new Map(),
          ...(sight ? { sight } : {}),
        }),
      );
    };

    assert.equal(rest(lightOf('dark')), true);
    assert.equal(rest(lightOf('dim')), false);
    assert.equal(rest(undefined), false, 'без фактов условие молчит');
  });

  it('включение эффекта: условие «в темноте» читает свет сцены у клиента', () => {
    /**
     * Включает эффект и отвечает, сработало ли его «при включении».
     *
     * @param {object | undefined} sight - свет сцены; нет — сцена не открыта
     * @returns {boolean} сработало ли
     */
    const activate = (sight) => {
      const cloak = darkOnlyEffect('activate', {
        disabled: true,
        activation: { cost: 'bonus' },
      });

      const hero = createActor({ activeEffects: [cloak] });

      return isMarked(
        engine.activateEffectOnEntity(
          hero,
          cloak.id,
          undefined,
          undefined,
          sight ? { sight } : {},
        ),
      );
    };

    assert.equal(activate(lightOf('dark')), true);
    assert.equal(activate(lightOf('bright')), false);
    assert.equal(activate(undefined), false, 'без фактов условие молчит');
  });
});
