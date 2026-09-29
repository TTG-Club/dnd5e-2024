import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Поле монет в окне кошелька считает как поле опыта: число — задать, со знаком —
 * сдвинуть текущее количество, итог не выходит за границы кошелька.
 */

const engine = await loadEngineBundle(`
  export { resolveCurrencyAmountInput, CURRENCY_AMOUNT_MAX } from './src/engine/index.ts';
`);

const CURRENT_AMOUNT = 20;

describe('ввод монет', () => {
  it('число без знака задаёт количество', () => {
    assert.equal(engine.resolveCurrencyAmountInput('7', CURRENT_AMOUNT), 7);
  });

  it('знак сдвигает от текущего количества, цепочка складывается', () => {
    assert.equal(engine.resolveCurrencyAmountInput('+15', CURRENT_AMOUNT), 35);
    assert.equal(engine.resolveCurrencyAmountInput('-3', CURRENT_AMOUNT), 17);

    assert.equal(
      engine.resolveCurrencyAmountInput('+10 − 5 + 1', CURRENT_AMOUNT),
      26,
    );
  });

  it('не уходит ниже нуля и выше потолка кошелька', () => {
    assert.equal(engine.resolveCurrencyAmountInput('-100', CURRENT_AMOUNT), 0);

    assert.equal(
      engine.resolveCurrencyAmountInput('+99999999', CURRENT_AMOUNT),
      engine.CURRENCY_AMOUNT_MAX,
    );
  });

  it('мусор и пустое поле не разбираются', () => {
    for (const input of ['', '+', 'abc', '1.5', '+-5', '10*2']) {
      assert.equal(
        engine.resolveCurrencyAmountInput(input, CURRENT_AMOUNT),
        undefined,
        input,
      );
    }
  });
});
