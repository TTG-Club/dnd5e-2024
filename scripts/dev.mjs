/**
 * Watch-режим: правишь исходники системы — приложение показывает изменения.
 *
 * Отдельный терминал рядом с dev-сборкой VTTG. Скрипт держит две инкрементальные
 * сборки (клиент — Vite, сервер — esbuild), а после каждой пересборки делает то
 * же, что `npm run install:local`: кладёт `dist/` в
 * `<данные установки>/systems/<id>/` и заново подтверждает доверие к коду.
 *
 * ЧТО ЭТО НЕ: это не HMR. Клиент системы приложение подключает тегом `<script>`
 * при входе в мир, а бандл — библиотечный IIFE, в котором нет ни модульного
 * графа, ни `import.meta.hot`. Поэтому цикл здесь — «пересборка + перезагрузка
 * страницы», и состояние открытых окон теряется.
 *
 * ПЕРЕЗАГРУЗКУ страницы скрипт берёт на себя: в установленную копию `client.js`
 * дописывается крошечный опросчик, который раз в секунду читает `dev-stamp.json`
 * из папки системы и перезагружает страницу, когда штамп сменился. Так работает
 * без единой правки в приложении — файл отдаёт та же раздача `/system-assets/`,
 * что и сам бандл. Отключается флагом `--no-reload`.
 *
 * ⚠️ ЧЕГО НЕ УМЕЕТ: серверную часть (`src/server`, серверная сторона движка).
 * Приложение импортирует `index.js` системы один раз за запуск процесса
 * (`await import(...)`, ESM-кэш Node не сбрасывается), поэтому такие правки
 * доезжают только после перезапуска VTTG. Скрипт про это предупреждает отдельной
 * строкой, когда пересобрался именно сервер.
 *
 * Использование:
 *
 *   npm run dev
 *   npm run dev -- --no-reload             # без автоперезагрузки страницы
 *   npm run dev -- --data "D:\путь\к\данным VTTG"
 *
 * ⚠️ Страницу нужно открывать с ПОРТА МИРА (кнопка «открыть в браузере» в списке
 * миров, `http://localhost:<порт мира>`): в dev-режиме окно приложения живёт на
 * Vite-сервере хоста, а он раздачу `/system-assets/` не проксирует. На порту мира
 * работает и то, и другое — мир-сервер отдаёт файлы системы сам, а остальное
 * проксирует в Vite вместе с его HMR.
 */
import { context } from 'esbuild';
import crypto from 'node:crypto';
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

import { inspectClientBundle } from './lib/bundleChecks.mjs';
import { copyManifestAndData, isDataFile } from './lib/distAssets.mjs';
import {
  assertDistComplete,
  confirmTrust,
  readManifest,
  replaceSystemDir,
  resolveDataPath,
  syncSystemDir,
} from './lib/installSystem.mjs';
import { createServerBuildOptions } from './lib/serverBuildOptions.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

/**
 * Пауза перед установкой после сигнала о пересборке. Клиент и сервер собираются
 * независимо и почти одновременно, а правка одного файла может дёрнуть обе
 * сборки — без склейки установка шла бы по два-три раза подряд.
 */
const SYNC_DEBOUNCE_MS = 200;

/**
 * Пауза для правок ДАННЫХ (`system.json`, JSON-справочники движка). Она длиннее,
 * потому что такой файл обычно ещё и импортирован кодом: файловый сторож увидит
 * правку сразу, а Vite доедет со своей пересборкой примерно через секунду. Ждём
 * их обоих, иначе на одну правку придутся две установки и две перезагрузки.
 */
const DATA_DEBOUNCE_MS = 1500;

/** Как часто страница спрашивает штамп сборки (мс). */
const RELOAD_POLL_MS = 1000;

/** Имя файла-штампа: по его смене страница понимает, что пора перезагрузиться. */
const STAMP_FILENAME = 'dev-stamp.json';

const args = process.argv.slice(2);
const noReload = args.includes('--no-reload');
const dataArgIndex = args.indexOf('--data');
const dataArg = dataArgIndex === -1 ? undefined : args[dataArgIndex + 1];

/**
 * Печатает сообщение с временем — в watch-режиме без отметки времени непонятно,
 * относится строка к текущей правке или висит с прошлой.
 *
 * @param message - что показать
 */
function log(message) {
  const now = new Date().toTimeString().slice(0, 8);

  console.log(`[dev ${now}] ${message}`);
}

