import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/effectChangeSubtract.ts';",
);

it('смена знака затрагивает только сложение верхнего уровня', () => {
  const cases = [
    ['1к4', '-1к4'],
    ['-1к4', '1к4'],
    ['1к4+2', '-1к4-2'],
    ['1к4 - @prof', '-1к4 + @prof'],
    ['2*-1', '-2*-1'],
    ['max(1, @mod.str - 1)', '-max(1, @mod.str - 1)'],
    ['@prof', '-@prof'],
  ];

  for (const [value, negated] of cases) {
    assert.equal(engine.negateEffectFormula(value), negated, value);
    assert.equal(engine.negateEffectFormula(negated), value.trim(), negated);
  }

  // Недописанная формула не прыгает, пока её набирают
  assert.equal(
    engine.negateEffectFormula(engine.negateEffectFormula('1к4+')),
    '1к4+',
  );
});

it('«Добавить» с минусом показывается как «Вычесть» без минуса', () => {
  const subtract = { mode: 'add', value: '-1к4' };

  assert.equal(engine.getEffectChangeModeChoice(subtract), 'subtract');
  assert.equal(engine.getEffectChangeShownValue(subtract), '1к4');

  const add = { mode: 'add', value: '1к4' };

  assert.equal(engine.getEffectChangeModeChoice(add), 'add');
  assert.equal(engine.getEffectChangeShownValue(add), '1к4');

  // Минус у другого режима — просто значение
  const override = { mode: 'override', value: '-2' };

  assert.equal(engine.getEffectChangeModeChoice(override), 'override');
  assert.equal(engine.getEffectChangeShownValue(override), '-2');
});

it('смена режима сохраняет то число, что видел автор', () => {
  const add = { mode: 'add', value: '1к4+2' };
  const subtract = engine.applyEffectChangeModeChoice(add, 'subtract');

  assert.deepEqual(subtract, { mode: 'add', value: '-1к4-2' });
  assert.deepEqual(engine.applyEffectChangeModeChoice(subtract, 'add'), add);

  assert.deepEqual(engine.applyEffectChangeModeChoice(subtract, 'multiply'), {
    mode: 'multiply',
    value: '1к4+2',
  });

  // Повторный выбор «Вычесть» не меняет строку
  assert.deepEqual(
    engine.applyEffectChangeModeChoice(subtract, 'subtract'),
    subtract,
  );
});

it('поле «Вычесть» пишется с минусом и не теряет режим, пока пустое', () => {
  const subtract = { mode: 'add', value: '-1к4' };

  assert.equal(engine.toStoredEffectChangeValue(subtract, '2'), '-2');

  const emptied = {
    mode: 'add',
    value: engine.toStoredEffectChangeValue(subtract, ''),
  };

  assert.equal(engine.getEffectChangeModeChoice(emptied), 'subtract');
  assert.equal(engine.getEffectChangeShownValue(emptied), '');
  assert.equal(engine.toStoredEffectChangeValue(emptied, '3'), '-3');

  // У обычной прибавки поле пишется как есть
  assert.equal(
    engine.toStoredEffectChangeValue({ mode: 'add', value: '1' }, '5'),
    '5',
  );
});
