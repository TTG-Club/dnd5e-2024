import assert from 'node:assert/strict';

import { it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Рост области заклинания от круга ячейки (`spellAreaScaling.ts`,
 * `SpellScaling.additionalAreaSize` ядра).
 */

/** «Туманное облако»: сфера 20 фт, +20 за круг выше 1-го */
const FOG_CLOUD = {
  level: 1,
  areaOfEffect: { shape: 'sphere', size: 20, unit: 'ft' },
  scaling: { additionalAreaSize: 20 },
};

it('размер области растёт за каждый круг выше базового', () => {
  assert.equal(engine.resolveSpellAreaAtLevel(FOG_CLOUD, 1).size, 20);
  assert.equal(engine.resolveSpellAreaAtLevel(FOG_CLOUD, 3).size, 60);

  assert.equal(
    engine.resolveSpellAreaAtLevel(FOG_CLOUD, undefined).size,
    20,
    'круг не выбран — базовый',
  );
});

it('без прибавки, заговор и заклинание без области не растут', () => {
  const plain = { ...FOG_CLOUD, scaling: { additionalDice: '1к6' } };

  assert.equal(engine.spellAreaScalesWithLevel(FOG_CLOUD), true);
  assert.equal(engine.spellAreaScalesWithLevel(plain), false);
  assert.equal(engine.resolveSpellAreaAtLevel(plain, 5), plain.areaOfEffect);

  assert.equal(
    engine.spellAreaScalesWithLevel({ ...FOG_CLOUD, level: 0 }),
    false,
  );

  assert.equal(
    engine.resolveSpellAreaAtLevel(
      { ...FOG_CLOUD, areaOfEffect: undefined },
      3,
    ),
    undefined,
  );
});

it('пункт выбора круга называет размер области', () => {
  assert.equal(engine.formatAreaSizeAtLevel(FOG_CLOUD, 2, 'фт'), '40 фт');
});
