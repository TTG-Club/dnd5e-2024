import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

/** Корень проверяемой системы определяется расположением тестов. */
export const systemRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Нейтральное ядро `@vtt/shared` для тестовых бандлов — исходник из соседнего
 * чекаута монорепы VTTG. Своей копии ядра у системы нет: в рантайме его отдаёт
 * приложение, поэтому и тесты собираются с настоящим ядром, а не с копией.
 */
export const hostSharedEntry = join(
  systemRoot,
  '../vttg/packages/shared/index.ts',
);

/**
 * Загружает настоящий движок с нейтральным ядром хоста для тестов правил.
 * @param {string} contents - Экспорты проверяемых модулей движка.
 * @returns {Promise<Record<string, unknown>>} Экспорты собранного модуля.
 */
export async function loadEngineBundle(contents) {
  const bundle = await build({
    stdin: {
      contents,
      resolveDir: systemRoot,
      sourcefile: 'engine-test-entry.ts',
      loader: 'ts',
    },
    alias: { '@vtt/shared': hostSharedEntry },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  });

  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  );
}