/**
 * Код автоперезагрузки, дописываемый в УСТАНОВЛЕННУЮ копию `client.js`.
 *
 * В `dist/` он не попадает и в релиз уехать не может: дописывается уже после
 * копирования, в файл внутри папки данных приложения.
 *
 * @param systemId - id системы (нужен для URL раздачи)
 * @returns готовый к дописыванию кусок JS
 */
function createReloadSnippet(systemId) {
  return `
;(function () {
  /* Дописано "npm run dev" этой системы. В релизной сборке этого кода нет. */
  if (globalThis.__vttgSystemDevReload) { return; }

  globalThis.__vttgSystemDevReload = true;

  var url = '/system-assets/${systemId}/${STAMP_FILENAME}';
  var known = null;

  setInterval(function () {
    fetch(url + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.text() : null; })
      .then(function (text) {
        if (text === null) { return; }
        if (known === null) { known = text; return; }
        if (text !== known) { known = text; location.reload(); }
      })
      .catch(function () { /* сервер мира перезапускается — попробуем позже */ });
  }, ${RELOAD_POLL_MS});
})();
`;
}

// Готовим цель установки ДО первой сборки: если данных VTTG нет или манифест
// негодный, лучше упасть сразу, а не после полутора минут сборки.
let dataPath;
let manifest;

try {
  manifest = readManifest(path.join(ROOT, 'system.json'));
  dataPath = resolveDataPath(dataArg);
} catch (error) {
  console.error(`\n[dev] ${error.message}\n`);
  process.exit(1);
}

const systemId = manifest.id;
const targetDir = path.join(dataPath, 'systems', systemId);

// Watch-сборки пишут в `dist/` по частям и с выключенным `emptyOutDir` (иначе
// Vite стирал бы папку на каждой пересборке клиента, унося с собой `index.js` и
// `data/`). Поэтому чистим её ровно один раз — здесь.
rmSync(DIST, { recursive: true, force: true });

let clientReady = false;
let serverReady = false;
let serverChanged = false;
let installedOnce = false;
let syncTimer = null;

/** Подпись `dist/` последней УСТАНОВЛЕННОЙ сборки (см. {@link distSignature}). */
let installedSignature = null;

/**
 * Подпись содержимого `dist/`: SHA-256 по всем файлам (путь + содержимое).
 *
 * Нужна, чтобы отличить настоящую правку от повторного срабатывания сторожей.
 * Их несколько (Vite, esbuild, файловый watcher), на одно сохранение приходит
 * два-три сигнала, и без сверки содержимого страница перезагружалась бы дважды
 * подряд. Считается по паре мегабайт — единицы миллисекунд.
 *
 * @param dir - папка сборки
 * @returns hex-строка SHA-256
 */
function distSignature(dir) {
  const hash = crypto.createHash('sha256');

  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      hash.update(path.relative(dir, full).replace(/\\/g, '/'));
      hash.update('\0');
      hash.update(readFileSync(full));
      hash.update('\0');
    }
  };

  walk(dir);

  return hash.digest('hex');
}

/**
 * Собирает `dist/` в кучу и кладёт в приложение: манифест и данные, проверка
 * бандла, копирование, подтверждение доверия, штамп для автоперезагрузки.
 *
 * Порядок важен: штамп пишется ПОСЛЕДНИМ. Страница перезагружается по нему, а
 * значит увидит новый код только когда все файлы дописаны и доверие подтверждено.
 */
