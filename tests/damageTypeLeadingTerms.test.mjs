import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Тип в конце слагаемого: формулы существ TTG Club пишут его на числе
 * (`3к6+3@dmg.force`), а кость перед ним токена не несёт. Без типа части
 * ведущие слагаемые до первого токена вида берут вид этого токена — иначе
 * сопротивления и уязвимости к кости не применяются.
 */

/** Сегменты без пустых полей — для сравнения */
function split(formula, defaultType) {
  return engine
    .splitFormulaByDamageType(formula, defaultType)
    .map((segment) => ({
      formula: segment.formula,
      ...(segment.type ? { type: segment.type } : {}),
      ...(segment.types ? { types: segment.types } : {}),
      ...(segment.healing ? { healing: segment.healing } : {}),
    }));
}

/** Развёртка одной части без подстановки переменных */
function expand(formula, targetIsFull, type) {
  return engine
    .expandDamageParts([{ formula, type }], targetIsFull, (segment) => segment)
    .map((part) => ({
      formula: part.formula,
      type: part.type,
      ...(part.isHealing ? { isHealing: true } : {}),
      ...(part.targetStatusGate
        ? { targetStatusGate: part.targetStatusGate }
        : {}),
    }));
}

describe('тип в конце слагаемого распространяется на ведущие', () => {
  it('кость до числа с типом получает его тип', () => {
    assert.deepEqual(split('3к6+3@dmg.force'), [
      { formula: '3к6 + 3', type: 'force' },
    ]);

    assert.deepEqual(split('2к6+5@dmg.slashing'), [
      { formula: '2к6 + 5', type: 'slashing' },
    ]);
  });

  it('после первого токена вид течёт слева направо, как прежде', () => {
    assert.deepEqual(split('1к8+3@dmg.piercing + 2к6@dmg.poison'), [
      { formula: '1к8 + 3', type: 'piercing' },
      { formula: '2к6', type: 'poison' },
    ]);
  });

  it('лечение в конце делает лечением всю формулу', () => {
    assert.deepEqual(split('1к8+3@heal'), [
      { formula: '1к8 + 3', healing: 'hp' },
    ]);

    assert.deepEqual(split('1к8+3@heal.temp'), [
      { formula: '1к8 + 3', healing: 'temp' },
    ]);
  });

  it('несколько типов на слагаемом переходят на ведущие вместе', () => {
    assert.deepEqual(split('1к6 + 2@dmg.fire@dmg.cold'), [
      { formula: '1к6 + 2', type: 'fire', types: ['fire', 'cold'] },
    ]);
  });

  it('с типом части ведущие слагаемые берут его, как прежде', () => {
    assert.deepEqual(split('1к6 + 1к4@dmg.cold', 'fire'), [
      { formula: '1к6', type: 'fire' },
      { formula: '1к4', type: 'cold' },
    ]);
  });

  it('формула без токенов — один сегмент как есть', () => {
    assert.deepEqual(split('2к6 + 3'), [{ formula: '2к6 + 3' }]);
  });

  it('состояние цели: ведущие слагаемые обеих веток типизированы', () => {
    assert.deepEqual(
      expand('3к6+3@dmg.force + 2к6@dmg.force@target.status.prone'),
      [
        { formula: '3к6 + 3', type: 'force' },
        { formula: '2к6', type: 'force', targetStatusGate: 'prone' },
      ],
    );
  });

  it('ведущая кость в ветке состояния тоже получает тип', () => {
    assert.deepEqual(expand('3к6 + 2к6@target.status.prone + 3@dmg.force'), [
      { formula: '3к6 + 3', type: 'force' },
      { formula: '2к6', type: 'force', targetStatusGate: 'prone' },
    ]);
  });

  it('гейт по хитам цели не теряет тип ведущей кости', () => {
    assert.deepEqual(expand('1к8@target.notFull + 1к8@dmg.necrotic', true), [
      { formula: '1к8', type: 'necrotic' },
    ]);

    assert.deepEqual(expand('1к8@target.notFull + 1к8@dmg.necrotic', false), [
      { formula: '1к8 + 1к8', type: 'necrotic' },
    ]);
  });

  it('развёртка лечения без типа части — лечение целиком', () => {
    assert.deepEqual(expand('1к8+3@heal', true), [
      { formula: '1к8 + 3', type: undefined, isHealing: true },
    ]);
  });

  it('тип части при развёртке по-прежнему главнее токена справа', () => {
    assert.deepEqual(expand('1к6 + 1к4@dmg.cold', true, 'fire'), [
      { formula: '1к6', type: 'fire' },
      { formula: '1к4', type: 'cold' },
    ]);
  });

  it('описание части видит один тип у формулы существа', () => {
    assert.deepEqual(
      engine.describeDamagePart({ formula: '3к6+3@dmg.force' }).types,
      ['force'],
    );
  });

  it('бонус-урон эффекта без типа оружия типизирует ведущую кость', () => {
    const parts = engine.resolveBonusDamageParts(
      [{ formula: '1к6 + 1@dmg.radiant' }],
      undefined,
      true,
      (segment) => segment,
    );

    assert.deepEqual(
      parts.map((part) => ({ formula: part.formula, type: part.type })),
      [{ formula: '1к6 + 1', type: 'radiant' }],
    );
  });
});

/**
 * Несколько типов в одной формуле. Токен на ЧИСЛЕ закрывает свой блок: кость
 * перед ним берёт его тип, даже если левее уже был другой. Токен на КОСТИ —
 * запись заклинаний: тип течёт от него вправо.
 */
