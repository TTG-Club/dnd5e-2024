/**
 * Сборка СЕРВЕРНОЙ части системы: единый самодостаточный ESM-бандл `dist/index.js`.
 *
 * Нейтральное ядро (`@vtt/shared`) и движок правил инлайнятся, поэтому папка
 * системы не зависит от `node_modules` приложения. Серверные рантайм-библиотеки
 * приложения (better-sqlite3 и пр.) остаются внешними — система их не использует,
 * список нужен лишь как страховка от случайного втягивания.
 *
 * Сами опции живут в `scripts/lib/serverBuildOptions.mjs` — их разделяет
 * watch-режим (`scripts/dev.mjs`), чтобы в приложении исполнялся ровно тот код,
 * который уедет в релиз.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServerBuildOptions } from './lib/serverBuildOptions.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({ ...createServerBuildOptions(ROOT), logLevel: 'info' });

console.log('[build-server] dist/index.js готов');
