import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Кнопки бросков `{@roll …}` в описаниях компендиума. Туда, где описание идёт
 * простым текстом (чат, подсказка), марка должна уходить голой формулой, а не
 * со скобками.
 */
describe('снятие кнопок бросков из описания', () => {
  it('марка заменяется своей формулой', () => {
    assert.equal(
      engine.stripDescriptionRollMarkers(
        'Цель получает {@roll 1к4 + 1} урона, затем {@roll 2к6}.',
      ),
      'Цель получает 1к4 + 1 урона, затем 2к6.',
    );
  });

  it('текст без марок не меняется', () => {
    assert.equal(
      engine.stripDescriptionRollMarkers('**Атака:** 1к6 урона'),
      '**Атака:** 1к6 урона',
    );
  });
});
