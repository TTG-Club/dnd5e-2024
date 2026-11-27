import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Урон заговора растёт с уровнем персонажа ступенями (`cantripScalingTiers`).
 * Каст катил кости ступени, а плитка строки листа показывала базовые: у
 * «Чародейской вспышки» 5-го уровня — «1к8» при броске 2к8. Каст и показ
 * теперь берут части урона одной функцией движка.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
`);

/** Заговор со ступенями роста урона, как «Чародейская вспышка» */
const BURST = {
  name: 'Чародейская вспышка',
  level: 0,
  school: 'evocation',
  damageParts: [{ formula: '1d8', target: 'selected' }],
  cantripScalingTiers: [
    { level: 11, parts: [{ formula: '3d8', target: 'selected' }] },
    { level: 5, parts: [{ formula: '2d8', target: 'selected' }] },
    { level: 17, parts: [{ formula: '4d8', target: 'selected' }] },
  ],
};

/**
 * Формулы частей урона, которые бросает заклинатель уровня `casterLevel`.
 *
 * @param {object} spell - заклинание
 * @param {number} casterLevel - уровень заклинателя
 * @returns {string[]} формулы частей
 */
function effectiveFormulas(spell, casterLevel) {
  return engine
    .getEffectiveSpellDamageParts(spell, casterLevel)
    .map((part) => part.formula);
}

describe('части урона заговора по уровню заклинателя', () => {
  it('ниже первой ступени — базовые кости', () => {
    assert.deepEqual(effectiveFormulas(BURST, 0), ['1d8']);
    assert.deepEqual(effectiveFormulas(BURST, 4), ['1d8']);
  });

  it('с 5-го уровня — кости ступени, а не базовые', () => {
    assert.deepEqual(effectiveFormulas(BURST, 5), ['2d8']);
    assert.deepEqual(effectiveFormulas(BURST, 10), ['2d8']);
  });

  it('берётся старшая доступная ступень, порядок записи не важен', () => {
    assert.deepEqual(effectiveFormulas(BURST, 11), ['3d8']);
    assert.deepEqual(effectiveFormulas(BURST, 20), ['4d8']);
  });

  it('заговор без ступеней — базовые кости', () => {
    const { cantripScalingTiers: _tiers, ...plain } = BURST;

    assert.deepEqual(effectiveFormulas(plain, 20), ['1d8']);
  });

  it('у заклинания круга ступени заговора не действуют', () => {
    assert.deepEqual(effectiveFormulas({ ...BURST, level: 1 }, 20), ['1d8']);
  });
});
