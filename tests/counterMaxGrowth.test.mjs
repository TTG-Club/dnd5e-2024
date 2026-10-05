import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import { createActor, engine } from './scenarios/_fixtures.mjs';

/**
 * Счётчик растёт вместе с максимумом, как хиты на повышении уровня:
 * «Возложение рук» 5/5 у паладина 1-го уровня становится 20/20 на 4-м, а
 * потраченное остаётся потраченным (3/5 → 18/20). Раньше текущее только
 * обрезалось, и рост максимума приходил пустым до отдыха.
 */

const wizardPath = 'src/client/ui/actor/class/wizard/useClassWizard.ts';

/**
 * Счётчик листа с формулой максимума.
 *
 * @param {number} current - текущее
 * @param {number} max - прежний максимум
 * @param {string} maxFormula - формула нового максимума
 * @param {object} overrides - правила отдыха и прочее
 * @returns {object} счётчик
 */
function counter(current, max, maxFormula, overrides = {}) {
  return {
    counterKey: 'lay-on-hands',
    name: 'Возложение рук',
    current,
    max,
    maxFormula,
    recovery: 'long',
    ...overrides,
  };
}

describe('рост текущего вместе с максимумом', () => {
  it('полный остаётся полным, потраченное остаётся потраченным', () => {
    assert.equal(engine.resizeCounterCurrent({ current: 5, max: 5 }, 20), 20);
    assert.equal(engine.resizeCounterCurrent({ current: 3, max: 5 }, 20), 18);
  });

  it('падение максимума обрезает', () => {
    assert.equal(engine.resizeCounterCurrent({ current: 5, max: 5 }, 3), 3);
    assert.equal(engine.resizeCounterCurrent({ current: 1, max: 5 }, 3), 1);
  });

  it('«появляется пустым» не наполняется ростом', () => {
    assert.equal(
      engine.resizeCounterCurrent({ current: 0, max: 2 }, 4, {
        startsEmpty: true,
      }),
      0,
    );
  });

  it('прежний максимум 0 — ресурс приходит как новый', () => {
    assert.equal(engine.resizeCounterCurrent({ current: 0, max: 0 }, 3), 3);

    assert.equal(
      engine.resizeCounterCurrent({ current: 0, max: 0 }, 3, {
        startsEmpty: true,
      }),
      0,
    );
  });

  it('пересчёт максимумов листа: рост прибавляется, второй проход не удваивает', () => {
    const actor = createActor();

    const [first] = engine.refreshCounterMaxima(actor, [counter(3, 5, '20')]);

    assert.equal(`${first.current}/${first.max}`, '18/20');

    // Второй проход видит уже новый максимум
    const [second] = engine.refreshCounterMaxima(actor, [first]);

    assert.equal(`${second.current}/${second.max}`, '18/20');
  });

  it('ресурс, который отдых не возвращает, ростом не наполняется', () => {
    const actor = createActor();
    const none = { mode: 'none', amount: 1 };

    const [mutation] = engine.refreshCounterMaxima(actor, [
      counter(1, 2, '4', { shortRest: none, longRest: none }),
    ]);

    assert.equal(`${mutation.current}/${mutation.max}`, '1/4');
  });

  it('мастер класса: пересчёт классового ресурса растит текущее', async () => {
    const refreshClassCounter = await loadHandler(
      wizardPath,
      'refreshClassCounter',
      {
        resizeCounterCurrent: engine.resizeCounterCurrent,
        counterDefinitionRest: () => ({}),
        counterMaxFormulaOf: () => undefined,
        Boolean,
      },
    );

    const definition = { key: 'lay-on-hands', name: 'Возложение рук' };

    const refreshed = refreshClassCounter(counter(3, 5), definition, 20);

    assert.equal(`${refreshed.current}/${refreshed.max}`, '18/20');

    // Тот же счётчик вторым проходом — без второй прибавки
    const again = refreshClassCounter(refreshed, definition, 20);

    assert.equal(`${again.current}/${again.max}`, '18/20');
  });
});
