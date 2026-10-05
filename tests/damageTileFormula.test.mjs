import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Плитка (бейдж) урона показывает только то, что бросается всегда. У оружия без
 * своей основы («Святой мститель»: одни добавки 2к10 по исчадиям и нежити)
 * постоянной части нет — раньше в плитку вставал полный текст добавок, бейдж
 * раздувался до ~200 px и выдавливал название предмета из строки.
 */

const helperPath = 'src/client/composables/damageTypeChoice.ts';

/** Заглушка плитки без постоянного урона */
const PLACEHOLDER = '—';

/** Чтение постоянной части из показа набора урона */
const BASE_FORMULA_READ = /\.baseFormula\b/u;

/** Общий текст плитки урона */
const TILE_HELPER = 'formatDamageTileFormula(';

/** Сборка показа частей: читает постоянную часть, но плиткой не является */
const DISPLAY_BUILDERS = [
  'src/client/ui/actor/utils/formatSpellDamageDisplay.ts',
];

const format = await loadHandler(helperPath, 'formatDamageTileFormula', {
  DAMAGE_NO_CONSTANT_LABEL: PLACEHOLDER,
});

describe('текст плитки урона', () => {
  it('постоянный урон — как есть, с прибавкой — вместе с ней', () => {
    assert.equal(format('1к6'), '1к6');
    assert.equal(format('1к8', 5), '1к8+5');
    assert.equal(format('1к4', -1), '1к4-1');
  });

  it('без постоянных костей остаётся одна прибавка', () => {
    assert.equal(format('', 3), '+3');
    assert.equal(format('', -1), '-1');
  });

  it('без постоянной части вовсе — короткая заглушка, а не текст добавок', () => {
    assert.equal(format(''), PLACEHOLDER);
    assert.equal(format('', 0), PLACEHOLDER);
  });
});

it('каждая плитка урона берёт текст общим способом', () => {
  const direct = listClientSources()
    .map((path) => ({
      path: toSystemPath(path),
      text: readFileSync(path, 'utf8'),
    }))
    .filter(({ path }) => !DISPLAY_BUILDERS.includes(path))
    .filter(
      ({ text }) => BASE_FORMULA_READ.test(text) && !text.includes(TILE_HELPER),
    )
    .map(({ path }) => path);

  assert.deepEqual(direct, []);
});
