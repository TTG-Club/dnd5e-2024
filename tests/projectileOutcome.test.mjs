import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Строки снарядов в сводке заклинания: каждая — под своей целью, с уроном
 * этого снаряда. Одна строка «(1к4+1)×3: -10 HP» не говорила, сколько нанёс
 * каждый снаряд.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
`);

describe('строка снаряда под целью', () => {
  it('попадание: номер и выпавший урон', () => {
    assert.equal(
      engine.formatProjectileOutcomeLine({ number: 2, damage: 5 }),
      '   • Снаряд 2: 5',
    );
  });

  it('крит помечается', () => {
    assert.equal(
      engine.formatProjectileOutcomeLine({
        number: 3,
        damage: 12,
        critical: true,
      }),
      '   • Снаряд 3: 12 (крит)',
    );
  });

  it('формула снаряда стоит перед итогом, кости по-русски', () => {
    assert.equal(
      engine.formatProjectileOutcomeLine({
        number: 1,
        damage: 4,
        formula: '1d4+1',
      }),
      '   • Снаряд 1: 1к4 + 1 = 4',
    );
  });

  it('у крита — формула с удвоенными костями', () => {
    assert.equal(
      engine.formatProjectileOutcomeLine({
        number: 2,
        damage: 13,
        formula: '2d10',
        critical: true,
      }),
      '   • Снаряд 2: 2к10 = 13 (крит)',
    );
  });

  it('промах пишется словом, а не нулём', () => {
    assert.equal(
      engine.formatProjectileOutcomeLine({ number: 4, damage: null }),
      '   • Снаряд 4: промах',
    );
  });
});
