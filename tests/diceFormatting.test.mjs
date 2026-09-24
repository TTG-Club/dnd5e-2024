import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listSystemSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Кости по-русски в показе урона. Замена буквы кости живёт в движке одной
 * функцией: раньше её переписывали своим регэкспом шесть мест, и любое из них
 * могло тихо разойтись с остальными.
 *
 * Проверяется ровно то, из-за чего общей функцией не может быть
 * `formatDiceFormula`: тот разбирает формулу и заново расставляет знаки, а
 * показ получает строку уже собранной — с пробелами из записи мира, словом
 * «или» между ветками и `@`-токенами.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
  export { formatSpellDamageDisplay } from './src/client/ui/actor/utils/formatSpellDamageDisplay.ts';
`);

/** Формула с взаимоисключающими ветками по хитам цели */
const CONDITIONAL_FORMULA =
  '1d8@dmg.psychic@target.full + 1d12@dmg.lightning@target.notFull + @mod.spell';

/** Показ такой формулы: ветки через «или», общее слагаемое — после них */
const CONDITIONAL_DISPLAY = '1к8 или 1к12 + @mod.spell';

/**
 * Показ части урона оружия.
 *
 * @param {string} formula - формула части
 * @returns {string} строка показа
 */
function weaponDisplay(formula) {
  return engine.formatWeaponDamageFormula({
    itemType: 'weapon',
    damageParts: [{ formula, target: 'selected' }],
  });
}

/**
 * Показ части урона заклинания без владельца.
 *
 * @param {string} formula - формула части
 * @returns {string} строка показа
 */
function spellDisplay(formula) {
  return engine.formatSpellDamageDisplay({
    name: 'Проверка',
    level: 1,
    school: 'evocation',
    damageParts: [{ formula, target: 'selected' }],
  });
}

describe('буква кости в собранной строке показа', () => {
  it('пробелы записи мира остаются как есть', () => {
    assert.equal(engine.formatDiceLetters('1d8+2'), '1к8+2');
    assert.equal(engine.formatDiceLetters('1d8 + 2'), '1к8 + 2');
  });

  it('слово между ветками не склеивается', () => {
    assert.equal(
      engine.formatDiceLetters('1d8 или 1d12 + @mod.spell'),
      CONDITIONAL_DISPLAY,
    );
  });

  it('`@`-токен с цифрами не трогается', () => {
    assert.equal(engine.formatDiceLetters('1d8 + @d20'), '1к8 + @d20');
  });

  it('запись без числа костей не меняется: по ней токен и кость неразличимы', () => {
    assert.equal(engine.formatDiceLetters('d6'), 'd6');
  });
});

describe('показ урона зовёт общую замену', () => {
  it('определение части: ветки через «или»', () => {
    assert.equal(
      engine.describeDamagePart({
        formula: CONDITIONAL_FORMULA,
        target: 'selected',
      }).formula,
      CONDITIONAL_DISPLAY,
    );
  });

  it('определение части: пробелы формулы сохраняются', () => {
    assert.equal(
      engine.describeDamagePart({ formula: '1d8+2', target: 'selected' })
        .formula,
      '1к8+2',
    );
  });

  it('урон оружия: части через « + », токены сняты', () => {
    assert.equal(weaponDisplay('1d8@dmg.slashing + 1d6@dmg.fire'), '1к8 + 1к6');
    assert.equal(weaponDisplay('1d8+2'), '1к8+2');
  });

  it('урон заклинания в списке: ветки через «или»', () => {
    assert.equal(spellDisplay(CONDITIONAL_FORMULA), CONDITIONAL_DISPLAY);
    assert.equal(spellDisplay('1d8+2'), '1к8+2');
  });
});

describe('разобранная формула форматируется иначе', () => {
  it('знаки выравниваются, а запись без числа костей и русская «д» приводятся', () => {
    assert.equal(engine.formatDiceFormula('1d8+2'), '1к8 + 2');
    assert.equal(engine.formatDiceFormula('d6'), 'к6');
    assert.equal(engine.formatDiceFormula('2д6'), '2к6');
  });

  it('итог части урона оставляет незнакомый `@`-токен целым', () => {
    const preview = engine.previewDamagePart({
      formula: '1d8@dmg.force + @d20',
      target: 'selected',
    });

    assert.deepEqual(preview.unknownTokens, ['@d20']);
  });
});

/** Единственный дом замены буквы кости */
const DICE_LETTER_FILE = 'src/engine/diceFormula.ts';

/** Своя замена буквы кости: регэксп костей или подстановка `$1к$2` */
const OWN_DICE_REPLACEMENT_PATTERN = /\$1к\$2|\(\\d\+\)d\(\\d\+\)/u;

it('замена буквы кости не переписывается своим регэкспом', () => {
  const offenders = listSystemSources()
    .filter(
      (path) =>
        toSystemPath(path) !== DICE_LETTER_FILE
        && OWN_DICE_REPLACEMENT_PATTERN.test(readFileSync(path, 'utf8')),
    )
    .map((path) => toSystemPath(path));

  assert.deepEqual(
    offenders,
    [],
    `Замена «1d8» → «1к8» есть в движке: formatDiceLetters из ${DICE_LETTER_FILE}. Свой регэксп в: ${offenders.join(', ')}`,
  );
});
