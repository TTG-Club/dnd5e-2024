/**
 * Контракт модулей хоста глазами системы: что наши бандлы просят у приложения
 * и отдаёт ли оно это.
 *
 * Приложение (VTTG 0.9.683+) держит список отдаваемых модулей в одном манифесте
 * — `packages/shared/host-contract.json`, справочник по нему — `docs/HOST_API.md`
 * в его репозитории. Здесь две опоры на этот список:
 *
 * 1. Блок `hostContract` в `dist/system.json`. По нему приложение ещё ДО запуска
 *    нашего кода понимает, хватает ли ему модулей, и отказывает с понятной
 *    причиной вместо падения бандла на `undefined`. Старые версии приложения
 *    блок не читают.
 * 2. Сверка при сборке. Если рядом лежит чекаут приложения (`../vttg` — тот же,
 *    откуда берутся типы), бандл, который просит модуль вне контракта, сборку
 *    не проходит. Без чекаута (сборка релиза на GitHub) сверка пропускается —
 *    там остаётся отказ самого приложения по блоку из пункта 1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { inspectClientBundle } from './bundleChecks.mjs';
import { HOST_SHARED_PACKAGE } from './serverBuildOptions.mjs';

/**
 * Версия контракта, под которую собрана система. Приложение с другой старшей
 * цифрой или с более старым контрактом откажется её загружать.
 */
export const HOST_CONTRACT_VERSION = '1.0.0';

/** Манифест контракта в соседнем чекауте приложения (относительно корня). */
const HOST_CONTRACT_MANIFEST = '../vttg/packages/shared/host-contract.json';

/** Модуль, который приложение отдаёт глобалом `globalThis.Vue`, а не реестром. */
const VUE_MODULE = 'vue';

/** Сколько модулей назвать в сообщении — остальное числом. */
const LISTED_MODULES = 3;

/** Запись модуля в контракте приложения. */
const hostModuleEntrySchema = z.object({
  id: z.string(),
  since: z.string(),
  deprecated: z
    .object({ since: z.string(), replacement: z.string().optional() })
    .optional(),
});

/** Манифест контракта приложения — в объёме, который читает сверка. */
const hostContractSchema = z.object({
  contractVersion: z.string(),
  clientGlobals: z.array(hostModuleEntrySchema),
  client: z.array(hostModuleEntrySchema),
  server: z.array(hostModuleEntrySchema),
});

/**
 * Спецификаторы ядра, которые серверный бандл импортирует у приложения.
 *
 * Читается текст бандла, а не `metafile`: имена модулей в инструкциях `import`
 * переживают минификацию, а функция нужна и там, где графа сборки под рукой нет.
 *
 * @param serverBundle - содержимое `dist/index.js`
 * @returns спецификаторы без повторов, по алфавиту
 */
export function collectServerHostImports(serverBundle) {
  const pattern = /(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g;

  return [
    ...new Set(
      [...serverBundle.matchAll(pattern)]
        .map((match) => match[1])
        .filter(
          (specifier) =>
            specifier === HOST_SHARED_PACKAGE
            || specifier.startsWith(`${HOST_SHARED_PACKAGE}/`),
        ),
    ),
  ].sort();
}

/**
 * Что бандлы системы просят у приложения.
 *
 * @param clientBundle - содержимое `dist/client.js`
 * @param serverBundle - содержимое `dist/index.js`
 * @returns спецификаторы клиента и сервера, по алфавиту
 */
export function collectHostRequirements(clientBundle, serverBundle) {
  const registryModules = inspectClientBundle(clientBundle).hostModules;

  // `vue` в реестр хоста не входит — бандл берёт его из `globalThis.Vue`.
  const client = clientBundle.includes('globalThis.Vue')
    ? [...registryModules, VUE_MODULE]
    : registryModules;

  return {
    client: [...client].sort(),
    server: collectServerHostImports(serverBundle),
  };
}

/**
 * Читает манифест контракта из соседнего чекаута приложения.
 *
 * @param root - корень репозитория системы
 * @returns манифест либо `null`, если чекаута приложения рядом нет
 */
export function readHostContract(root) {
  const manifestPath = path.resolve(root, HOST_CONTRACT_MANIFEST);

  if (!existsSync(manifestPath)) {
    return null;
  }

  // Манифест — чужой файл: проверяем его форму, прежде чем по нему судить о
  // сборке. Иначе изменённый формат дал бы падение скрипта без объяснения.
  const parsed = hostContractSchema.safeParse(
    JSON.parse(readFileSync(manifestPath, 'utf-8')),
  );

  if (!parsed.success) {
    throw new Error(
      `манифест контракта приложения ${manifestPath} не разбирается`
        + ' — формат изменился, сверку нужно обновить (scripts/lib/hostContract.mjs)',
    );
  }

  return parsed.data;
}

/**
 * Сокращает длинный список до нескольких имён и счётчика остатка.
 *
 * @param modules - что перечислить
 * @returns строка для сообщения
 */
function summarize(modules) {
  const rest = modules.length - LISTED_MODULES;

  return `${modules.slice(0, LISTED_MODULES).join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`;
}

/**
 * Сверяет запросы системы с контрактом приложения.
 *
 * @param requirements - что просят бандлы (см. {@link collectHostRequirements})
 * @param contract - манифест контракта приложения
 * @returns `{ problems, warnings }`: модули вне контракта — претензии,
 *   устаревшие модули — замечания
 */
export function inspectHostRequirements(requirements, contract) {
  const clientEntries = [...contract.client, ...contract.clientGlobals];
  const problems = [];

  const sides = [
    { label: 'клиент', requested: requirements.client, entries: clientEntries },
    {
      label: 'сервер',
      requested: requirements.server,
      entries: contract.server,
    },
  ];

  for (const side of sides) {
    const known = new Set(side.entries.map((entry) => entry.id));
    const outside = side.requested.filter((id) => !known.has(id));

    if (outside.length > 0) {
      problems.push(
        `${side.label} просит у приложения модули, которых нет в его контракте: ${summarize(outside)}`
          + ' — приложение откажется открывать мир на такой сборке',
      );
    }
  }

  const warnings = sides.flatMap((side) =>
    side.entries
      .filter((entry) => entry.deprecated && side.requested.includes(entry.id))
      .map(
        (entry) =>
          `модуль приложения ${entry.id} устарел с VTTG ${entry.deprecated.since} и будет убран`
          + `${entry.deprecated.replacement ? ` — перейти на ${entry.deprecated.replacement}` : ''}`,
      ),
  );

  return { problems, warnings };
}

/**
 * Вписывает в `dist/system.json` блок `hostContract` — что система просит у
 * приложения. Исходный `system.json` в корне не трогается.
 *
 * @param dist - папка сборки с готовыми `client.js`, `index.js` и `system.json`
 * @returns вписанные требования
 */
export function stampHostRequirements(dist) {
  const manifestPath = path.join(dist, 'system.json');

  const requirements = collectHostRequirements(
    readFileSync(path.join(dist, 'client.js'), 'utf-8'),
    readFileSync(path.join(dist, 'index.js'), 'utf-8'),
  );

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        hostContract: { version: HOST_CONTRACT_VERSION, ...requirements },
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  return requirements;
}