describe('несколько типов урона в одной формуле', () => {
  it('два блока «тип в конце» не путают кости', () => {
    assert.deepEqual(split('1к8+3@dmg.piercing + 2к6+1@dmg.poison'), [
      { formula: '1к8 + 3', type: 'piercing' },
      { formula: '2к6 + 1', type: 'poison' },
    ]);
  });

  it('три блока подряд — у каждого свой тип', () => {
    assert.deepEqual(
      split('1к4 + 1@dmg.fire + 1к4 + 1@dmg.cold + 1к4 + 1@dmg.acid'),
      [
        { formula: '1к4 + 1', type: 'fire' },
        { formula: '1к4 + 1', type: 'cold' },
        { formula: '1к4 + 1', type: 'acid' },
      ],
    );
  });

  it('тип на кости, дальше блок с типом в конце', () => {
    assert.deepEqual(split('1к8@dmg.fire + 2к6 + 3@dmg.cold'), [
      { formula: '1к8', type: 'fire' },
      { formula: '2к6 + 3', type: 'cold' },
    ]);
  });

  it('число после кости с типом остаётся с ней', () => {
    assert.deepEqual(split('3к8@dmg.force+7+3к10@dmg.psychic'), [
      { formula: '3к8 + 7', type: 'force' },
      { formula: '3к10', type: 'psychic' },
    ]);

    assert.deepEqual(split('1к8@dmg.fire + 3'), [
      { formula: '1к8 + 3', type: 'fire' },
    ]);
  });

  it('токены на каждой кости — как записаны', () => {
    assert.deepEqual(split('1к8 + 2к6@dmg.fire + 3@dmg.cold'), [
      { formula: '1к8 + 2к6', type: 'fire' },
      { formula: '3', type: 'cold' },
    ]);
  });

  it('лечение в конце блока забирает свою кость', () => {
    assert.deepEqual(split('2к6@dmg.fire + 1к8 + 3@heal'), [
      { formula: '2к6', type: 'fire' },
      { formula: '1к8 + 3', healing: 'hp' },
    ]);
  });

  it('с типом части ведущая кость — его, следующие блоки — свои', () => {
    assert.deepEqual(split('1к8+3@dmg.piercing + 2к6+1@dmg.poison', 'fire'), [
      { formula: '1к8', type: 'fire' },
      { formula: '3', type: 'piercing' },
      { formula: '2к6 + 1', type: 'poison' },
    ]);
  });

  it('условие на числе в конце блока — на весь блок', () => {
    assert.deepEqual(
      expand('1к8+3@dmg.fire + 2к6+2@dmg.cold@target.status.prone'),
      [
        { formula: '1к8 + 3', type: 'fire' },
        { formula: '2к6 + 2', type: 'cold', targetStatusGate: 'prone' },
      ],
    );
  });

  it('гейт по хитам на числе в конце блока — на весь блок', () => {
    assert.deepEqual(
      expand('1к8+3@dmg.fire + 2к6+2@dmg.cold@target.notFull', true),
      [{ formula: '1к8 + 3', type: 'fire' }],
    );
  });

  it('бонус-урон эффекта делит блоки так же', () => {
    const parts = engine.resolveBonusDamageParts(
      [{ formula: '1к6+1@dmg.radiant + 1к4+1@dmg.fire' }],
      undefined,
      true,
      (segment) => segment,
    );

    assert.deepEqual(
      parts.map((part) => ({ formula: part.formula, type: part.type })),
      [
        { formula: '1к6 + 1', type: 'radiant' },
        { formula: '1к4 + 1', type: 'fire' },
      ],
    );
  });
});

describe('скобки в формуле — одно слагаемое', () => {
  it('тип после скобки относится ко всей скобке', () => {
    assert.deepEqual(split('(1к8+3)@dmg.fire', 'slashing'), [
      { formula: '(1к8+3)', type: 'fire' },
    ]);
  });

  it('формула роста по уровню не рвётся при типе части', () => {
    assert.deepEqual(
      split('(2 + steps(@classLevel, 9, 16))d6@heal.temp', 'fire'),
      [{ formula: '(2 + steps(@classLevel, 9, 16))d6', healing: 'temp' }],
    );
  });

  it('деление на слагаемые собирает исходную строку обратно', () => {
    const formula = '(1к8 + 3)@dmg.fire + 2к6 + (1 + 1)';

    assert.deepEqual(engine.splitFormulaTerms(formula), [
      '(1к8 + 3)@dmg.fire ',
      ' 2к6 ',
      ' (1 + 1)',
    ]);

    assert.equal(engine.splitFormulaTerms(formula).join('+'), formula);
  });
});

describe('подпись условия в строке урона', () => {
  /** Показ без подстановки переменных: токены типа и лечения сняты */
  function display(formula, type) {
    return engine.describeDamagePart({ formula, type }).formula;
  }

  it('условие на числе в конце блока подписывает весь блок', () => {
    assert.equal(
      display('1к6+1@dmg.fire + 1к6+1@dmg.cold@target.status.prone'),
      '1к6 + 1 + (1к6 + 1) (цель: Лежащий ничком)',
    );
  });

  it('условие на кости подписывает только её', () => {
    assert.equal(
      display('3к6+3@dmg.force + 2к6@dmg.force@target.status.prone'),
      '3к6 + 3 + 2к6 (цель: Лежащий ничком)',
    );
  });

  it('разные условия — под своими подписями', () => {
    assert.equal(
      display(
        '1к6+1@dmg.fire@target.status.prone + 1к4+1@dmg.cold@self.status.bloodied',
      ),
      '(1к6 + 1) (цель: Лежащий ничком) + (1к4 + 1) (атакующий: Окровавленный)',
    );
  });
});
