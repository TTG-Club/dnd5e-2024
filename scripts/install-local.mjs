/**
 * Локальная установка системы в VTTG — БЕЗ выпуска релиза.
 *
 * Обычный путь доставки (тег → CI → GitHub Release → установка по ссылке на
 * манифест) слишком тяжёл, чтобы проверить одну правку: каждая проверка стоит
 * публичного релиза с номером версии, который потом не переиспользуют. Этот
 * скрипт делает ровно то же, что установщик VTTG, но локально: собирает `dist/`
 * и кладёт её содержимое в папку установленной системы в данных приложения.
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
 *    открывается. Поэтому после копирования скрипт пересчитывает хэш ТЕМ ЖЕ
 *    алгоритмом и обновляет запись (аналог кнопки «Доверять коду» в интерфейсе).
 * 3. ЗАМЕНА ЦЕЛИКОМ. Файлы кладутся во временную папку рядом и переезжают на
 *    место через rename — прерванное копирование не оставит систему из половины
 *    старой и половины новой сборки.
 *
 * Использование:
 *
 *   npm run install:local                    # сборка + установка
 *   npm run install:local -- --skip-build    # установить уже собранный dist/
 *   npm run install:local -- --version 0.5.3 # пометить сборку своим номером
 *   npm run install:local -- --data "D:\путь\к\данным VTTG"
 *
 * Корень данных можно задать и переменной окружения `VTTG_DATA_DIR`.
 *
 * `--version` правит номер ТОЛЬКО в `dist/system.json` — так в списке систем
 * видно, что загружена локальная сборка, а не установленный релиз. Версию в
 * репозитории (`package.json`, `system.json`, поле движка) руками не трогают
 * никогда: её меняет только `npm run release`, иначе номера разъезжаются и
 * следующий релиз уходит не туда. Ровно так же поступает CI — штампует номер из
 * тега в манифест перед сборкой (`scripts/stamp-manifest.mjs`).
 *
 * ВАЖНО: серверный `index.js` приложение импортирует один раз за запуск, поэтому
 * после установки VTTG нужно ПЕРЕЗАПУСТИТЬ.
 */
import { spawnSync } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

/** Реестр доверия в корне данных установки (имя задано приложением). */
const TRUST_REGISTRY_FILENAME = 'installed-systems.json';

/** Указатель на выбранную пользователем папку данных (создаёт welcome-экран). */
const DATA_POINTER_FILENAME = 'data-location.json';

/** Что приложение считает «кодом» системы при вычислении хэша доверия. */
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/** Файлы, без которых установленная система нерабочая. */
const REQUIRED_ENTRIES = ['system.json', 'client.js', 'index.js', 'data'];

/**
 * Завершает работу с сообщением об ошибке.
 *
 * @param message - что пошло не так
 */
function fail(message) {
  console.error(`\n[install-local] ${message}\n`);
  process.exit(1);
}

/**
 * Запускает команду, показывая её вывод; прерывает всё при ненулевом коде.
 *
 * @param command - исполняемая команда
 * @param args - аргументы
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    fail(`шаг "${command} ${args.join(' ')}" не прошёл — установка остановлена`);
  }
}

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
 */
function resolveDataPath(explicitPath) {
  const fromArgs = explicitPath ?? process.env.VTTG_DATA_DIR;

  if (fromArgs) {
    const resolved = path.resolve(fromArgs);

    if (!existsSync(resolved)) {
      fail(`указанная папка данных не существует: ${resolved}`);
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
      fail(`не читается указатель ${pointerPath}: ${error.message}`);
    }

    if (typeof pointer?.path === 'string' && pointer.path) {
      if (!existsSync(pointer.path)) {
        fail(
          `указатель ${DATA_POINTER_FILENAME} ведёт в несуществующую папку `
            + `${pointer.path} — диск отключён или папку удалили`,
        );
      }

      return path.resolve(pointer.path);
    }
  }

  // Указателя нет — это dev-режим приложения: данные лежат в %APPDATA%\VTTG.
  if (!existsSync(userDataDir)) {
    fail(
      `не нашёл данные VTTG (ни указателя ${pointerPath}, ни самой папки) — `
        + 'запустите приложение хотя бы раз или укажите путь через --data',
    );
  }

  return userDataDir;
}

