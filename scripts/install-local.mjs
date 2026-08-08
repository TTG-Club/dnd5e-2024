/**
 * Локальная установка системы в VTTG — БЕЗ выпуска релиза.
 *
 * Обычный путь доставки (тег → CI → GitHub Release → установка по ссылке на
 * манифест) слишком тяжёл, чтобы проверить одну правку: каждая проверка стоит
 * публичного релиза с номером версии, который потом не переиспользуют. Этот
 * скрипт делает ровно то же, что установщик VTTG, но локально: собирает `dist/`
 * и кладёт её содержимое в папку установленной системы в данных приложения.
 *
 * Механика установки (папка, доверие по хэшу, замена целиком) живёт в
 * `scripts/lib/installSystem.mjs` — её же использует watch-режим `npm run dev`.
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
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertDistComplete,
  confirmTrust,
  readManifest,
  replaceSystemDir,
  resolveDataPath,
} from './lib/installSystem.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

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

try {
  assertDistComplete(DIST);

  const manifestPath = path.join(DIST, 'system.json');
  const manifest = readManifest(manifestPath);

  // Номер правим в СОБРАННОМ манифесте, а не в исходниках: репозиторий остаётся с
  // версией последнего релиза, а в приложении локальная сборка отличима от неё.
  if (versionArg) {
    manifest.version = versionArg;

    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  }

  const dataPath = resolveDataPath(dataArg);

  console.log(`[install-local] данные VTTG: ${dataPath}`);

  console.log(
    `[install-local] ${manifest.id} ${manifest.version} → `
      + `${path.join(dataPath, 'systems', manifest.id)}`,
  );

  // 2. Кладём сборку рядом и переезжаем на место одним rename.
  const targetDir = replaceSystemDir(DIST, dataPath, manifest.id);

  // 3. Код сменился — прежнее доверие недействительно. Подтверждаем заново, иначе
  //    приложение не исполнит систему и не отдаст её ассеты.
  const hash = confirmTrust(dataPath, targetDir, manifest.id, manifest.version);

  console.log(
    `\n[install-local] установлено. Доверие подтверждено (${hash.slice(0, 12)}…).\n`
      + '[install-local] ПЕРЕЗАПУСТИТЕ VTTG: серверный index.js импортируется один\n'
      + '                раз за запуск, старый код останется в памяти.\n',
  );
} catch (error) {
  fail(error.message);
}
