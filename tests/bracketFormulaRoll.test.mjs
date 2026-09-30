import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Выражение в скобках перед видом части: `(5)@heal`, `(@classLevel)@heal.temp`
 * Дикой формы, `(5 * (@castLevel - 1))@heal`. Разбор вида снимает токен и
 * оставляет скобку, а бросок движка читал только числа и кости через `+`/`−`:
 * `(5)` давало ноль, `(5 * (2 - 1))` — минус единицу, и урон или лечение
 * срабатывания молча пропадали.
 */

/** Случай, при котором любая кость выпадает единицей */
const MIN_ROLL = 0;

/**
 * Срабатывание «при наложении» с одной частью урона.
 *
 * @param {string} formula - формула части
 * @returns {object} срабатывание
 */
function appliedTrigger(formula) {
  return {
    id: 'applied',
    event: 'applied',
    actions: [{ type: 'damage', parts: [{ target: 'selected', formula }] }],
  };
}

/**
 * Лечение срабатывания «при наложении».
 *
 * @param {string} formula - формула части
 * @returns {object | null} исход лечения
 */
function healOf(formula) {
  const trigger = appliedTrigger(formula);

  return engine.rollTriggerHealing(
    createEffect('Эффект', { triggers: [trigger] }),
    trigger,
  );
}

/**
 * Урон срабатывания «при наложении» по волку.
 *
 * @param {string} formula - формула части
 * @returns {object | null} исход урона
 */
function damageOf(formula) {
  const wolf = withHp(createCreature, 30);
  const trigger = appliedTrigger(formula);

  return engine.rollTriggerDamage(
    wolf,
    createEffect('Эффект', { triggers: [trigger] }),
    trigger,
    false,
    engine.resolveActorStats(wolf),
  );
}

/**
 * Контекст источника с кругом ячейки и уровнем класса.
 *
 * @param {object} extra - поля контекста поверх листа
 * @returns {object} контекст формул
 */
function sourceContext(extra = {}) {
  return { ...engine.buildFormulaContext(createActor()), ...extra };
}

/**
 * Формула части после подстановки чисел источника.
 *
 * @param {string} formula - формула с токенами источника
 * @param {object} extra - поля контекста поверх листа
 * @returns {string} формула с числами
 */
function bound(formula, extra = {}) {
  const effect = engine.bindSourceEffectFormulas(
    createEffect('Эффект', { triggers: [appliedTrigger(formula)] }),
    sourceContext(extra),
  );

  return effect.triggers[0].actions[0].parts[0].formula;
}

describe('бросок движка: арифметика в слагаемом', () => {
  it('скобка, вложенные скобки и функция считаются числом', () => {
    assert.equal(engine.rollDamageFormula('(5)').total, 5);
    assert.equal(engine.rollDamageFormula('(5 * (2 - 1))').total, 5);
    assert.equal(engine.rollDamageFormula('floor(5 / 2)').total, 2);
    assert.equal(engine.rollDamageFormula('(7 / 2)').total, 3, 'дробь — вниз');
    assert.equal(engine.rollDamageFormula('2 * 3 + 1').total, 7);
  });

  it('отрицательное число в скобках вычитается', () => {
    const rolled = withRandom([MIN_ROLL], () =>
      engine.rollDamageFormula('1к6 + (-2)'),
    );

    assert.equal(rolled.total, -1);
    assert.equal(rolled.details, '[1] - 2');
  });

  it('скобка с костями раскрывается, знак перед ней переходит на слагаемые', () => {
    const rolled = withRandom([MIN_ROLL, MIN_ROLL], () =>
      engine.rollDamageFormula('10 - (1к4 + 1) + (1к6 + 3)'),
    );

    assert.equal(rolled.total, 10 - (1 + 1) + (1 + 3));
    assert.equal(rolled.dice.length, 2);
  });

  it('первая кость формулы видна и внутри скобки', () => {
    assert.deepEqual(engine.findFirstDiceTerm('(2к8 + 3)'), {
      count: 2,
      sides: 8,
    });
  });
});