/**
 * Вычисляет хэш кода системы — БАЙТ В БАЙТ как `computeEntryHash` приложения:
 * SHA-256 по отсортированному списку кодовых файлов плюс `system.json`, где на
 * каждый файл в хэш идёт относительный путь, `\0`, содержимое и снова `\0`.
 *
 * @param systemDir - папка установленной системы
 * @returns hex-строка SHA-256 или null, если кодовых файлов нет
 */
function computeEntryHash(systemDir) {
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
function writeTrustRecord(dataPath, systemId, version, hash) {
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
      console.warn(
        `[install-local] ${TRUST_REGISTRY_FILENAME} не читается — создаю заново`,
      );
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

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const dataArgIndex = args.indexOf('--data');
const dataArg = dataArgIndex === -1 ? undefined : args[dataArgIndex + 1];
const versionArgIndex = args.indexOf('--version');
const versionArg =
  versionArgIndex === -1 ? undefined : args[versionArgIndex + 1];

if (dataArgIndex !== -1 && !dataArg) {
  fail('у флага --data не указан путь');
}

if (versionArgIndex !== -1 && !/^\d+\.\d+\.\d+$/.test(versionArg ?? '')) {
  fail(`у флага --version ожидается номер вида X.Y.Z, получено "${versionArg ?? ''}"`);
}

// 1. Сборка. Она же — единственная проверка годности бандла (см. scripts/build.mjs).
if (skipBuild) {
  console.log('[install-local] сборка пропущена (--skip-build)');
} else {
  run('npm', ['run', 'build']);
}

for (const entry of REQUIRED_ENTRIES) {
  if (!existsSync(path.join(DIST, entry))) {
    fail(`в dist/ нет ${entry} — соберите систему (npm run build)`);
  }
}

const manifestPath = path.join(DIST, 'system.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const systemId = manifest.id;

if (typeof systemId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(systemId)) {
  fail(`в манифесте негодный id: ${JSON.stringify(systemId)}`);
}

// Номер правим в СОБРАННОМ манифесте, а не в исходниках: репозиторий остаётся с
// версией последнего релиза, а в приложении локальная сборка отличима от неё.
if (versionArg) {
  manifest.version = versionArg;

  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8',
  );
}

const dataPath = resolveDataPath(dataArg);
const systemsDir = path.join(dataPath, 'systems');
const targetDir = path.join(systemsDir, systemId);
const stagingDir = path.join(
  dataPath,
  'systems-staging',
  `${systemId}.local-${process.pid}`,
);

console.log(`[install-local] данные VTTG: ${dataPath}`);
console.log(`[install-local] ${systemId} ${manifest.version} → ${targetDir}`);

// 2. Кладём сборку рядом и переезжаем на место одним rename: оборванное
//    копирование не должно оставить систему наполовину обновлённой.
mkdirSync(path.dirname(stagingDir), { recursive: true });
rmSync(stagingDir, { recursive: true, force: true });
cpSync(DIST, stagingDir, { recursive: true });

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
  fail(`не удалось положить систему в ${targetDir}: ${error.message}`);
}

rmSync(previousDir, { recursive: true, force: true });

// 3. Код сменился — прежнее доверие недействительно. Подтверждаем заново, иначе
//    приложение не исполнит систему и не отдаст её ассеты.
const hash = computeEntryHash(targetDir);

if (!hash) {
  fail(`в ${targetDir} не нашлось кодовых файлов — доверие подтвердить нечем`);
}

writeTrustRecord(dataPath, systemId, manifest.version, hash);

console.log(
  `\n[install-local] установлено. Доверие подтверждено (${hash.slice(0, 12)}…).\n`
    + '[install-local] ПЕРЕЗАПУСТИТЕ VTTG: серверный index.js импортируется один\n'
    + '                раз за запуск, старый код останется в памяти.\n',
);
