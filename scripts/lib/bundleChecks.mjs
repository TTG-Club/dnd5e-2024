/**
 * Проверки собранных бандлов: `dist/client.js` и `dist/index.js`.
 *
 * Все дефекты, которые здесь ловятся, проявляются ТОЛЬКО в приложении —
 * асинхронно и с сообщениями, по которым причину не угадать. Поэтому проверка
 * стоит в сборке — и в релизной (`scripts/build.mjs`, `scripts/build-server.mjs`),
 * и в watch-режиме (`scripts/dev.mjs`): в dev она особенно важна, потому что
 * негодный бандл нельзя подкладывать в приложение молча — иначе вместо ошибки
 * сборки получишь пустое окно и час в devtools.
 */
import path from 'node:path';

import { HOST_SHARED_PACKAGE } from './serverBuildOptions.mjs';

/**
 * Подпути ядра, которые приложение отдаёт серверному коду системы, — поле
 * `exports` пакета `@vtt/shared` (VTTG 0.9.503). Любой другой подпуть Node
 * отвергает с `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 */
const HOST_SHARED_SUBPATHS = [
  'wsEvents.js',
  'wsProtocol.js',
  'wsClient.js',
  'types/index.js',
  'constants/permissions.js',
  'initiativeUtils.js',
  'assetPaths.js',
];

/** Сколько файлов копии ядра показать в сообщении — остальное числом. */
const LISTED_COPY_FILES = 3;

/**
 * Разбирает клиентский бандл: что он просит у приложения и годен ли вообще.
 *
 * @param bundle - содержимое `dist/client.js`
 * @returns `{ problems, hostModules }` — список претензий (пустой = годен) и
 *   спецификаторы, которые бандл резолвит из `globalThis.__VTTHost`
 */
export function inspectClientBundle(bundle) {
  /** Что именно бандл просит у приложения через реестр модулей хоста. */
  const hostModules = [
    ...new Set(
      [...bundle.matchAll(/__VTTHost\["([^"]+)"\]/g)].map((match) => match[1]),
    ),
  ];

  const problems = [];

  if (/process\.env/.test(bundle)) {
    problems.push(
      'в бандле остались обращения к process.env — в браузере это ReferenceError '
        + 'ещё до регистрации системы (нужен define в vite.config.ts)',
    );
  }

  if (!/VTTSystems\.register/.test(bundle)) {
    problems.push(
      'бандл не вызывает VTTSystems.register — система не поднимется',
    );
  }

  if (/reka-ui/.test(bundle)) {
    problems.push(
      'в бандл попала вторая копия reka-ui — окна приложения будут падать в setup '
        + '(нужен components.exclude у плагина ui())',
    );
  }

  const brokenDynamicImports = [
    ...new Set(
      [...bundle.matchAll(/import\("(@[^"]+)"\)/g)].map((match) => match[1]),
    ),
  ];

  if (brokenDynamicImports.length > 0) {
    problems.push(
      `динамические import() модулей приложения не переписаны: ${brokenDynamicImports.join(', ')}`
        + ' — в браузере они падают асинхронно (см. renderDynamicImport)',
    );
  }

  // Ассеты приложения — это ССЫЛКИ, а не модули: попав в реестр хоста, они
  // резолвятся в undefined и роняют отрисовку.
  const assetsInHostRegistry = hostModules.filter((id) => id.startsWith('/'));

  if (assetsInHostRegistry.length > 0) {
    problems.push(
      `в реестр модулей хоста попали ассеты: ${assetsInHostRegistry.join(', ')}`
        + ' — приложение их не отдаёт, будет «Cannot read properties of undefined»',
    );
  }

  return { problems, hostModules };
}

/**
 * Лежит ли входной файл сборки внутри копии ядра `@vtt/shared`: старой
 * вендорной папки `sdk/`, исходников монорепы (`…/packages/shared/…`) или
 * установленного пакета (`node_modules/@vtt/shared/…`).
 *
 * @param input - путь из `metafile.inputs` (относительно `root`)
 * @param root - корень репозитория
 * @returns `true`, если файл — часть копии ядра
 */
function isSharedCoreCopy(input, root) {
  const absolute = path.resolve(root, input).replace(/\\/g, '/');
  const relative = path.relative(root, absolute).replace(/\\/g, '/');

  return (
    relative.startsWith('sdk/')
    || absolute.includes('/packages/shared/')
    || absolute.includes(`/node_modules/${HOST_SHARED_PACKAGE}/`)
  );
}

/**
 * Разбирает граф серверной сборки: не вшита ли в неё копия ядра и просит ли
 * она у приложения только то, что оно отдаёт.
 *
 * Смотрит `metafile` esbuild, а не текст бандла: имена файлов в тексте живут
 * лишь в комментариях, и греп по ним ломается от первой же настройки минификации.
 *
 * @param metafile - `result.metafile` сборки `dist/index.js`
 * @param root - корень репозитория (`absWorkingDir` сборки)
 * @returns `{ problems, hostImports }` — список претензий (пустой = годен) и
 *   спецификаторы `@vtt/shared`, которые бандл импортирует у приложения
 */
export function inspectServerBundle(metafile, root) {
  const problems = [];

  const coreCopyFiles = Object.keys(metafile.inputs).filter((input) =>
    isSharedCoreCopy(input, root),
  );

  if (coreCopyFiles.length > 0) {
    const listed = coreCopyFiles.slice(0, LISTED_COPY_FILES).join(', ');
    const rest = coreCopyFiles.length - LISTED_COPY_FILES;

    problems.push(
      `в серверный бандл вшита копия ядра ${HOST_SHARED_PACKAGE}: ${listed}`
        + `${rest > 0 ? ` и ещё ${rest}` : ''}`
        + ' — сервер системы будет работать на своей, отстающей версии ядра, а'
        + ' клиент на ядре приложения, и собственный systemRegistry копии разойдётся'
        + ' с приложением (ядро должно быть external, без алиаса на копию)',
    );
  }

  const hostImports = [
    ...new Set(
      Object.values(metafile.outputs)
        .flatMap((output) => output.imports)
        .filter(
          (entry) =>
            entry.external
            && (entry.path === HOST_SHARED_PACKAGE
              || entry.path.startsWith(`${HOST_SHARED_PACKAGE}/`)),
        )
        .map((entry) => entry.path),
    ),
  ];

  const unexported = hostImports.filter(
    (specifier) =>
      specifier !== HOST_SHARED_PACKAGE
      && !HOST_SHARED_SUBPATHS.includes(
        specifier.slice(HOST_SHARED_PACKAGE.length + 1),
      ),
  );

  if (unexported.length > 0) {
    problems.push(
      `серверный бандл импортирует подпути ядра, которых приложение не отдаёт: ${unexported.join(', ')}`
        + ' — Node уронит загрузку index.js с ERR_PACKAGE_PATH_NOT_EXPORTED, и система'
        + ` не поднимется (доступны корень и ${HOST_SHARED_SUBPATHS.join(', ')})`,
    );
  }

  return { problems, hostImports };
}