describe('чат: формула броска — числами, без токенов', () => {
  it('арифметика показывается числом, скобка с костями раскрыта', () => {
    assert.equal(engine.formatDiceFormula('1к6 + (5 * (2 - 1))'), '1к6 + 5');
    assert.equal(engine.formatDiceFormula('(1d8 + 3)'), '1к8 + 3');
    assert.equal(engine.formatDiceFormula('1к6 + (-2)'), '1к6 - 2');
  });

  it('кубики лечения срабатывания в чате: формула и итог', () => {
    const healing = withRandom([MIN_ROLL], () =>
      healOf('(1к4 + (2 * 3))@heal'),
    );

    assert.equal(healing.healed, 7);

    const [roll] = engine.buildEffectDiceRolls('Волк', [], [healing]);

    assert.equal(roll.formula, '1к4 + 6');
    assert.equal(roll.total, 7);
    assert.ok(!roll.label.includes('@'), roll.label);
  });
});

describe('срабатывание: выражение в скобках перед видом', () => {
  it('без скобок и в скобках — одно и то же', () => {
    assert.equal(healOf('5@heal').healed, 5);
    assert.equal(healOf('(5)@heal').healed, 5);
    assert.equal(damageOf('2@dmg.fire').total, 2);
    assert.equal(damageOf('(2)@dmg.fire').total, 2);
    assert.deepEqual(damageOf('(2)@dmg.fire').types, ['fire']);
  });

  it('круг ячейки: (5 * (@castLevel - 1))@heal', () => {
    const formula = bound('(5 * (@castLevel - 1))@heal', { castLevel: 2 });

    assert.equal(formula, '(5 * (2 - 1))@heal');
    assert.equal(healOf(formula).healed, 5);

    assert.equal(
      healOf(bound('(5 * (@castLevel - 1))@heal', { castLevel: 4 })).healed,
      15,
    );
  });

  it('числа источника: (@prof)@heal, (2 * @classLevel)@heal, (@classLevel)@heal.temp', () => {
    const context = sourceContext({ classLevel: 3 });
    const prof = engine.evaluateFormula('@prof', context);

    assert.equal(healOf(bound('(@prof)@heal', { classLevel: 3 })).healed, prof);

    assert.equal(
      healOf(bound('(2 * @classLevel)@heal', { classLevel: 3 })).healed,
      6,
    );

    const temp = healOf(bound('(@classLevel)@heal.temp', { classLevel: 3 }));

    assert.equal(temp.tempHp, 3);
    assert.equal(temp.healed, 0);
  });

  it('тип на выбор: (@prof)@dmg.choice(…) бьёт числом источника', () => {
    const prof = engine.evaluateFormula('@prof', sourceContext());
    const damage = damageOf(bound('(@prof)@dmg.choice(fire,cold)'));

    assert.equal(damage.total, prof);
    assert.equal(damage.types.length, 1);
    assert.ok(['fire', 'cold'].includes(damage.types[0]));
  });

  it('floor(…) перед видом', () => {
    assert.equal(healOf('floor(7 / 2)@heal.temp').tempHp, 3);

    assert.equal(
      damageOf('floor(@classLevel / 2)@dmg.cold'),
      null,
      'без подстановки не катается',
    );

    assert.equal(
      damageOf(bound('floor(@classLevel / 2)@dmg.cold', { classLevel: 5 }))
        .total,
      2,
    );
  });

  it('урон каждый ход (recurringDamage) тоже считает скобки', () => {
    const hero = withHp(
      createActor,
      10,
      {
        activeEffects: [
          createEffect('Ожог', {
            recurringDamage: {
              damageParts: [
                { formula: '(3)@dmg.fire' },
                { formula: '(1 + 1)@heal' },
              ],
              timing: 'startOfTurn',
            },
          }),
        ],
      },
      20,
    );

    const result = engine.processTurnEffects(hero, 'startOfTurn');

    assert.equal(result.damageTotal, 3);
    assert.equal(engine.resolveEntityCurrentHp(hero), 10 - 3 + 2);
  });
});
