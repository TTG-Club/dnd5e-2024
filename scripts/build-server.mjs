import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Сборка СЕРВЕРНОЙ части системы: единый ESM-бандл `dist/index.js`.
 *
 * Движок правил инлайнится. Нейтральное ядро `@vtt/shared` — нет: его отдаёт
 * приложение (VTTG 0.9.503+), тот же экземпляр, что исполняет сервер. Это
 * единственная зависимость серверной части от приложения; из-за неё
 * `compatibility.minimum` в `system.json` не ниже 0.9.503 — на старом VTTG
 * импорт падает с `ERR_MODULE_NOT_FOUND`. Серверные рантайм-библиотеки
 * приложения (better-sqlite3 и пр.) тоже внешние — система их не использует,
 * список нужен лишь как страховка от случайного втягивания.
 *
 * Сами опции живут в `scripts/lib/serverBuildOptions.mjs` — их разделяет
 * watch-режим (`scripts/dev.mjs`), чтобы в приложении исполнялся ровно тот код,
 * который уедет в релиз.
 */
import { build } from 'esbuild';

import { inspectServerBundle } from './lib/bundleChecks.mjs';
import { createServerBuildOptions } from './lib/serverBuildOptions.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const result = await build({
  ...createServerBuildOptions(ROOT),
  logLevel: 'info',
});

// Страж (см. scripts/lib/bundleChecks.mjs): копия ядра в бандле или подпуть,
// которого приложение не отдаёт, всплывают только при загрузке мира — ловим здесь.
const { problems, hostImports } = inspectServerBundle(result.metafile, ROOT);

if (problems.length > 0) {
  console.error(
    `\n[build-server] dist/index.js собран, но НЕ ГОДЕН:\n${problems
      .map((problem) => `  • ${problem}`)
      .join('\n')}\n`,
  );

  process.exit(1);
}

console.log(
  `[build-server] dist/index.js готов, от приложения: ${
    hostImports.length > 0 ? hostImports.join(', ') : 'ничего'
  }`,
);
