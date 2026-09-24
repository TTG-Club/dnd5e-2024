import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Расшифровка значения модификатора под полем формы. Формулу читают словами
 * тем же парсером, что её считает, — иначе подпись разошлась бы с итогом.
 */

/**
 * Строка модификатора «Добавить» с заданным значением.
 *
 * @param {string} value - значение
 * @param {string} [key] - ключ строки
 * @returns {object} строка модификатора
 */
function addChange(value, key = 'damage.melee') {
  return { key, mode: 'add', value, condition: '', priority: 20 };
}

describe('describeEffectChangeValueHint', () => {
  it('число и кость не расшифровываются — они понятны и так', () => {
    assert.equal(engine.describeEffectChangeValueHint(addChange('2')), '');
    assert.equal(engine.describeEffectChangeValueHint(addChange('1к4')), '');
  });

  it('floor читается словами, переменные — подписями', () => {
    assert.equal(
      engine.describeEffectChangeValueHint(
        addChange('2 + floor((@classLevel - 1) / 4)'),
      ),
      '+2 + ((уровень в классе − 1) / 4, с округлением вниз)',
    );
  });

  it('скобки остаются там, где они меняют смысл', () => {
    assert.equal(
      engine.describeEffectChangeValueHint(addChange('@prof * (2 - @level)')),
      '+бонус мастерства × (2 − уровень)',
    );
  });

  it('формула урона с токенами описывается частью урона', () => {
    const hint = engine.describeEffectChangeValueHint(
      addChange('2к6@dmg.fire@target.full'),
    );

    assert.ok(!hint.includes('@'), hint);
    assert.ok(hint.includes('2к6'), hint);
  });
});
