import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Линия со своей дистанцией ставится на карте, а не от заклинателя.
 *
 * «Стена огня» (дистанция 120 футов, линия 60 футов) начиналась от фишки
 * заклинателя, как «Молния»: сцена привязывает к ней любой конус и луч.
 * Отличает их дистанция — у «Молнии» она «на себя».
 */

const engine = await loadEngineBundle(`
  export { isSpellAreaPlacedAtRange } from './src/engine/attackUtils.ts';
`);

/** Линия 60 футов */
const WALL_AREA = { shape: 'ray', size: 60, width: 1, unit: 'ft' };

describe('область заклинания: от заклинателя или в пределах дистанции', () => {
  it('линия со своей дистанцией ставится на карте', () => {
    assert.equal(
      engine.isSpellAreaPlacedAtRange({
        areaOfEffect: WALL_AREA,
        deliveryType: 'none',
        range: 120,
      }),
      true,
    );
  });

  it('линия с дистанцией «на себя» исходит от заклинателя', () => {
    assert.equal(
      engine.isSpellAreaPlacedAtRange({
        areaOfEffect: { ...WALL_AREA, size: 100 },
        deliveryType: 'none',
        range: 0,
      }),
      false,
    );
  });

  it('линия касанием исходит от заклинателя', () => {
    assert.equal(
      engine.isSpellAreaPlacedAtRange({
        areaOfEffect: WALL_AREA,
        deliveryType: 'touch',
        range: 5,
      }),
      false,
    );
  });

  it('круг не затронут: его и так ставят в точку', () => {
    assert.equal(
      engine.isSpellAreaPlacedAtRange({
        areaOfEffect: { shape: 'circle', size: 20, unit: 'ft' },
        deliveryType: 'none',
        range: 150,
      }),
      false,
    );
  });

  it('заклинание без области не затронуто', () => {
    assert.equal(
      engine.isSpellAreaPlacedAtRange({ deliveryType: 'ranged', range: 120 }),
      false,
    );
  });
});
