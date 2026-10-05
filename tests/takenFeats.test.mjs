import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Черта, которую кладёт мастер (уровня, вида), проходит тот же обязательный шаг
 * выборов, что и черта, перетащенная на лист. Мастер уровня клал её без
 * ответов: «Телекинетик» ложился без прибавки и характеристики, а умение такой
 * черты у заклинателя молча брало Сл заклинаний вместо «8 + БМ + выбранная
 * характеристика».
 */

const engine = await loadEngineBundle(
  "export * from './src/engine/takenFeats.ts'; export * from './src/engine/featGrants.ts'; export * from './src/engine/featChoices.ts';",
);

/** Лист персонажа четвёртого уровня */
const ACTOR = {
  id: 'hero',
  system: {
    classes: [{ classKey: 'monk', level: 4 }],
    proficiencies: {},
  },
  features: [],
};

/** «Телекинетик»: +1 к Интеллекту, Мудрости или Харизме на выбор */
const TELEKINETIC = {
  id: 'telekinetic',
  name: 'Телекинетик',
  featData: {
    type: 'feat',
    abilityScoreIncrease: {
      choice: {
        amount: 1,
        count: 1,
        from: ['intelligence', 'wisdom', 'charisma'],
      },
    },
  },
};

/** Черта без вопросов */
const TOUGH = {
  id: 'tough',
  name: 'Крепкий',
  featData: { type: 'feat' },
};

/** Применение черты на лист (пере-применение взятой черты — другой вызов) */
const APPLY_CALL_PATTERN = /\bapplyFeatToActor\(/u;

/** Само применение: его зовут, а не собирают */
const APPLY_FILE = 'src/client/ui/actor/feat/featApply.ts';

/** Чем путь выдачи черты спрашивает её выборы */
const CHOICE_GATES = ['withTakenFeatAnswers(', 'resolveFeatChoicesToAsk('];

describe('вопросы взятой мастером черты', () => {
  it('те же, что у окна выбора при перетаскивании на лист', () => {
    const taken = engine.buildTakenFeat('asi::telekinetic', TELEKINETIC, ACTOR);

    assert.deepEqual(
      taken.ownChoices.map((choice) => choice.key),
      engine
        .resolveFeatChoicesToAsk(TELEKINETIC.featData, ACTOR)
        .map((choice) => choice.key),
    );

    assert.equal(taken.ownChoices.length, 1);
    assert.equal(taken.ownChoices[0].type, 'ability');
  });

  it('без ответа черту класть нельзя, с ответом — можно', () => {
    const taken = engine.buildTakenFeat('asi::telekinetic', TELEKINETIC, ACTOR);
    const [choice] = taken.ownChoices;

    assert.equal(engine.isTakenFeatAnswered(taken, {}, ACTOR, {}, 2), false);

    assert.equal(
      engine.isTakenFeatAnswered(
        taken,
        // Ответ другой черты под тем же ключом выбора — не её ответ
        { 'pick:style::telekinetic': { [choice.key]: ['wisdom'] } },
        ACTOR,
        {},
        2,
      ),
      false,
    );

    assert.equal(
      engine.isTakenFeatAnswered(
        taken,
        { 'asi::telekinetic': { [choice.key]: ['wisdom'] } },
        ACTOR,
        {},
        2,
      ),
      true,
    );
  });

  it('ответы ложатся на запись черты, которую принимает применение', () => {
    const taken = engine.buildTakenFeat('asi::telekinetic', TELEKINETIC, ACTOR);
    const [choice] = taken.ownChoices;

    const feat = engine.withTakenFeatAnswers(taken, {
      'asi::telekinetic': { [choice.key]: ['wisdom'] },
    });

    assert.deepEqual(feat.choices, { [choice.key]: ['wisdom'] });
    assert.equal(feat.name, 'Телекинетик');

    // Выбранная характеристика доходит до даров черты
    assert.deepEqual(
      engine.resolveChosenAbilities(feat.featData, feat.choices),
      ['wisdom'],
    );
  });

  it('черта без вопросов готова сразу и остаётся как есть', () => {
    const taken = engine.buildTakenFeat('asi::tough', TOUGH, ACTOR);

    assert.deepEqual(taken.ownChoices, []);
    assert.equal(engine.isTakenFeatAnswered(taken, {}, ACTOR, {}, 2), true);
    assert.equal(engine.withTakenFeatAnswers(taken, {}), TOUGH);
  });
});

it('каждый путь выдачи черты на лист спрашивает её выборы', () => {
  const unasked = listClientSources()
    .filter((path) => toSystemPath(path) !== APPLY_FILE)
    .filter((path) => {
      const text = readFileSync(path, 'utf8');

      return (
        APPLY_CALL_PATTERN.test(text)
        && !CHOICE_GATES.some((gate) => text.includes(gate))
      );
    })
    .map(toSystemPath);

  assert.deepEqual(unasked, []);
});
