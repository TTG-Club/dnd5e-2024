import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  change,
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Телосложение сверх листа в максимуме хитов: прибавки предыстории и
 * повышения характеристик лежат эффектами, а запас листа считается по числу
 * листа.
 */

/**
 * Маг пятого уровня: кость к6, максимум на первом, дальше среднее.
 *
 * @param {object[]} activeEffects - эффекты персонажа
 * @returns {object} персонаж
 */
function wizardAtFifthLevel(activeEffects = []) {
  const hero = createActor({ activeEffects });
  const rolls = [6, 4, 4, 4, 4];

  hero.system.abilities = { ...hero.system.abilities, constitution: 12 };

  hero.system.classes = [
    {
      classKey: 'wizard',
      className: 'Волшебник',
      level: 5,
      subclassKey: null,
      hitDie: 6,
      hitDiceUsed: 0,
      hitPointsGained: rolls.map((rolled, index) => ({
        level: index + 1,
        method: 'average',
        rolled,
      })),
      chosenSkills: [],
      featureChoices: {},
    },
  ];

  const sheetMax = engine.calculateMaxHP(hero.system.classes, 1);

  hero.system.hitPoints = {
    ...hero.system.hitPoints,
    current: sheetMax,
    max: sheetMax,
  };

  return hero;
}

describe('телосложение из эффектов в максимуме хитов', () => {
  it('без эффектов потолок равен записи листа', () => {
    const hero = wizardAtFifthLevel();

    assert.equal(engine.resolveEntityMaxHp(hero), 22 + 5);
  });

  it('+2 предыстории поднимает модификатор — +1 за каждый уровень', () => {
    const hero = wizardAtFifthLevel([
      createEffect('background', {
        changes: [change('ability.constitution', '2')],
      }),
    ]);

    assert.equal(engine.resolveEntityMaxHp(hero), 22 + 5 + 5);
  });

  it('прибавка без смены модификатора хитов не даёт', () => {
    const hero = wizardAtFifthLevel([
      createEffect('asi', { changes: [change('ability.constitution', '1')] }),
    ]);

    assert.equal(engine.resolveEntityMaxHp(hero), 22 + 5);
  });

  it('разбор называет каждый источник числом и сходится с потолком', () => {
    const hero = wizardAtFifthLevel([
      createEffect('background', {
        changes: [change('ability.constitution', '2')],
      }),
      createEffect('toughness', {
        name: 'Дварфская стойкость',
        changes: [change('hitPoints.max', '1 * @level')],
      }),
      createEffect('conditional', {
        changes: [
          change('hitPoints.max', '10', { condition: 'target.hp.full' }),
        ],
      }),
    ]);

    const sources = engine.resolveMaxHitPointsBreakdown(hero);

    assert.deepEqual(sources, [
      { kind: 'effect', name: 'Дварфская стойкость', delta: 5 },
      { kind: 'constitution', delta: 5 },
    ]);

    assert.equal(
      sources.reduce((total, source) => total + source.delta, 0),
      engine.resolveEntityMaxHp(hero) - engine.resolveBaseMaxHp(hero),
    );
  });

  it('существо по Телосложению из эффекта хитов не набирает', () => {
    const creature = createCreature({
      activeEffects: [
        createEffect('buff', {
          changes: [change('ability.constitution', '4')],
        }),
      ],
    });

    assert.equal(
      engine.resolveEntityMaxHp(creature),
      engine.resolveBaseMaxHp(creature),
    );
  });
});

describe('ручное изменение базового Телосложения', () => {
  it('обновляет запас листа и не теряет прибавку предыстории', () => {
    const hero = createActor({
      activeEffects: [
        createEffect('background', {
          changes: [change('ability.constitution', '2')],
        }),
      ],
    });

    hero.system.classes = [
      {
        classKey: 'fighter',
        className: 'Воин',
        level: 1,
        subclassKey: null,
        hitDie: 8,
        hitDiceUsed: 0,
        hitPointsGained: [{ level: 1, method: 'max', rolled: 8 }],
        chosenSkills: [],
        featureChoices: {},
      },
    ];

    hero.system.hitPoints = { current: 8, max: 8, temp: 0 };

    hero.system.hitPoints = engine.resolveHitPointsAfterBaseConstitutionChange(
      hero,
      14,
    );

    hero.system.abilities = { ...hero.system.abilities, constitution: 14 };

    assert.deepEqual(hero.system.hitPoints, { current: 10, max: 10, temp: 0 });
    assert.equal(engine.resolveActorStats(hero).abilityMods.constitution, 3);
    assert.equal(engine.resolveEntityMaxHp(hero), 11);
  });

  it('умножает снижение на уровень и сохраняет ручной максимум', () => {
    const hero = wizardAtFifthLevel();

    hero.system.hitPoints = { current: 25, max: 40, temp: 4 };

    assert.deepEqual(
      engine.resolveHitPointsAfterBaseConstitutionChange(hero, 8),
      { current: 15, max: 30, temp: 4 },
    );
  });

  it('на 0 хитов рост Телосложения поднимает максимум, но не будит', () => {
    const hero = wizardAtFifthLevel();

    hero.system.hitPoints = { current: 0, max: 30, temp: 0 };

    assert.deepEqual(
      engine.resolveHitPointsAfterBaseConstitutionChange(hero, 14),
      { current: 0, max: 35, temp: 0 },
    );
  });

  it('не меняет хиты, если модификатор остался прежним', () => {
    const hero = wizardAtFifthLevel();

    hero.system.hitPoints = { current: 20, max: 30, temp: 2 };

    assert.deepEqual(
      engine.resolveHitPointsAfterBaseConstitutionChange(hero, 13),
      hero.system.hitPoints,
    );
  });
});
