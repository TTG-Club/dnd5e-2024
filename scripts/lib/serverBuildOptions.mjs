/**
 * Настройки esbuild для СЕРВЕРНОЙ части системы — единым местом для разовой
 * сборки (`scripts/build-server.mjs`) и watch-режима (`scripts/dev.mjs`).
 *
 * Разъезд этих настроек между dev и релизом означал бы, что в приложении
 * исполняется не тот код, который уедет пользователю, — а именно ради
 * «правлю и сразу вижу» watch и заводится. Поэтому опции ровно одни.
 */
import path from 'node:path';

/** Рантайм-зависимости приложения — в бандл системы попадать не должны. */
const EXTERNAL_DEPS = [
  'better-sqlite3',
  'sharp',
  'ffmpeg-static',
  'ffprobe-static',
  'fluent-ffmpeg',
  'ws',
  'h3',
  '@silentbot1/nat-api',
];

/**
 * Собирает опции esbuild для `dist/index.js`.
 *
 * @param root - корень репозитория
 * @returns объект опций для `build()` или `context()`
 */
export function createServerBuildOptions(root) {
  return {
    entryPoints: [path.join(root, 'src', 'server', 'index.ts')],
    outfile: path.join(root, 'dist', 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    // ОБЯЗАТЕЛЬНО: значение фиксирует семантику полей класса (`[[Define]]` против
    // `[[Set]]`) — она разная при наследовании, а `src/server` расширяет класс
    // системы. Раньше флаг не задавался, и esbuild брал свой дефолт `true`; `true`
    // здесь — ровно он, записанный явно.
    //
    // Явно он нужен потому, что `tsconfig.json` в корне существует ради редактора
    // и объявляет `target: ESNext`. Без этой строки esbuild вывел бы флаг из того
    // `target` — то есть настройка РЕДАКТОРА меняла бы серверный бандл. Клиентская
    // сборка закрывает то же место своим `tsconfigRaw` в `vite.config.ts`, но
    // противоположным значением: у Vite исторический дефолт `false`.
    tsconfigRaw: {
      compilerOptions: {
        useDefineForClassFields: true,
      },
    },
    external: EXTERNAL_DEPS,
    alias: {
      // Движок правил и нейтральное ядро живут в этой же репе (SDK ещё не
      // опубликован отдельным пакетом — см. README).
      '@vtt/shared/system/dnd.js': path.join(root, 'src', 'engine', 'index.ts'),
      '@vtt/shared': path.join(root, 'sdk', 'index.ts'),
    },
  };
}
