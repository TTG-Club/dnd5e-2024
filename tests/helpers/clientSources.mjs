import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { systemRoot } from './engineBundle.mjs';

/**
 * Исходники клиента для проверок вызовов по тексту: такие тесты ловят места,
 * которые обходят общий путь, не запуская сам клиент.
 */

/** Корень исходников клиента системы */
const clientRoot = join(systemRoot, 'src/client');

/** Исходник клиента: TypeScript или однофайловый компонент Vue */
const CLIENT_SOURCE_PATTERN = /\.(?:ts|vue)$/u;

/**
 * Исходники каталога вместе с вложенными.
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

    return CLIENT_SOURCE_PATTERN.test(entry.name) ? [path] : [];
  });
}

/**
 * Все исходники клиента.
 *
 * @returns {string[]} абсолютные пути к .ts и .vue
 */
export function listClientSources() {
  return listSources(clientRoot);
}

/**
 * Путь исходника от корня системы с прямыми слешами: так он читается в
 * сообщении теста одинаково на любой платформе.
 *
 * @param {string} path - абсолютный путь
 * @returns {string} путь от корня
 */
export function toSystemPath(path) {
  return relative(systemRoot, path).replaceAll('\\', '/');
}
