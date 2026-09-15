import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it } from 'vitest';

/**
 * Каталог сценариев и его тесты не расходятся: у каждой строки
 * `docs/EFFECT_SCENARIOS.md` есть тест и у каждого теста — строка.
 */

const SCENARIOS_DIR = dirname(fileURLToPath(import.meta.url));

const CATALOG_PATH = join(
  SCENARIOS_DIR,
  '..',
  '..',
  'docs',
  'EFFECT_SCENARIOS.md',
);

/** ID сценария в имени теста: `[S01]`, `[SZ08–SZ10]` */
const TEST_ID_PATTERN = /\[([A-Z]{1,2}\d{2}[a-z]?)(?:–([A-Z]{1,2}\d{2}))?\]/g;

/** ID пробела: сценарий `it.todo` */
const TODO_ID_PATTERN = /it\.todo\(\s*'\[([A-Z]{1,2}\d{2}[a-z]?)\]/g;

/** ID в первой колонке строки таблицы документа */
const CATALOG_ROW_PATTERN = /^\| ([A-Z]{1,2}\d{2}[a-z]?) \|/;

/** Статус «не выражается» в строке таблицы */
const GAP_MARK = '⛔';

/**
 * Разворачивает диапазон `SZ08–SZ10`.
 *
 * @param {string} first - начало
 * @param {string} last - конец
 * @returns {string[]} ID диапазона
 */
function expandRange(first, last) {
  const prefix = first.replace(/\d+$/, '');
  const from = Number(first.slice(prefix.length));
  const to = Number(last.slice(prefix.length));

  return Array.from(
    { length: to - from + 1 },
    (_, index) => `${prefix}${String(from + index).padStart(2, '0')}`,
  );
}

/**
 * ID тестов каталога: все и пробелы.
 *
 * @returns {{ all: Set<string>, todo: Set<string> }} ID
 */
function collectTestIds() {
  const all = new Set();
  const todo = new Set();

  const files = readdirSync(SCENARIOS_DIR).filter((name) =>
    name.endsWith('.test.mjs'),
  );

  for (const file of files) {
    const source = readFileSync(join(SCENARIOS_DIR, file), 'utf8');

    for (const match of source.matchAll(TEST_ID_PATTERN)) {
      const ids = match[2] ? expandRange(match[1], match[2]) : [match[1]];

      for (const id of ids) {
        all.add(id);
      }
    }

    for (const match of source.matchAll(TODO_ID_PATTERN)) {
      todo.add(match[1]);
    }
  }

  return { all, todo };
}

/**
 * Строки таблиц документа с ID.
 *
 * @param {string} catalog - текст документа
 * @returns {{ id: string, line: string }[]} строки
 */
function collectCatalogRows(catalog) {
  return catalog.split('\n').flatMap((line) => {
    const match = CATALOG_ROW_PATTERN.exec(line);

    return match ? [{ id: match[1], line }] : [];
  });
}

describe('каталог сценариев', () => {
  const rows = collectCatalogRows(readFileSync(CATALOG_PATH, 'utf8'));
  const catalogIds = new Set(rows.map((row) => row.id));
  const { all, todo } = collectTestIds();

  it('у каждой строки документа есть тест и наоборот', () => {
    assert.deepEqual(
      [...catalogIds].filter((id) => !all.has(id)),
      [],
      'строки без теста',
    );

    assert.deepEqual(
      [...all].filter((id) => !catalogIds.has(id)),
      [],
      'тесты без строки',
    );
  });

  it('пробелы документа — это it.todo', () => {
    const gapIds = rows
      .filter((row) => row.line.trimEnd().endsWith(`${GAP_MARK} |`))
      .map((row) => row.id);

    assert.deepEqual(gapIds.sort(), [...todo].sort());
  });
});
