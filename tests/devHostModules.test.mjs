import assert from 'node:assert/strict';
import path from 'node:path';

import { describe, it } from 'vitest';

import {
  findStalePart,
  rewriteHostImports,
} from '../scripts/lib/devHostModules.mjs';

/**
 * Режим разработки (`npm run dev:hot`): dev-сервер системы отдаёт исходники прямо в
 * приложение, и плагин переписывает импорты модулей приложения на обращение к
 * его объектам. Ошибка здесь не падает сборкой — она всплывает в браузере: либо
 * на страницу приезжает вторая копия Vue, либо модуль приложения приходит
 * `undefined`. Поэтому переписывание проверяется по тексту.
 */

/** Модули, которые в тестах считаются модулями приложения */
const HOST_MODULES = new Set(['vue', 'pinia', '@/stores/worldStore']);

/** Настройки плагина — как в `vite.config.ts` */
const OPTIONS = {
  isHostModule: (id) => HOST_MODULES.has(id),
  hostGlobal: (id) =>
    id === 'vue'
      ? 'globalThis.Vue'
      : `globalThis.__VTTHost[${JSON.stringify(id)}]`,
};

/**
 * Переписывает код и возвращает его без служебной функции в начале.
 *
 * @param {string} code - исходный код модуля
 * @returns {string} переписанный код
 */
function rewrite(code) {
  const rewritten = rewriteHostImports(code, OPTIONS);

  assert.ok(rewritten, 'код должен быть переписан');

  return rewritten.slice(rewritten.indexOf('}; ') + 3);
}

describe('переписывание импортов модулей приложения', () => {
  it('именованный импорт из vue берётся из globalThis.Vue', () => {
    const code = rewrite("import { computed, ref as vueRef } from 'vue';");

    assert.match(code, /const \{ computed: computed, ref: vueRef \} = /);
    assert.match(code, /globalThis\.Vue\)/);
    assert.doesNotMatch(code, /from 'vue'/);
  });

  it('модуль @/… берётся из реестра приложения по тому же имени', () => {
    const code = rewrite(
      "import { useWorldStore } from '@/stores/worldStore';",
    );

    assert.match(code, /globalThis\.__VTTHost\["@\/stores\/worldStore"\]/);
  });

  it('импорт по умолчанию читает поле default', () => {
    const code = rewrite("import Store from '@/stores/worldStore';");

    assert.match(code, /const \{ default: Store \} = /);
  });

  it('импорт пространства имён отдаёт модуль целиком', () => {
    const code = rewrite("import * as Pinia from 'pinia';");

    assert.match(code, /const Pinia = __vttgHostModule\("pinia"/);
  });

  it('динамический импорт становится готовым промисом', () => {
    const code = rewrite("const store = await import('@/stores/worldStore');");

    assert.match(code, /await Promise\.resolve\(__vttgHostModule\(/);
    assert.doesNotMatch(code, /import\('@/);
  });

  it('реэкспорт сохраняет имена', () => {
    const code = rewrite("export { storeToRefs as toRefs } from 'pinia';");

    assert.match(code, /export \{ __vttgReexport1 as toRefs \}/);
  });

  it('свои и чужие модули не трогает', () => {
    assert.equal(
      rewriteHostImports(
        "import { z } from 'zod';\nimport { helper } from './helper';",
        OPTIONS,
      ),
      null,
    );
  });

  it('число строк сохраняется — номера строк в ошибках не съезжают', () => {
    const source = [
      'import {',
      '  computed,',
      '  ref,',
      "} from 'vue';",
      'export const marker = 1;',
    ].join('\n');

    const rewritten = rewriteHostImports(source, OPTIONS);

    assert.equal(rewritten.split('\n').length, source.split('\n').length);
    assert.equal(rewritten.split('\n')[4], 'export const marker = 1;');
  });

  it('export * из модуля приложения — понятная ошибка, а не тихая поломка', () => {
    assert.throws(
      () => rewriteHostImports("export * from 'pinia';", OPTIONS),
      /не поддерживается/,
    );
  });
});

describe('части системы, которые dev-сервер не обновляет', () => {
  /** Корень проекта в тестах */
  const ROOT = path.resolve('project');

  /** Части — как в `vite.config.ts` */
  const PARTS = [
    { name: 'server', paths: ['src/server', 'system.json'], notice: '' },
    { name: 'engine', paths: ['src/engine'], notice: '' },
  ];

  it('файл в папке сервера и манифест — серверная часть', () => {
    const serverFile = findStalePart(
      ROOT,
      PARTS,
      path.join(ROOT, 'src', 'server', 'index.ts'),
    );

    const manifest = findStalePart(ROOT, PARTS, path.join(ROOT, 'system.json'));

    assert.equal(serverFile?.part.name, 'server');
    assert.equal(manifest?.part.name, 'server');
  });

  it('файл движка — движок, путь отдаётся от корня с прямыми слэшами', () => {
    const stale = findStalePart(
      ROOT,
      PARTS,
      path.join(ROOT, 'src', 'engine', 'effects', 'apply.ts'),
    );

    assert.equal(stale?.part.name, 'engine');
    assert.equal(stale?.file, 'src/engine/effects/apply.ts');
  });

  it('клиентский файл и папка с похожим именем ни к чему не относятся', () => {
    assert.equal(
      findStalePart(ROOT, PARTS, path.join(ROOT, 'src', 'client', 'a.vue')),
      null,
    );

    assert.equal(
      findStalePart(ROOT, PARTS, path.join(ROOT, 'src', 'engine-old', 'a.ts')),
      null,
    );
  });
});
