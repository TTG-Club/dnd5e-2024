import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { it } from 'vitest';

/**
 * Каждое окно броска атаки знает атакующего: иначе срабатывания «следующей
 * атаки» не расходуются. Так было с листов персонажа и существа — расход
 * делали только макросы хотбара.
 */

const systemRoot = fileURLToPath(new URL('../', import.meta.url));
const clientRoot = join(systemRoot, 'src/client');

/**
 * Исходники клиента.
 *
 * @param {string} directory - каталог
 * @returns {string[]} пути к .ts и .vue
 */
function listSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listSources(path);
    }

    return /\.(?:ts|vue)$/u.test(entry.name) ? [path] : [];
  });
}

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

  for (const path of listSources(clientRoot)) {
    const text = readFileSync(path, 'utf8');

    for (const modal of listAttackRollModals(text)) {
      attackModals += 1;

      if (!modal.body.includes(modal.attackerKey)) {
        missing.push(relative(systemRoot, path));
      }
    }
  }

  assert.ok(attackModals >= 8, `окон атаки найдено ${attackModals}`);
  assert.deepEqual(missing, []);
});

it('расход «следующей атаки» не собирается снова по вызывающим', () => {
  const leftovers = listSources(clientRoot).filter((path) =>
    /onAttackRolled|consumeAttackRollEffects/u.test(readFileSync(path, 'utf8')),
  );

  assert.deepEqual(leftovers, []);
});
