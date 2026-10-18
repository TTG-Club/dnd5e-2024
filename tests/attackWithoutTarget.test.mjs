import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Атака без выбранной цели: бросок попадания уходит в чат вместе с уроном,
 * а попал ли удар, решает мастер. Кость сама решает только крит (урон
 * удваивается) и критический промах (урона нет).
 */

/**
 * Бросок к20 с заданной натуральной костью.
 *
 * @param natural - что выпало на к20
 * @param modifier - модификатор атаки
 * @returns данные броска в форме роллера
 */
function rollD20(natural, modifier) {
  return {
    total: natural + modifier,
    dice: [{ sides: 20, values: [natural], dropped: [] }],
  };
}

describe('resolveAttackRoll без цели', () => {
  it('обычный бросок: урон катится, исход неизвестен', () => {
    const result = engine.resolveAttackRoll({
      total: 12,
      attackModifier: 5,
      naturalRoll: 7,
      targetAc: null,
    });

    assert.equal(result.isHit, true);
    assert.equal(result.isHitUnknown, true);
    assert.equal(engine.isKnownAttackHit(result), false);
    assert.equal(engine.resolveAttackLanded(result), undefined);
  });

  it('натуральная 20 — крит и известное попадание', () => {
    const result = engine.resolveAttackRoll({
      total: 25,
      attackModifier: 5,
      naturalRoll: 20,
      targetAc: null,
    });

    assert.equal(result.isCriticalHit, true);
    assert.equal(result.isHitUnknown, false);
    assert.equal(engine.resolveAttackLanded(result), true);
  });

  it('натуральная 1 — промах без урона', () => {
    const result = engine.resolveAttackRoll({
      total: 6,
      attackModifier: 5,
      naturalRoll: 1,
      targetAc: null,
    });

    assert.equal(result.isHit, false);
    assert.equal(result.isHitUnknown, false);
    assert.equal(engine.resolveAttackLanded(result), false);
  });

  it('с целью исход известен, как и раньше', () => {
    const result = engine.resolveAttackRoll({
      total: 12,
      attackModifier: 5,
      naturalRoll: 7,
      targetAc: 15,
    });

    assert.equal(result.isHit, false);
    assert.equal(result.isHitUnknown, false);
  });
});

describe('performTwoStageAttack без цели', () => {
  it('бросает попадание и урон, карточка без цели и без плашки', () => {
    const rolls = [rollD20(9, 4), { total: 6, dice: [] }];
    const formulas = [];

    const output = engine.performTwoStageAttack(
      {
        attackFormula: '1к20+4',
        attackModifier: 4,
        targetAc: null,
        weaponName: 'Длинный меч',
        damageFormula: '1к8+2',
      },
      (formula) => {
        formulas.push(formula);

        return rolls.shift();
      },
    );

    assert.deepEqual(formulas, ['1к20+4', '1к8+2']);
    assert.equal(output.damageRoll?.total, 6);
    assert.equal(output.attackRoll.block.target, undefined);
    assert.equal(output.attackRoll.block.badge, undefined);
    assert.equal(output.attackRoll.label, 'Атака — Длинный меч');
  });

  it('на крите удваивает кости урона', () => {
    const formulas = [];

    engine.performTwoStageAttack(
      {
        attackFormula: '1к20+4',
        attackModifier: 4,
        targetAc: null,
        weaponName: 'Длинный меч',
        damageFormula: '1к8+2',
      },
      (formula) => {
        formulas.push(formula);

        return formulas.length === 1 ? rollD20(20, 4) : { total: 9, dice: [] };
      },
    );

    assert.equal(formulas[1], engine.doubleDiceInFormula('1к8+2'));
  });
});
