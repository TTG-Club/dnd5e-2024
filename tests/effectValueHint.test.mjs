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

describe('ступени и кости с выражением словами', () => {
  it('скрытая атака: кости по уровню плута читаются рядом правил', () => {
    const change = addChange(engine.SNEAK_ATTACK_DICE_FORMULA);

    const text = engine.describeChangeValue(change);

    assert.equal(
      text,
      '+1к6, +1к6 на 3, 5, 7, 9, 11, 13, 15, 17 и 19 уровнях в классе',
    );
  });

  it('прибавка по ступеням без костей: «2, +1 на 9 и 16 уровнях»', () => {
    assert.equal(
      engine.describeChangeValue(addChange('2 + steps(@classLevel, 9, 16)')),
      '+2, +1 на 9 и 16 уровнях в классе',
    );
  });

  it('ступени внутри выражения и грань выражением — без служебных слов', () => {
    const text = engine.describeChangeValue(
      addChange('(1 + steps(@level, 17))к(8 + 2 * steps(@level, 5, 11))'),
    );

    assert.ok(!text.includes('steps'), text);

    assert.equal(
      text,
      '+(1 + (по 1 на 17 уровне))к(8 + 2 × (по 1 на 5 и 11 уровнях))',
    );
  });

  it('пробелы вокруг знаков у куска рядом с костью', () => {
    assert.equal(
      engine.describeChangeValue(addChange('(@castLevel)к10+@mod.wis')),
      '+(круг ячейки)к10 + мод. Мудрости',
    );
  });
});
