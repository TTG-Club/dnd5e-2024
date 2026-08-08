/**
 * Установка собранной системы в данные VTTG — общая механика для разовой
 * установки (`scripts/install-local.mjs`) и watch-режима (`scripts/dev.mjs`).
 *
 * Что здесь повторено за приложением (иначе система молча не поднимется):
 *
 * 1. ПАПКА. Система живёт в `<данные установки>/systems/<id>/`, где `<id>` —
 *    поле `id` манифеста. Корень данных приложение берёт из указателя
 *    `%APPDATA%/VTTG/data-location.json` (его создаёт welcome-экран), а в
 *    dev-режиме без указателя — из `%APPDATA%/VTTG`.
 * 2. ДОВЕРИЕ. Наличие папки НЕ означает, что код будет исполнен: VTTG держит
 *    реестр `<данные установки>/installed-systems.json`, где доверие привязано к
 *    SHA-256 всех кодовых файлов системы. Подменили код — хэш разошёлся, система
 *    снова недоверенна, `/system-assets/<id>/*` отдаёт 404 и лист персонажа не
 *    открывается. Поэтому после копирования хэш пересчитывается ТЕМ ЖЕ
 *    алгоритмом и запись обновляется (аналог кнопки «Доверять коду»).
 *
 * Все функции бросают `Error` с готовым для показа текстом — печатает его
 * вызывающий скрипт со своим префиксом.
 */
import crypto from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Реестр доверия в корне данных установки (имя задано приложением). */
const TRUST_REGISTRY_FILENAME = 'installed-systems.json';

/** Указатель на выбранную пользователем папку данных (создаёт welcome-экран). */
const DATA_POINTER_FILENAME = 'data-location.json';

/** Что приложение считает «кодом» системы при вычислении хэша доверия. */
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/** Файлы, без которых установленная система нерабочая. */
const REQUIRED_ENTRIES = ['system.json', 'client.js', 'index.js', 'data'];

/** Строгий id системы — та же форма, что проверяет раздача ассетов в приложении. */
const SYSTEM_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Возвращает папку приложения по умолчанию (`app.getPath('userData')`).
 *
 * @returns путь к `…/VTTG`
 */
function appUserDataDir() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'VTTG',
    );
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'VTTG');
  }

  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'VTTG',
  );
}

/**
 * Определяет корень данных установки VTTG — тем же порядком, что и приложение.
 *
 * @param explicitPath - путь из `--data` (если задан)
 * @returns абсолютный путь к корню данных
 * @throws Error - путь не найден или указатель ведёт в никуда
 */
export function resolveDataPath(explicitPath) {
  const fromArgs = explicitPath ?? process.env.VTTG_DATA_DIR;

  if (fromArgs) {
    const resolved = path.resolve(fromArgs);

    if (!existsSync(resolved)) {
      throw new Error(`указанная папка данных не существует: ${resolved}`);
    }

    return resolved;
  }

  const userDataDir = appUserDataDir();
  const pointerPath = path.join(userDataDir, DATA_POINTER_FILENAME);

  if (existsSync(pointerPath)) {
    let pointer;

    try {
      pointer = JSON.parse(readFileSync(pointerPath, 'utf-8'));
    } catch (error) {
      throw new Error(`не читается указатель ${pointerPath}: ${error.message}`);
    }

    if (typeof pointer?.path === 'string' && pointer.path) {
      if (!existsSync(pointer.path)) {
        throw new Error(
          `указатель ${DATA_POINTER_FILENAME} ведёт в несуществующую папку `
            + `${pointer.path} — диск отключён или папку удалили`,
        );
      }

      return path.resolve(pointer.path);
    }
  }

  // Указателя нет — это dev-режим приложения: данные лежат в %APPDATA%\VTTG.
  if (!existsSync(userDataDir)) {
    throw new Error(
      `не нашёл данные VTTG (ни указателя ${pointerPath}, ни самой папки) — `
        + 'запустите приложение хотя бы раз или укажите путь через --data',
    );
  }

  return userDataDir;
}

/**
 * Читает манифест из папки и проверяет id (по нему строится путь установки и
 * URL раздачи `/system-assets/<id>/…`).
 *
 * @param manifestPath - путь к `system.json`
 * @returns разобранный манифест
 * @throws Error - файла нет, он не разбирается или id негодный
 */
export function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`не найден манифест ${manifestPath}`);
  }

  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `манифест ${manifestPath} не разбирается: ${error.message}`,
    );
  }

  if (typeof manifest.id !== 'string' || !SYSTEM_ID_REGEX.test(manifest.id)) {
    throw new Error(`в манифесте негодный id: ${JSON.stringify(manifest.id)}`);
  }

  return manifest;
}

/**
 * Проверяет, что в `dist/` есть всё нужное для рабочей установки.
 *
 * @param distDir - папка сборки
 * @throws Error - какого-то обязательного файла нет
 */
export function assertDistComplete(distDir) {
  for (const entry of REQUIRED_ENTRIES) {
    if (!existsSync(path.join(distDir, entry))) {
      throw new Error(
        `в dist/ нет ${entry} — соберите систему (npm run build)`,
      );
    }
  }
}

