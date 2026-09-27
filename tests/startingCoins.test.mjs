import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/startingEquipment.ts';",
);

const wallet = { cp: 3, sp: 0, ep: 0, gp: 8, pp: 0 };

it('золото варианта прибавляется к кошельку, а не заменяет его', () => {
  assert.deepEqual(engine.addStartingCoins(wallet, 150), {
    ...wallet,
    gp: 158,
  });

  // Исходный кошелёк не тронут: это объект листа
  assert.equal(wallet.gp, 8);
});

it('вариант без денег кошелёк не меняет', () => {
  assert.equal(engine.addStartingCoins(wallet, 0), wallet);
});
