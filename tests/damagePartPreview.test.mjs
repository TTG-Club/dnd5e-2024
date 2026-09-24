import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Итог формулы части урона под полем ввода. Проверяется то, ради чего строка
 * заведена: она говорит словами ровно то, что сделает бросок.
 */

/**
 * Итог одной части урона.
 *
 * @param {string} formula - формула части
 * @param {string} [type] - тип части без токена
 * @returns {object} ветки итога и незнакомые токены
 */
function preview(formula, type) {
  return engine.previewDamagePart({ formula, type, target: 'selected' });
}

describe('итог формулы части урона', () => {
  it('простая формула: кости русской «к», тип из токена', () => {
    const result = preview('1d4@dmg.force+1');

    assert.deepEqual(result.branches, [
      {
        hpGate: undefined,
        typeGate: undefined,
        segments: [
          { formula: '1к4 + 1', types: ['force'], healing: undefined },
        ],
      },
    ]);

    assert.deepEqual(result.unknownTokens, []);
  });

  it('тип части без токена виден в итоге', () => {
    const [branch] = preview('1к6', 'slashing').branches;

    assert.deepEqual(branch.segments[0].types, ['slashing']);
  });

  it('переменные называются словами, а хвост без токена наследует тип', () => {
    const [branch] = preview(
      '1к8@dmg.fire + 1к6@dmg.cold + @mod.spell',
    ).branches;

    assert.deepEqual(
      branch.segments.map(({ formula, types }) => ({ formula, types })),
      [
        { formula: '1к8', types: ['fire'] },
        { formula: '1к6 + мод. закл. характеристики', types: ['cold'] },
      ],
    );
  });

  it('ветки по хитам цели показываются обе, общее слагаемое — в каждой', () => {
    const { branches } = preview(
      '1к8@dmg.psychic@target.full + 1к12@dmg.psychic@target.notFull + @mod.spell',
    );

    assert.deepEqual(
      branches.map((branch) => [branch.hpGate, branch.segments[0].formula]),
      [
        ['full', '1к8 + мод. закл. характеристики'],
        ['notFull', '1к12 + мод. закл. характеристики'],
      ],
    );
  });

  it('слагаемое против типа существа — отдельная ветка сверху', () => {
    const { branches } = preview('1к8@dmg.radiant + 2к8@target.type.undead');

    assert.deepEqual(
      branches.map((branch) => [branch.typeGate, branch.segments[0].formula]),
      [
        [undefined, '1к8'],
        ['undead', '2к8'],
      ],
    );
  });

  it('ветка против типа, не зависящая от хитов, показана один раз', () => {
    const { branches } = preview(
      '1к8@dmg.psychic@target.full + 1к12@dmg.necrotic@target.notFull'
        + ' + 2к6@dmg.radiant@target.type.undead',
    );

    assert.deepEqual(
      branches.map((branch) => [
        branch.hpGate,
        branch.typeGate,
        branch.segments[0].formula,
      ]),
      [
        ['full', undefined, '1к8'],
        ['notFull', undefined, '1к12'],
        [undefined, 'undead', '2к6'],
      ],
    );
  });

  it('одинаковые ветки по хитам сливаются в одну без условия', () => {
    const { branches } = preview(
      '1к8@target.full + 1к8@target.notFull',
      'fire',
    );

    assert.deepEqual(
      branches.map((branch) => [branch.hpGate, branch.segments[0].formula]),
      [[undefined, '1к8']],
    );
  });

  it('лечение и временные хиты помечены видом лечения', () => {
    const { branches } = preview('2к4@heal + 5@heal.temp');

    assert.deepEqual(
      branches[0].segments.map(({ formula, healing }) => ({
        formula,
        healing,
      })),
      [
        { formula: '2к4', healing: 'hp' },
        { formula: '5', healing: 'temp' },
      ],
    );
  });

  it('знаки между слагаемыми расставлены как в чате', () => {
    const [branch] = preview('2d6-1+@prof').branches;

    assert.equal(branch.segments[0].formula, '2к6 - 1 + бонус мастерства');
  });

  it('опечатки в токенах попадают в незнакомые', () => {
    const result = preview('1к8@dmg.fire + @mod.foo + 1к6@target.type.undaed');

    assert.deepEqual(result.unknownTokens.sort(), [
      '@mod.foo',
      '@target.type.undaed',
    ]);
  });

  it('пустая формула — пустой итог', () => {
    assert.deepEqual(preview('   ').branches, []);
  });
});
