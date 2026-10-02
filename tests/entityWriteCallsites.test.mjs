import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { it } from 'vitest';

import { listSystemSources, toSystemPath } from './helpers/clientSources.mjs';

/**
 * Запись сущности на сервер — только через помощники записи.
 *
 * Клиент, который сам собирает копию и шлёт её целиком, затирает то, что
 * сервер изменил после копии: конец прежнего каста, метку концентрации.
 * Помощник боевой записи берёт сущность свежей и шлёт разницу эффектов.
 */

/** Единственное место, откуда система зовёт боевой канал ядра */
const COMBAT_WRITE_FILE = 'src/client/composables/entityCombatWrite.ts';

/** Вызов боевого канала ядра */
const COMBAT_CHANNEL_CALL = /\bemitEntityCombatState\(/u;

/**
 * Строки исходника, не считая комментариев: упоминание в комментарии — не
 * вызов.
 *
 * @param {string} text - исходник
 * @returns {string} текст без строк-комментариев
 */
function withoutCommentLines(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

it('боевой канал ядра система зовёт только из помощника записи', () => {
  const direct = listSystemSources()
    .filter((path) => toSystemPath(path) !== COMBAT_WRITE_FILE)
    .filter((path) =>
      COMBAT_CHANNEL_CALL.test(withoutCommentLines(readFileSync(path, 'utf8'))),
    )
    .map(toSystemPath);

  assert.deepEqual(direct, []);
});
