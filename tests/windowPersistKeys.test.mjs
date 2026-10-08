import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { it } from 'vitest';

/**
 * Сторож ключей памяти окон.
 *
 * Приложение (VTTG) запоминает, где окно стояло и какого было размера, и
 * открывает его там же. Окно без своего `persist-key` запоминается под именем
 * компонента, в шаблоне которого стоит. Два запоминаемых окна в одном
 * компоненте делили бы один ключ — и молча открывались бы на месте друг
 * друга. Блокирующие и неперетаскиваемые окна не запоминаются, им ключ не нужен.
 */

const SOURCE_ROOT = fileURLToPath(new URL('../src', import.meta.url));

const WINDOW_TAG_OPENING = '<UDraggableModal';

/** Строка, которой prettier закрывает многострочный открывающий тег */
const TAG_CLOSING_LINE_PATTERN = /^\s*\/?>\s*$/;

/** Собирает все `.vue` в каталоге и его подкаталогах. */
function collectVueFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectVueFiles(entryPath);
    }

    return entry.name.endsWith('.vue') ? [entryPath] : [];
  });
}

/**
 * Достаёт атрибуты всех тегов `UDraggableModal` из исходника компонента.
 * Тег читается построчно: в атрибутах встречается `>` (стрелочные
 * обработчики), и одним регулярным выражением его не взять.
 */
function extractWindowTags(source) {
  const lines = source.split('\n');

  return lines.flatMap((line, lineIndex) => {
    if (!line.includes(WINDOW_TAG_OPENING)) {
      return [];
    }

    const closingOffset = lines
      .slice(lineIndex + 1)
      .findIndex((nextLine) => TAG_CLOSING_LINE_PATTERN.test(nextLine));

    return closingOffset === -1
      ? []
      : [lines.slice(lineIndex + 1, lineIndex + 1 + closingOffset).join('\n')];
  });
}

/** Запоминает ли окно своё место, судя по атрибутам тега. */
function isPersistedWindow(attributes) {
  const isBlocking =
    /(?:^|\s)blocking(?:\s|$)/.test(attributes)
    || attributes.includes(':blocking="true"');

  const isFixed = attributes.includes(':draggable="false"');
  const isOptedOut = attributes.includes(':persist-geometry="false"');

  return !isBlocking && !isFixed && !isOptedOut;
}

it('в одном компоненте без своего ключа — не больше одного запоминаемого окна', () => {
  const offenders = collectVueFiles(SOURCE_ROOT).flatMap((filePath) => {
    const keylessWindows = extractWindowTags(
      readFileSync(filePath, 'utf8'),
    ).filter(
      (attributes) =>
        isPersistedWindow(attributes) && !attributes.includes('persist-key'),
    );

    return keylessWindows.length > 1 ? [relative(SOURCE_ROOT, filePath)] : [];
  });

  assert.deepEqual(offenders, []);
});