function syncToApp() {
  const startedAt = process.hrtime.bigint();

  try {
    copyManifestAndData(ROOT, DIST);
    assertDistComplete(DIST);
  } catch (error) {
    log(`✗ ${error.message}`);

    return;
  }

  // Сборка вышла ровно такой же (сторож сработал повторно, либо правка на
  // результат не влияет) — ставить нечего, и главное, нечего перезагружать.
  const signature = distSignature(DIST);

  if (signature === installedSignature) {
    serverChanged = false;

    return;
  }

  // Негодный бандл в приложение не кладём: система молча не поднимется, и искать
  // причину придётся в devtools вместо этой строки.
  const { problems } = inspectClientBundle(
    readFileSync(path.join(DIST, 'client.js'), 'utf-8'),
  );

  if (problems.length > 0) {
    log(`✗ бандл не годен, установка пропущена:\n${problems
      .map((problem) => `        • ${problem}`)
      .join('\n')}`);

    return;
  }

  try {
    // Первая установка — заменой папки целиком (атомарный rename): так уходит
    // мусор от прежней сборки. Дальше — копированием поверх, чтобы не оставлять
    // окна, в котором папки системы нет и раздача отдаёт 404.
    if (installedOnce) {
      syncSystemDir(DIST, targetDir);
    } else {
      replaceSystemDir(DIST, dataPath, systemId);
      installedOnce = true;
    }

    if (!noReload) {
      appendFileSync(
        path.join(targetDir, 'client.js'),
        createReloadSnippet(systemId),
        'utf-8',
      );
    }

    confirmTrust(dataPath, targetDir, systemId, manifest.version);

    writeFileSync(
      path.join(targetDir, STAMP_FILENAME),
      `${JSON.stringify({ builtAt: new Date().toISOString() })}\n`,
      'utf-8',
    );

    installedSignature = signature;
  } catch (error) {
    log(`✗ ${error.message}`);

    return;
  }

  const ms = Number((process.hrtime.bigint() - startedAt) / 1000000n);

  log(
    `✓ установлено за ${ms} мс`
      + (noReload ? ' — обновите страницу (F5)' : ' — страница перезагрузится сама'),
  );

  if (serverChanged) {
    log(
      '⚠ менялась СЕРВЕРНАЯ часть — перезагрузка страницы её не подхватит: '
        + 'приложение импортирует index.js один раз за запуск, нужен перезапуск VTTG',
    );

    serverChanged = false;
  }
}

/**
 * Ставит установку в очередь, склеивая близкие пересборки в одну.
 *
 * @param delayMs - сколько ждать перед установкой (см. константы задержек)
 */
function scheduleSync(delayMs = SYNC_DEBOUNCE_MS) {
  // Пока не отработали ОБЕ сборки, в `dist/` нет половины файлов — установка
  // упала бы на проверке комплектности.
  if (!clientReady || !serverReady) {
    return;
  }

  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncToApp, delayMs);
}

log(`система ${systemId} ${manifest.version}`);
log(`данные VTTG: ${dataPath}`);
log('первая сборка…');

// --- Клиент: инкрементальная сборка Vite тем же конфигом, что и релизная.
const clientWatcher = await viteBuild({
  configFile: path.join(ROOT, 'vite.config.ts'),
  logLevel: 'warn',
  build: {
    watch: {},
    emptyOutDir: false,
  },
});

clientWatcher.on('event', (event) => {
  if (event.code === 'END') {
    clientReady = true;
    scheduleSync();
  }

  if (event.code === 'ERROR') {
    log(`✗ клиент не собрался: ${event.error?.message ?? event.error}`);
  }

  // Rollup держит открытым дескриптор бандла до `result.close()`.
  if (event.result) {
    void event.result.close();
  }
});

// --- Сервер: та же конфигурация esbuild, что у разовой сборки.
const serverContext = await context({
  ...createServerBuildOptions(ROOT),
  logLevel: 'warning',
  plugins: [
    {
      name: 'dev-notify',
      setup(builder) {
        builder.onEnd((result) => {
          if (result.errors.length > 0) {
            log(`✗ сервер не собрался: ${result.errors.length} ошибок`);

            return;
          }

          // Первую сборку сервером «изменением» не считаем — иначе при каждом
          // старте watch печаталось бы предупреждение о перезапуске VTTG.
          if (serverReady) {
            serverChanged = true;
          }

          serverReady = true;
          scheduleSync();
        });
      },
    },
  ],
});

await serverContext.watch();

// --- Данные и манифест: в графы сборок они не входят, следим сами.
const dataWatchers = [
  watch(path.join(ROOT, 'src', 'engine'), { recursive: true }, (_event, file) => {
    if (file && isDataFile(file)) {
      scheduleSync(DATA_DEBOUNCE_MS);
    }
  }),
  watch(path.join(ROOT, 'system.json'), () => {
    scheduleSync(DATA_DEBOUNCE_MS);
  }),
];

/**
 * Останавливает watch-режим, освобождая дескрипторы сборок.
 *
 * @param signal - сигнал, по которому уходим
 */
async function shutdown(signal) {
  log(`остановка (${signal})`);

  for (const watcher of dataWatchers) {
    watcher.close();
  }

  await clientWatcher.close();
  await serverContext.dispose();

  if (!noReload) {
    log(
      'в установленной копии остался dev-автоперезагрузчик — '
        + '`npm run install:local` вернёт чистую сборку',
    );
  }

  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
