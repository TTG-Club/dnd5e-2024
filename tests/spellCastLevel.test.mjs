import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';

const castsPath = 'src/client/composables/spellCasts.ts';

/**
 * Настоящие функции реестра кастов над общей памятью.
 *
 * @returns {Promise<object>} функции реестра
 */
async function loadCasts() {
  const memory = {
    activeCastIds: new Map(),
    activeCastLevels: new Map(),
  };

  const castMemoryKey = await loadHandler(castsPath, 'castMemoryKey', {});
  const ports = { ...memory, castMemoryKey };

  return {
    beginSpellCast: await loadHandler(castsPath, 'beginSpellCast', {
      ...ports,
    }),
    setSpellCastLevel: await loadHandler(castsPath, 'setSpellCastLevel', {
      ...ports,
    }),
    resolveSpellCastLevel: await loadHandler(
      castsPath,
      'resolveSpellCastLevel',
      { ...ports },
    ),
  };
}

const holdPerson = { id: 'hold-person', level: 2, concentration: true };

it('круг каста — выбранная ячейка, а не базовый круг заклинания', async () => {
  const casts = await loadCasts();

  casts.beginSpellCast('wizard', holdPerson, 'cast-1');
  casts.setSpellCastLevel('wizard', holdPerson, 5);

  assert.equal(casts.resolveSpellCastLevel('wizard', holdPerson), 5);
});

it('новый каст забывает круг прежнего', async () => {
  const casts = await loadCasts();

  casts.beginSpellCast('wizard', holdPerson, 'cast-1');
  casts.setSpellCastLevel('wizard', holdPerson, 5);
  casts.beginSpellCast('wizard', holdPerson, 'cast-2');

  assert.equal(casts.resolveSpellCastLevel('wizard', holdPerson), 2);
});

it('круг наложения существа известен с начала каста', async () => {
  const casts = await loadCasts();

  casts.beginSpellCast('lich', holdPerson, 'cast-1', 4);

  assert.equal(casts.resolveSpellCastLevel('lich', holdPerson), 4);

  assert.equal(
    casts.resolveSpellCastLevel('wizard', holdPerson),
    2,
    'другой заклинатель — свой каст',
  );

  assert.equal(casts.resolveSpellCastLevel(undefined, holdPerson), 2);
});
