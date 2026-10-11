import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Покупка снаряжения: цена сводится к медным, кошелёк платит своими монетами
 * без пересчёта в «удобные», а при нехватке покупка не проходит.
 */

const engine = await loadEngineBundle(`
  export {
    formatCoins,
    formatCopperAmount,
    itemCostInCopper,
    payFromWallet,
    receiveIntoWallet,
    summarizePurchase,
    walletValueInCopper,
  } from './src/engine/index.ts';
`);

const EMPTY_WALLET = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

describe('цена предмета в медных', () => {
  it('читает цену объектом и строкой', () => {
    assert.equal(engine.itemCostInCopper({ value: 15, currency: 'gp' }), 1500);
    assert.equal(engine.itemCostInCopper('5 см'), 50);
    assert.equal(engine.itemCostInCopper('2 пм'), 2000);
  });

  it('запись без цены стоит ноль', () => {
    assert.equal(engine.itemCostInCopper(''), 0);
    assert.equal(engine.itemCostInCopper(undefined), 0);
  });
});

describe('подпись суммы', () => {
  it('раскладывает медные на золото, серебро и медь', () => {
    assert.equal(engine.formatCopperAmount(1530), '15 зм 3 см');
    assert.equal(engine.formatCopperAmount(7), '7 мм');
  });

  it('ноль подписан нулём золотых', () => {
    assert.equal(engine.formatCopperAmount(0), '0 зм');
    assert.equal(engine.formatCoins(EMPTY_WALLET), '0 зм');
  });

  it('кошелёк подписан от крупных монет к мелким', () => {
    assert.equal(
      engine.formatCoins({ ...EMPTY_WALLET, pp: 2, gp: 15, cp: 4 }),
      '2 пм 15 зм 4 мм',
    );
  });
});

describe('оплата из кошелька', () => {
  it('платит золотом, когда его хватает, и не трогает платину', () => {
    assert.deepEqual(
      engine.payFromWallet({ ...EMPTY_WALLET, gp: 20, pp: 1 }, 1500),
      { ...EMPTY_WALLET, gp: 5, pp: 1 },
    );
  });

  it('добирает платиной, когда золота мало', () => {
    assert.deepEqual(
      engine.payFromWallet({ ...EMPTY_WALLET, gp: 100, pp: 200 }, 150_000),
      { ...EMPTY_WALLET, gp: 0, pp: 60 },
    );
  });

  it('разбивает монету и возвращает сдачу', () => {
    assert.deepEqual(
      engine.payFromWallet({ ...EMPTY_WALLET, gp: 1, cp: 3 }, 5),
      { ...EMPTY_WALLET, gp: 0, sp: 9, cp: 8 },
    );
  });

  it('сумма в кошельке уменьшается ровно на цену', () => {
    const wallet = { cp: 7, sp: 3, ep: 2, gp: 4, pp: 1 };

    for (const cost of [1, 9, 49, 137, 999, 1537]) {
      const after = engine.payFromWallet(wallet, cost);

      assert.equal(
        engine.walletValueInCopper(after),
        engine.walletValueInCopper(wallet) - cost,
      );

      for (const amount of Object.values(after)) {
        assert.ok(amount >= 0);
      }
    }
  });

  it('при нехватке денег не платит', () => {
    assert.equal(
      engine.payFromWallet({ ...EMPTY_WALLET, gp: 1 }, 101),
      undefined,
    );
  });

  it('бесплатная покупка кошелёк не меняет', () => {
    const wallet = { ...EMPTY_WALLET, gp: 1 };

    assert.equal(engine.payFromWallet(wallet, 0), wallet);
  });
});

describe('выручка в кошелёк', () => {
  it('кладёт сумму золотом, серебром и медью, не трогая остальное', () => {
    assert.deepEqual(
      engine.receiveIntoWallet({ ...EMPTY_WALLET, pp: 2, gp: 5 }, 1537),
      { cp: 7, sp: 3, ep: 0, gp: 20, pp: 2 },
    );
  });

  it('нулевая выручка кошелёк не меняет', () => {
    const wallet = { ...EMPTY_WALLET, gp: 1 };

    assert.equal(engine.receiveIntoWallet(wallet, 0), wallet);
  });
});

describe('итог покупки', () => {
  const items = [
    { cost: { value: 15, currency: 'gp' } },
    { cost: '5 см' },
    { cost: '' },
  ];

  it('считает цену и остаток', () => {
    assert.deepEqual(
      engine.summarizePurchase({ ...EMPTY_WALLET, gp: 20 }, items),
      {
        costInCopper: 1550,
        shortageInCopper: 0,
        walletAfter: { ...EMPTY_WALLET, gp: 4, sp: 5 },
      },
    );
  });

  it('называет нехватку и не отдаёт кошелёк', () => {
    assert.deepEqual(
      engine.summarizePurchase({ ...EMPTY_WALLET, gp: 10 }, items),
      {
        costInCopper: 1550,
        shortageInCopper: 550,
        walletAfter: undefined,
      },
    );
  });
});
