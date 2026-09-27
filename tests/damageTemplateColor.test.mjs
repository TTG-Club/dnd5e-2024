import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Основной тип урона и цвет шаблона области. Раньше «первый тип первой части»
 * и выбор цвета по нему переписывали на месте шесть мест (макросы, блоки
 * действий и заклинаний существа, вкладка заклинаний) — теперь это две
 * функции движка, и все места обязаны давать один и тот же результат.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
`);

describe('getDamagePartsPrimaryType', () => {
  it('берёт первый тип первой части — из токена формулы', () => {
    assert.equal(
      engine.getDamagePartsPrimaryType([
        { formula: '2d6@dmg.fire + 1d6@dmg.cold' },
        { formula: '1d8', type: 'acid' },
      ]),
      'fire',
    );
  });

  it('без токена берёт тип части', () => {
    assert.equal(
      engine.getDamagePartsPrimaryType([{ formula: '1d8', type: 'thunder' }]),
      'thunder',
    );
  });

  it('без частей и для чистого лечения — undefined', () => {
    assert.equal(engine.getDamagePartsPrimaryType(undefined), undefined);
    assert.equal(engine.getDamagePartsPrimaryType([]), undefined);

    assert.equal(
      engine.getDamagePartsPrimaryType([{ formula: '1d8@heal' }]),
      undefined,
    );
  });
});

describe('getDamageTemplateColor', () => {
  it('известный тип — цвет из таблицы', () => {
    assert.equal(
      engine.getDamageTemplateColor('fire'),
      engine.SPELL_DAMAGE_TEMPLATE_COLORS.fire,
    );
  });

  it('неизвестный или пустой тип — цвет по умолчанию', () => {
    assert.equal(
      engine.getDamageTemplateColor('unknown'),
      engine.SPELL_TEMPLATE_DEFAULT_COLOR,
    );

    assert.equal(
      engine.getDamageTemplateColor(undefined),
      engine.SPELL_TEMPLATE_DEFAULT_COLOR,
    );
  });
});
