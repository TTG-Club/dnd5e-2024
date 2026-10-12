/**
 * Режим разработки: плагин Vite, с которым dev-сервер системы отдаёт исходники
 * прямо в приложение (`npm run dev:hot`; со стороны приложения —
 * `docs/CREATING_USER_SYSTEM.md` §2.3 в его репозитории).
 *
 * Основа — `docs/examples/minimal-system/devHostModules.js` из репозитория
 * приложения: приложение отдаёт его авторам систем текстом, пакета нет. Отличий
 * от образца два: следим не за списком файлов, а за папками (серверная часть и
 * общий с ней движок), и модули из `node_modules` тоже переписываем — иначе
 * зависимость, которая сама импортирует `vue`, принесла бы на страницу вторую
 * копию Vue.
 *
 * Плагин работает только в `vite` (dev-сервер) и в сборку не попадает.
 *
 * Зачем он нужен. В собранном `client.js` модули приложения (`vue`, `@/…`,
 * `pinia`…) подставляет сборщик: они объявлены внешними и берутся из
 * `globalThis`. Dev-сервер ничего не собирает — он отдаёт каждый файл отдельным
 * ES-модулем, и браузер сам пошёл бы искать `vue` или `@/stores/worldStore` по
 * сети. Плагин переписывает такие импорты на обращение к тем же объектам
 * приложения:
 *
 *   import { computed } from 'vue';
 *   → const { computed } = globalThis.Vue;
 *
 *   import { useWorldStore } from '@/stores/worldStore';
 *   → const { useWorldStore } = globalThis.__VTTHost['@/stores/worldStore'];
 *
 * Второе дело плагина — честно сказать про серверную часть: её dev-сервер не
 * обновляет, и о правке такого файла плагин сообщает в терминал и на страницу.
 */
import path from 'node:path';

import { parseAst } from 'vite';

/** Имя служебной функции, которой переписанный код достаёт модуль приложения. */
const HOST_ACCESSOR = '__vttgHostModule';

/**
 * Код служебной функции. Она нужна ради понятной ошибки: модуль, которого
 * приложение не отдаёт, без неё выглядел бы как `Cannot destructure property`
 * где-то в глубине компонента.
 *
 * Объявление занимает одну строку и встаёт в начало первой строки модуля — так
 * номера строк остального кода не сдвигаются.
 */
const HOST_ACCESSOR_CODE =
  `const ${HOST_ACCESSOR} = (id, read) => { const hostModule = read(); `
  + 'if (!hostModule) { throw new Error("Приложение не отдаёт модуль «" + id + "». '
  + 'Список модулей — docs/HOST_API.md приложения; страницу нужно открывать в dev-сборке VTTG."); } '
  + 'return hostModule; }; ';

/**
 * Имя из записи импорта или экспорта: обычное либо строковое (`"имя с пробелом"`).
 *
 * @param {{ type: string, name?: string, value?: unknown }} node - узел имени
 * @returns {string} имя, пригодное для записи в деструктуризации
 */
function readName(node) {
  return node.type === 'Identifier' ? node.name : JSON.stringify(node.value);
}

/**
 * Обходит дерево разбора и зовёт `visit` для каждого узла.
 *
 * @param {unknown} node - узел или значение поля узла
 * @param {(node: { type: string }) => void} visit - обработчик узла
 */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, visit);
    }

    return;
  }

  if (typeof node !== 'object' || node === null) {
    return;
  }

  if (typeof node.type === 'string') {
    visit(node);
  }

  for (const value of Object.values(node)) {
    walk(value, visit);
  }
}

/**
 * Переписывает импорты модулей приложения на обращение к его объектам.
 *
 * @param {string} code - код модуля (уже JavaScript)
 * @param {object} options - настройки
 * @param {(id: string) => boolean} options.isHostModule - берётся ли модуль у приложения
 * @param {(id: string) => string} options.hostGlobal - выражение, которым он достаётся
 * @returns {string | null} новый код либо `null`, если менять нечего
 */
