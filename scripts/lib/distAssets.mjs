/**
 * Некодовая часть папки системы: манифест и справочные данные движка.
 *
 * Живёт отдельно от `scripts/build.mjs`, потому что ровно те же шаги нужны
 * watch-режиму (`scripts/dev.mjs`): правка `system.json` или JSON-справочника
 * обязана доезжать до приложения так же, как правка кода.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Расширения кода — в `data/` не копируются (код уже в бандлах). */
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.map',
]);

/**
 * Проверяет, попадёт ли файл в `dist/data/` (то есть НЕ код).
 *
 * @param filePath - путь или имя файла
 * @returns `true`, если файл считается данными
 */
export function isDataFile(filePath) {
  return !CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Рекурсивно копирует только НЕ-кодовые файлы (данные, ассеты).
 *
 * @param sourceDir - откуда
 * @param targetDir - куда
 * @returns число скопированных файлов
 */
export function copyDataFiles(sourceDir, targetDir) {
  let copied = 0;

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copied += copyDataFiles(sourcePath, targetPath);

      continue;
    }

    if (!isDataFile(entry.name)) {
      continue;
    }

    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
    copied += 1;
  }

  return copied;
}

/**
 * Кладёт в `dist/` манифест и справочные данные движка.
 *
 * @param root - корень репозитория
 * @param dist - папка сборки
 * @returns число скопированных файлов данных
 */
export function copyManifestAndData(root, dist) {
  mkdirSync(dist, { recursive: true });
  cpSync(path.join(root, 'system.json'), path.join(dist, 'system.json'));

  // Справочные данные и компендиум лежат внутри исходников движка.
  const dataSource = path.join(root, 'src', 'engine');

  return existsSync(dataSource)
    ? copyDataFiles(dataSource, path.join(dist, 'data'))
    : 0;
}
