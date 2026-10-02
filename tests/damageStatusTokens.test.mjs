import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/** Сводка развёртки для сравнения: формула, тип и гейты */
function summarize(parts) {
  return parts.map((part) => ({
    formula: part.formula,
    type: part.type,
    ...(part.targetStatusGate
      ? { targetStatusGate: part.targetStatusGate }
      : {}),
    ...(part.selfStatusGate ? { selfStatusGate: part.selfStatusGate } : {}),
  }));
}

/** Развёртка одной формулы без подстановки переменных */
function expand(formula, targetIsFull, options) {
  return summarize(
    engine.expandDamageParts(
      [{ formula }],
      targetIsFull,
      (segment) => segment,
      options,
    ),
  );
}

/**
 * Существо с наложенным состоянием.
 *
 * @param {string} conditionKey - ключ состояния
 * @param {number} hitPoints - текущие хиты из 20
 * @returns {object} существо
 */
function withCondition(conditionKey, hitPoints = 20) {
  const creature = withHp(
    createCreature,
    hitPoints,
    { id: `creature_${conditionKey}` },
    20,
  );

  creature.activeEffects = [
    createEffect(`condition_${conditionKey}`, { conditionKey }),
  ];

  return creature;
}

describe('«Окровавленный» — состояние системы', () => {
  it('есть в справочнике и выбирается руками', () => {
    const entry = engine
      .listSelectableConditions()
      .find((condition) => condition.key === 'bloodied');

    assert.equal(entry?.nameRu, 'Окровавленный');
    assert.equal(entry?.nameEn, 'Bloodied');
  });

  it('урон считает его по хитам и без значка', () => {
    const hurt = withHp(createCreature, 10, { id: 'creature_hurt' }, 20);
    const healthy = withHp(createCreature, 11, { id: 'creature_ok' }, 20);

    assert.equal(engine.entityHasDamageStatus(hurt, 'bloodied'), true);
    assert.equal(engine.entityHasDamageStatus(healthy, 'bloodied'), false);
  });

  it('значок «Окровавленный» считается и при полных хитах', () => {
    assert.equal(
      engine.entityHasDamageStatus(withCondition('bloodied'), 'bloodied'),
      true,
    );
  });

  it('прочие состояния — по наложенному эффекту', () => {
    const prone = withCondition('prone');

    assert.equal(engine.entityHasDamageStatus(prone, 'prone'), true);
    assert.equal(engine.entityHasDamageStatus(prone, 'grappled'), false);
  });

  it('сущность без максимума хитов окровавленной не считается', () => {
    assert.equal(
      engine.isEntityBloodied(
        withHp(createCreature, 0, { id: 'creature_empty' }, 0),
      ),
      false,
    );
  });
});

describe('состояния в формуле урона', () => {
  it('слово-условие гасит своё слагаемое, если состояния нет', () => {
    const formula = '1к8 + 2к6@target.status.prone';

    assert.equal(
      engine.applyStatusConditionals(formula, 'target', () => false),
      '1к8',
    );

    assert.equal(
      engine.applyStatusConditionals(formula, 'target', () => true),
      '1к8 + 2к6',
    );
  });

  it('состояние бросающего проверяется до броска', () => {
    const formula = '1к8@dmg.piercing + 1к6@dmg.necrotic@self.status.bloodied';

    assert.deepEqual(
      expand(formula, true, {
        selfHasStatus: (status) => status === 'bloodied',
      }),
      [
        { formula: '1к8', type: 'piercing' },
        { formula: '1к6', type: 'necrotic' },
      ],
    );

    assert.deepEqual(expand(formula, true), [
      { formula: '1к8', type: 'piercing' },
    ]);
  });

  it('состояние существа берётся с его листа', () => {
    const parts = [
      { formula: '1к8@dmg.piercing + 1к6@dmg.necrotic@self.status.bloodied' },
    ];

    const bite = (hitPoints) =>
      engine
        .resolveCreatureDamageParts(
          parts,
          undefined,
          withHp(createCreature, hitPoints, { id: 'creature_bite' }, 20),
        )
        .map((part) => part.formula);

    assert.deepEqual(bite(20), ['1к8']);
    assert.deepEqual(bite(10), ['1к8', '1к6']);
  });

  it('состояние цели — ветка с гейтом, сверху основы', () => {
    assert.deepEqual(
      expand('1к8@dmg.piercing + 2к6@dmg.necrotic@target.status.prone', true),
      [
        { formula: '1к8', type: 'piercing' },
        { formula: '2к6', type: 'necrotic', targetStatusGate: 'prone' },
      ],
    );
  });

  it('гейт состояния сверяется с целью при нанесении урона', () => {
    const gate = { targetStatusGate: 'prone' };

    assert.equal(
      engine.damageReachesTarget(gate, withCondition('prone')),
      true,
    );

    assert.equal(
      engine.damageReachesTarget(gate, withCondition('grappled')),
      false,
    );
  });

  it('старые ветки «полные / не полные» не изменились', () => {
    assert.deepEqual(
      engine
        .expandDamageParts(
          [{ formula: '1к8@target.full + 1к12@target.notFull' }],
          undefined,
          (segment) => segment,
        )
        .map((part) => [part.targetGate, part.formula]),
      [
        ['full', '1к8'],
        ['notFull', '1к12'],
      ],
    );
  });

  it('бонус-урон знает состояния бросающего и цели', () => {
    const parts = engine.resolveBonusDamageParts(
      [{ formula: '1к6@self.status.bloodied + 1к4@target.status.prone' }],
      'fire',
      true,
      (segment) => segment,
      undefined,
      (status) => status === 'bloodied',
    );

    assert.deepEqual(summarize(parts), [
      { formula: '1к6', type: 'fire' },
      { formula: '1к4', type: 'fire', targetStatusGate: 'prone' },
    ]);
  });
});

