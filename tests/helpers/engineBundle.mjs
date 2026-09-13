import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

/** Корень проверяемой системы определяется расположением тестов. */
export const systemRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Загружает настоящий движок с нейтральными SDK-типами для тестов правил.
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
    alias: { '@vtt/shared': join(systemRoot, 'sdk/index.ts') },
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
