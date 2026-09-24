import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Поле опыта в окне повышения уровня считает как поле хитов у фишки: число —
 * задать, со знаком — сдвинуть текущий опыт.
 */

const engine = await loadEngineBundle(`
  export { resolveExperienceInput } from './src/engine/index.ts';
`);

const CURRENT_EXPERIENCE = 150;

describe('ввод опыта', () => {
  it('число без знака задаёт опыт', () => {
    assert.equal(engine.resolveExperienceInput('300', CURRENT_EXPERIENCE), 300);
  });

  it('знак сдвигает от текущего опыта', () => {
    assert.equal(
      engine.resolveExperienceInput('+150', CURRENT_EXPERIENCE),
      300,
    );

    assert.equal(engine.resolveExperienceInput('-50', CURRENT_EXPERIENCE), 100);
  });

  it('складывает цепочку и терпит пробелы и типографский минус', () => {
    assert.equal(
      engine.resolveExperienceInput(' +100 + 50 − 20 ', CURRENT_EXPERIENCE),
      280,
    );

    assert.equal(
      engine.resolveExperienceInput('100+50', CURRENT_EXPERIENCE),
      150,
    );
  });

  it('не уходит ниже нуля', () => {
    assert.equal(engine.resolveExperienceInput('-500', CURRENT_EXPERIENCE), 0);
  });

  it('мусор и пустое поле не разбираются', () => {
    for (const input of ['', '+', 'abc', '1.5', '+-5', '10*2']) {
      assert.equal(
        engine.resolveExperienceInput(input, CURRENT_EXPERIENCE),
        undefined,
        input,
      );
    }
  });
});
