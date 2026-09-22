import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Снятие инлайн-токенов `@dmg.<тип>` и `@heal`/`@heal.temp` из формул при
 * показе. Токен определён один раз (`stripDamageTypeTokens`/`stripHealTokens`),
 * поэтому все места показа обязаны понимать его одинаково — иначе карточка
 * оружия и сводка эффекта расходятся на одной и той же формуле.
 */

/**
 * Оружие с одной частью урона — минимум для строки урона в списках.
 *
 * @param {string} formula - формула части
 * @param {string} [type] - тип урона части без токена
 * @returns {object} предмет-оружие
 */
function weapon(formula, type) {
  return { damageParts: [{ formula, type }] };
}

describe('снятие инлайн-токенов из формул при показе', () => {
  it('настоящие токены лечения снимаются во всех местах показа', () => {
    assert.equal(engine.formatWeaponDamageFormula(weapon('2d4@heal')), '2к4');

    assert.equal(
      engine.formatWeaponDamageFormula(weapon('2d4@heal.temp')),
      '2к4',
    );

    assert.equal(
      engine.formatWeaponDamageFormula(weapon('1d8@dmg.fire + 2d4@heal.temp')),
      '1к8 + 2к4',
    );

    assert.equal(
      engine.describeEffectDamageParts([{ formula: '2d4@heal.temp' }]),
      '2d4 временных хитов',
    );
  });

  it('слово, начинающееся с @heal, — не токен и остаётся в показе', () => {
    // Ограничитель `(?![\w.])` у токена лечения: без него показ срезал «@heal»
    // и оставлял хвост («@healing» → «ing», «2d4@heal.temporary» → «2к4orary»).
    assert.equal(
      engine.formatWeaponDamageFormula(weapon('1d4 + @healing')),
      '1к4 + @healing',
    );

    assert.equal(
      engine.formatWeaponDamageFormula(weapon('2d4@heal.temporary')),
      '2к4@heal.temporary',
    );

    assert.equal(
      engine.formatWeaponDamageFormula(weapon('@healer + 1d4')),
      '@healer + 1к4',
    );
  });

  it('@heal.spell не токен: показ его не режет, как и разбор', () => {
    // Хвост после `@heal` всплывает ошибкой парсера формул, а не молча
    // становится лечением, — поэтому и в показе он должен остаться целым.
    assert.equal(engine.detectFormulaHealKind('1d4@heal.spell'), null);

    assert.equal(
      engine.formatWeaponDamageFormula(weapon('1d4@heal.spell')),
      '1к4@heal.spell',
    );
  });

  it('показ оружия и сводка эффекта одинаково видят токен лечения', () => {
    const notTokens = ['@healing', '@heal.spell', '@healer', '@heal.temporary'];

    for (const formula of notTokens) {
      assert.equal(
        engine.formatWeaponDamageFormula(weapon(formula)),
        formula,
        `показ оружия не должен резать «${formula}»`,
      );

      assert.equal(
        engine.describeEffectDamageParts([{ formula }]),
        formula,
        `сводка эффекта не должна резать «${formula}»`,
      );

      assert.equal(engine.detectFormulaHealKind(formula), null);
    }
  });

  it('токены типа урона снимаются, тип части при этом не теряется', () => {
    const fireWeapon = weapon('1d8@dmg.slashing + 1d6@dmg.fire');

    assert.equal(engine.formatWeaponDamageFormula(fireWeapon), '1к8 + 1к6');
    assert.equal(engine.getWeaponPrimaryDamageType(fireWeapon), 'slashing');

    assert.equal(
      engine.describeEffectDamageParts([{ formula: '2d8@dmg.poison' }]),
      '2d8 ядом',
    );
  });

  it('токен типа в верхнем регистре читается как обычный тип', () => {
    // Общий detectFormulaDamageType приводит тип к нижнему регистру. Инлайн-
    // версия этого не делала, и «@dmg.FIRE» промахивался мимо таблицы подписей:
    // в сводке выходило английское «fire» вместо «огненный».
    assert.equal(
      engine.describeEffectDamageParts([{ formula: '2d8@dmg.FIRE' }]),
      '2d8 огненный',
    );

    assert.equal(
      engine.getWeaponPrimaryDamageType(weapon('2d8@dmg.FIRE')),
      'fire',
    );
  });

  it('часть со своим разбором распознаётся по тем же токенам', () => {
    // Решение «этой части нужен свой разбор» и снятие токенов обязаны считать
    // токеном одно и то же, иначе каст и показ разойдутся на одной формуле.
    assert.equal(
      engine.damagePartNeedsOwnResolution({ formula: '2d6@dmg.fire' }),
      true,
    );

    assert.equal(
      engine.damagePartNeedsOwnResolution({ formula: '2d4@heal' }),
      true,
    );

    assert.equal(
      engine.damagePartNeedsOwnResolution({ formula: '2d6@target.full' }),
      true,
    );

    assert.equal(
      engine.damagePartNeedsOwnResolution({ formula: '2d6' }),
      false,
    );

    // «@healing» — не токен: часть остаётся обычной, как и в показе
    assert.equal(
      engine.damagePartNeedsOwnResolution({ formula: '2d6 + @healing' }),
      false,
    );
  });

  it('лишние пробелы вокруг снятых токенов не остаются в показе', () => {
    assert.equal(
      engine.describeEffectDamageParts([
        { formula: '1d8  @dmg.fire  +  1d6  @heal' },
      ]),
      '1d8 + 1d6 огненный лечения',
    );

    assert.deepEqual(
      engine.splitFormulaByDamageType('1d8 @dmg.fire @target.full'),
      [
        {
          formula: '1d8 @target.full',
          type: 'fire',
          types: undefined,
          healing: undefined,
        },
      ],
    );

    assert.equal(
      engine.formatWeaponDamageFormula(weapon('  1d8@dmg.fire  ')),
      '1к8',
    );
  });
});