/**
 * Вычисляет хэш кода системы — БАЙТ В БАЙТ как `computeEntryHash` приложения:
 * SHA-256 по отсортированному списку кодовых файлов плюс `system.json`, где на
 * каждый файл в хэш идёт относительный путь, `\0`, содержимое и снова `\0`.
 *
 * @param systemDir - папка установленной системы
 * @returns hex-строка SHA-256 или null, если кодовых файлов нет
 */
export function computeEntryHash(systemDir) {
  const codeFiles = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile()
        && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        codeFiles.push(full);
      }
    }
  };

  walk(systemDir);

  if (codeFiles.length === 0) {
    return null;
  }

  const manifestPath = path.join(systemDir, 'system.json');

  const filesToHash =
    existsSync(manifestPath) && statSync(manifestPath).isFile()
      ? [...codeFiles, manifestPath]
      : codeFiles;

  filesToHash.sort();

  const hash = crypto.createHash('sha256');

  for (const file of filesToHash) {
    const rel = path.relative(systemDir, file).replace(/\\/g, '/');

    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }

  return hash.digest('hex');
}

/**
 * Обновляет запись доверия для системы, не трогая остальные.
 *
 * @param dataPath - корень данных установки
 * @param systemId - id системы
 * @param version - версия из манифеста
 * @param hash - хэш кода системы
 */
export function writeTrustRecord(dataPath, systemId, version, hash) {
  const registryPath = path.join(dataPath, TRUST_REGISTRY_FILENAME);

  let registry = {};

  if (existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, 'utf-8'));

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        registry = parsed;
      }
    } catch {
      // Битый реестр приложение читает как пустой — и мы тоже: перезапишем его
      // целиком, потеряв доверие к другим системам (их придётся подтвердить
      // заново кнопкой в интерфейсе). Это лучше, чем упасть и оставить как есть.
      console.warn(`${TRUST_REGISTRY_FILENAME} не читается — создаю заново`);
    }
  }

  registry[systemId] = {
    version,
    hash,
    trustedAt: new Date().toISOString(),
  };

  writeFileSync(
    registryPath,
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf-8',
  );
}

/**
 * Заменяет папку установленной системы ЦЕЛИКОМ: файлы кладутся во временную
 * папку рядом и переезжают на место через rename — прерванное копирование не
 * оставит систему из половины старой и половины новой сборки.
 *
 * @param distDir - папка сборки (источник)
 * @param dataPath - корень данных установки
 * @param systemId - id системы
 * @returns путь к папке установленной системы
 * @throws Error - переезд не удался (прежняя папка при этом возвращается на место)
 */
export function replaceSystemDir(distDir, dataPath, systemId) {
  const systemsDir = path.join(dataPath, 'systems');
  const targetDir = path.join(systemsDir, systemId);

  const stagingDir = path.join(
    dataPath,
    'systems-staging',
    `${systemId}.local-${process.pid}`,
  );

  mkdirSync(path.dirname(stagingDir), { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });
  cpSync(distDir, stagingDir, { recursive: true });

  const previousDir = `${targetDir}.previous-${process.pid}`;
  const hadPrevious = existsSync(targetDir);

  mkdirSync(systemsDir, { recursive: true });

  if (hadPrevious) {
    renameSync(targetDir, previousDir);
  }

  try {
    renameSync(stagingDir, targetDir);
  } catch (error) {
    if (hadPrevious) {
      renameSync(previousDir, targetDir);
    }

    rmSync(stagingDir, { recursive: true, force: true });

    throw new Error(
      `не удалось положить систему в ${targetDir}: ${error.message}`,
    );
  }

  rmSync(previousDir, { recursive: true, force: true });

  return targetDir;
}

/**
 * Обновляет папку установленной системы ПОВЕРХ (без сноса и rename).
 *
 * Отличие от {@link replaceSystemDir} и причина существования: в watch-режиме
 * замена целиком на секунду оставляет систему без папки, а раздача ассетов у
 * приложения завязана на хэш её кода — попавший в эту секунду запрос получил бы
 * 404 недоверенной системы. Копирование поверх такого окна не создаёт: пока не
 * дописан последний файл, у страницы просто прежний код.
 *
 * Плата — файлы, которых в новой сборке уже нет, остаются лежать (в dev это
 * безвредно: приложение читает только то, что перечислено в манифесте).
 *
 * @param distDir - папка сборки (источник)
 * @param targetDir - папка установленной системы
 */
export function syncSystemDir(distDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  cpSync(distDir, targetDir, { recursive: true, force: true });
}

/**
 * Пересчитывает хэш кода системы и подтверждает доверие заново.
 *
 * Вызывать СТРОГО после того, как все кодовые файлы дописаны: хэш считается по
 * их содержимому, и подтверждение, снятое с недописанного файла, сделает систему
 * недоверенной ровно до следующей сборки.
 *
 * @param dataPath - корень данных установки
 * @param targetDir - папка установленной системы
 * @param systemId - id системы
 * @param version - версия из манифеста
 * @returns хэш, записанный в реестр доверия
 * @throws Error - в папке не нашлось кодовых файлов
 */
export function confirmTrust(dataPath, targetDir, systemId, version) {
  const hash = computeEntryHash(targetDir);

  if (!hash) {
    throw new Error(
      `в ${targetDir} не нашлось кодовых файлов — доверие подтвердить нечем`,
    );
  }

  writeTrustRecord(dataPath, systemId, version, hash);

  return hash;
}