export function rewriteHostImports(code, { isHostModule, hostGlobal }) {
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];

  let counter = 0;

  /**
   * Выражение, которым переписанный код достаёт модуль приложения.
   *
   * @param {string} id - спецификатор импорта
   * @returns {string} вызов служебной функции
   */
  const access = (id) =>
    `${HOST_ACCESSOR}(${JSON.stringify(id)}, () => ${hostGlobal(id)})`;

  /**
   * Запоминает замену куска кода. Число строк сохраняется, чтобы номера строк
   * в ошибках и в отладчике совпадали с исходником.
   *
   * @param {{ start: number, end: number }} node - заменяемый узел
   * @param {string} text - новый код
   */
  const replace = (node, text) => {
    const lineBreaks = code.slice(node.start, node.end).split('\n').length - 1;

    edits.push({
      start: node.start,
      end: node.end,
      text: text + '\n'.repeat(lineBreaks),
    });
  };

  walk(parseAst(code), (node) => {
    // import('@/…') — модуль уже загружен приложением, отдаём его промисом.
    if (
      node.type === 'ImportExpression'
      && node.source.type === 'Literal'
      && isHostModule(node.source.value)
    ) {
      replace(node, `Promise.resolve(${access(node.source.value)})`);

      return;
    }

    if (!node.source || !isHostModule(node.source.value)) {
      return;
    }

    const id = node.source.value;

    if (node.type === 'ExportAllDeclaration') {
      throw new Error(
        `«export * from '${id}'» в режиме разработки не поддерживается — перечислите имена: export { a, b } from '${id}'.`,
      );
    }

    if (node.type === 'ImportDeclaration') {
      const namespace = node.specifiers.find(
        (specifier) => specifier.type === 'ImportNamespaceSpecifier',
      );

      const names = node.specifiers
        .filter((specifier) => specifier.type !== 'ImportNamespaceSpecifier')
        .map((specifier) =>
          specifier.type === 'ImportDefaultSpecifier'
            ? `default: ${specifier.local.name}`
            : `${readName(specifier.imported)}: ${specifier.local.name}`,
        );

      const statements = [
        namespace ? `const ${namespace.local.name} = ${access(id)};` : '',
        names.length > 0
          ? `const { ${names.join(', ')} } = ${access(id)};`
          : '',
      ].filter(Boolean);

      // `import '@/…'` без имён: модуль приложения уже исполнен, делать нечего.
      replace(node, statements.join(' '));

      return;
    }

    // export { a, b as c } from '@/…'
    if (node.type === 'ExportNamedDeclaration') {
      const locals = node.specifiers.map((specifier) => {
        counter += 1;

        return {
          local: `__vttgReexport${counter}`,
          imported: readName(specifier.local),
          exported: readName(specifier.exported),
        };
      });

      const bindings = locals
        .map((entry) => `${entry.imported}: ${entry.local}`)
        .join(', ');

      const exports = locals
        .map((entry) => `${entry.local} as ${entry.exported}`)
        .join(', ');

      replace(
        node,
        `const { ${bindings} } = ${access(id)}; export { ${exports} };`,
      );
    }
  });

  if (edits.length === 0) {
    return null;
  }

  // С конца к началу — чтобы позиции ещё не обработанных замен не съезжали.
  const rewritten = edits
    .toSorted((first, second) => second.start - first.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      code,
    );

  return HOST_ACCESSOR_CODE + rewritten;
}

/**
 * Часть системы, правку которой dev-сервер до приложения не доносит.
 *
 * @typedef {object} StalePart
 * @property {string} name - имя части; уходит на страницу в событии
 * @property {string[]} paths - файлы и папки части (от корня проекта)
 * @property {string} notice - что сказать автору в терминале
 */

/**
 * Находит часть системы, к которой относится изменённый файл.
 *
 * @param {string} root - корень проекта
 * @param {StalePart[]} staleParts - части, за которыми следим
 * @param {string} changedPath - абсолютный путь изменённого файла
 * @returns {{ part: StalePart, file: string } | null} часть и путь файла от корня
 */
export function findStalePart(root, staleParts, changedPath) {
  const file = path.relative(root, changedPath).replaceAll('\\', '/');

  const part = staleParts.find((candidate) =>
    candidate.paths.some(
      (watchedPath) =>
        file === watchedPath || file.startsWith(`${watchedPath}/`),
    ),
  );

  return part ? { part, file } : null;
}

/**
 * Плагин Vite для режима разработки системы.
 *
 * @param {object} options - настройки
 * @param {(id: string) => boolean} options.isHostModule - берётся ли модуль у приложения
 * @param {(id: string) => string} options.hostGlobal - выражение, которым он достаётся
 * @param {StalePart[]} options.staleParts - части системы, которые dev-сервер не обновляет
 * @param {string} options.staleEvent - имя события для страницы
 * @returns {import('vite').Plugin} плагин
 */
export function devHostModules({
  isHostModule,
  hostGlobal,
  staleParts,
  staleEvent,
}) {
  return {
    name: 'vttg-dev-host-modules',
    apply: 'serve',
    // После остальных плагинов: к этому моменту `.vue` и TypeScript уже стали
    // обычным JavaScript, а импорты в нём ещё не тронуты dev-сервером.
    enforce: 'post',
    transform(code) {
      if (!code.includes('import')) {
        return null;
      }

      const rewritten = rewriteHostImports(code, { isHostModule, hostGlobal });

      // Карту исходников не трогаем: число строк сохранено.
      return rewritten === null ? null : { code: rewritten, map: null };
    },
    configureServer(server) {
      const { root } = server.config;

      server.watcher.add(
        staleParts.flatMap((part) =>
          part.paths.map((watchedPath) => path.resolve(root, watchedPath)),
        ),
      );

      server.watcher.on('change', (changedPath) => {
        const stale = findStalePart(root, staleParts, changedPath);

        if (!stale) {
          return;
        }

        server.config.logger.warn(
          `[система] ${stale.file}: ${stale.part.notice}`,
          { timestamp: true },
        );

        server.ws.send({
          type: 'custom',
          event: staleEvent,
          data: { part: stale.part.name, file: stale.file },
        });
      });
    },
  };
}