describe('состояния в показе формулы', () => {
  it('слагаемое по состоянию подписано, чьё оно и какое', () => {
    assert.equal(
      engine.describeDamagePart({
        formula: '1к8@dmg.piercing + 2к6@dmg.necrotic@target.status.prone',
      }).formula,
      '1к8 + 2к6 (цель: Лежащий ничком)',
    );
  });

  it('добавка по состоянию отделена от урона, который бросается всегда', () => {
    const info = engine.describeDamagePart({
      formula: '1к8+3@dmg.slashing + 1к8@dmg.slashing@self.status.bloodied',
    });

    // Плитке строки листа — только постоянная часть, добавка уходит в подсказку
    assert.equal(info.baseFormula, '1к8 + 3');

    assert.deepEqual(info.conditionalFormulas, [
      '1к8 (атакующий: Окровавленный)',
    ]);

    assert.equal(info.formula, '1к8 + 3 + 1к8 (атакующий: Окровавленный)');
  });

  it('часть целиком под условием постоянной части не имеет', () => {
    const info = engine.describeDamagePart({
      formula: '1к8@dmg.slashing@self.status.bloodied',
    });

    assert.equal(info.baseFormula, '');

    assert.deepEqual(info.conditionalFormulas, [
      '1к8 (атакующий: Окровавленный)',
    ]);
  });

  it('плитка урона оружия: добавка по состоянию — отдельно, без служебного токена', () => {
    const display = engine.describeWeaponDamageDisplay({
      itemType: 'weapon',
      damageParts: [
        {
          formula: '1d8@dmg.slashing + 1d8@dmg.slashing@self.status.bloodied',
          target: 'selected',
        },
      ],
    });

    assert.equal(display.baseFormula, '1к8');

    assert.deepEqual(display.conditionalFormulas, [
      '1к8 (атакующий: Окровавленный)',
    ]);
  });

  it('плитка урона оружия: добавки по типу цели — отдельно, с названием типа', () => {
    const display = engine.describeWeaponDamageDisplay({
      itemType: 'weapon',
      damageParts: [
        {
          formula:
            '1d6@dmg.slashing + 2d6@dmg.radiant@target.type.fiend'
            + ' + 2d6@dmg.radiant@target.type.undead',
          target: 'selected',
        },
      ],
    });

    assert.equal(display.baseFormula, '1к6');

    assert.deepEqual(display.conditionalFormulas, [
      '2к6 (цель: Исчадие)',
      '2к6 (цель: Нежить)',
    ]);
  });

  it('набор целиком под условием остаётся в плитке полным текстом', () => {
    const display = engine.combineDamagePartDisplays([
      { baseFormula: '', conditionalFormulas: ['1к8 (цель: Лежащий ничком)'] },
    ]);

    assert.equal(display.baseFormula, '1к8 (цель: Лежащий ничком)');
    assert.deepEqual(display.conditionalFormulas, []);
  });

  it('итог под формулой выносит состояние атакующего отдельной веткой', () => {
    const preview = engine.previewDamagePart({
      formula: '1к8@dmg.piercing + 1к6@dmg.necrotic@self.status.bloodied',
    });

    assert.deepEqual(
      preview.branches.map((branch) => [
        branch.selfStatusGate,
        branch.segments.map((segment) => segment.formula),
      ]),
      [
        [undefined, ['1к8']],
        ['bloodied', ['1к8', '1к6']],
      ],
    );

    assert.deepEqual(preview.unknownTokens, []);
  });

  it('итог варианта «или» считает его состояния выполненными', () => {
    const preview = engine.previewDamagePart(
      { formula: '2к8@dmg.necrotic@self.status.bloodied + 2' },
      { assumeStatuses: true },
    );

    assert.deepEqual(
      preview.branches.map((branch) => [
        branch.selfStatusGate,
        branch.segments.map((segment) => [segment.formula, segment.types]),
      ]),
      [[undefined, [['2к8 + 2', ['necrotic']]]]],
    );
  });

  it('токен вне формулы урона не роняет разбор', () => {
    const context = engine.buildFormulaContext(
      withHp(createCreature, 5, { id: 'creature_parser' }, 11),
    );

    assert.equal(engine.evaluateFormula('@self.status.bloodied', context), 0);
    assert.equal(engine.evaluateFormula('@target.status.prone', context), 0);
  });
});
