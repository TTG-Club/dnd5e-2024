import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';

/**
 * Эффект, который клиент накладывает на существо, помнит наложившего и текущий
 * ход: путь наложения без общего штампа терял «ход наложившего», «до конца
 * хода заклинателя» и условие «цель помечена мной».
 */

/** Единственное место, где клиент штампует эффект движком */
const STAMP_HELPER_FILE = 'src/client/composables/spellResolutionShared.ts';

/** Общий штамп наложения клиента */
const STAMP_HELPER = 'stampEffectOnApply(';

/** Вызовы наложения эффектов на существо */
const APPLY_CALL_PATTERN =
  /\b(?:applyEffectsToTarget|applyEffectsToEntity)\(/gu;

/** Движковые штампы: мимо общего штампа клиент их не зовёт */
const ENGINE_STAMP_PATTERN = /\b(?:stampTurnDuration|stampAppliedEffect)\b/u;

/** Сколько символов перед вызовом наложения ищется штамп */
const STAMP_LOOKBEHIND = 600;

it('наложение эффекта с клиента идёт через общий штамп наложившего и хода', () => {
  const unstamped = [];

  for (const path of listClientSources()) {
    const text = readFileSync(path, 'utf8');

    for (const match of text.matchAll(APPLY_CALL_PATTERN)) {
      const before = text.slice(
        Math.max(0, match.index - STAMP_LOOKBEHIND),
        match.index,
      );

      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      const line = text.slice(lineStart, text.indexOf('\n', match.index));

      // Объявления и импорты — не наложение
      if (/^\s*(?:import|export|function|\*)/u.test(line)) {
        continue;
      }

      const after = text.slice(match.index, match.index + STAMP_LOOKBEHIND);

      if (!before.includes(STAMP_HELPER) && !after.includes(STAMP_HELPER)) {
        unstamped.push(`${toSystemPath(path)}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(unstamped, []);
});

it('каст с концентрацией начинается там же, где доводится', () => {
  const unstarted = listClientSources()
    .filter((path) => !path.endsWith('spellCastCompletion.ts'))
    .filter((path) => {
      const text = readFileSync(path, 'utf8');

      return (
        text.includes('completeSpellCast(') && !text.includes('beginSpellCast(')
      );
    })
    .map(toSystemPath);

  assert.deepEqual(unstarted, []);
});

it('движковый штамп клиент зовёт только из общего штампа', () => {
  const direct = listClientSources()
    .filter((path) => toSystemPath(path) !== STAMP_HELPER_FILE)
    .filter((path) => ENGINE_STAMP_PATTERN.test(readFileSync(path, 'utf8')))
    .map(toSystemPath);

  assert.deepEqual(direct, []);
});
