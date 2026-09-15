import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';

/**
 * Каждое окно броска атаки знает атакующего: иначе срабатывания «следующей
 * атаки» не расходуются. Так было с листов персонажа и существа — расход
 * делали только макросы хотбара.
 */

/**
 * Объектный литерал, начинающийся с `{` на позиции `start`.
 *
 * @param {string} text - исходник
 * @param {number} start - позиция открывающей скобки
 * @returns {string} литерал целиком
 */
function readBraces(text, start) {
  let depth = 0;

  for (let index = start; index < text.length; index++) {
    if (text[index] === '{') {
      depth += 1;
    } else if (text[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return text.slice(start);
}

/**
 * Окна броска атаки в исходнике: шаблонные и открытые через `openModal`.
 *
 * @param {string} text - исходник
 * @returns {Array<{ body: string, attackerKey: string }>} окна с ключом атакующего
 */
function listAttackRollModals(text) {
  const templates = [...text.matchAll(/<DiceRollModal\b[^>]*?\/>/gu)]
    .map((match) => match[0])
    .filter((body) => body.includes(':attack-modifier'))
    .map((body) => ({ body, attackerKey: ':attacker-id' }));

  const opened = [...text.matchAll(/openModal\('DiceRollModal',\s*\{/gu)]
    .map((match) => readBraces(text, match.index + match[0].length - 1))
    .filter((body) => /attackModifier/u.test(body))
    .map((body) => ({ body, attackerKey: 'attackerId' }));

  return [...templates, ...opened];
}

it('окно броска атаки везде получает атакующего', () => {
  const missing = [];

  let attackModals = 0;

  for (const path of listClientSources()) {
    const text = readFileSync(path, 'utf8');

    for (const modal of listAttackRollModals(text)) {
      attackModals += 1;

      if (!modal.body.includes(modal.attackerKey)) {
        missing.push(toSystemPath(path));
      }
    }
  }

  assert.ok(attackModals >= 8, `окон атаки найдено ${attackModals}`);
  assert.deepEqual(missing, []);
});

it('расход «следующей атаки» не собирается снова по вызывающим', () => {
  const leftovers = listClientSources().filter((path) =>
    /onAttackRolled|consumeAttackRollEffects/u.test(readFileSync(path, 'utf8')),
  );

  assert.deepEqual(leftovers, []);
});
