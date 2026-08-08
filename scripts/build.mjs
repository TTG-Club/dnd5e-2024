/**
 * Полная сборка папки системы, готовой к установке в VTTG.
 *
 * Результат `dist/`: `index.js` (сервер) + `client.js`/`client.css` (клиент) +
 * `system.json` + `data/` (справочники и компендиум). Ровно эту папку архивируют
 * в релиз, на который указывает поле `download` манифеста.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectClientBundle } from './lib/bundleChecks.mjs';
import { copyManifestAndData } from './lib/distAssets.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

/**
 * Запускает шаг сборки, прерывая всё при ненулевом коде выхода.
 *
 * @param command - исполняемая команда
 * @param args - аргументы
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 1. Клиент (vite создаёт dist/ заново — поэтому он первым).
run('npx', ['vite', 'build']);

// 2. Сервер.
run('node', ['scripts/build-server.mjs']);

// 3. Манифест системы + справочные данные и компендиум.
const dataFiles = copyManifestAndData(ROOT, DIST);

const clientSize = existsSync(path.join(DIST, 'client.js'))
  ? statSync(path.join(DIST, 'client.js')).size
  : 0;

const serverSize = existsSync(path.join(DIST, 'index.js'))
  ? statSync(path.join(DIST, 'index.js')).size
  : 0;

// Проверки собранного клиента (см. scripts/lib/bundleChecks.mjs): все дефекты
// проявляются ТОЛЬКО в браузере, асинхронно и с сообщениями, по которым причину
// не угадать, — поэтому ловим их здесь, до выкладки релиза.
const { problems, hostModules } = inspectClientBundle(
  readFileSync(path.join(DIST, 'client.js'), 'utf-8'),
);

if (problems.length > 0) {
  console.error(
    `\n[build] бандл собран, но НЕ ГОДЕН:\n${problems
      .map((problem) => `  • ${problem}`)
      .join('\n')}\n`,
  );

  process.exit(1);
}

console.log(
  `[build] готово: client.js ${Math.round(clientSize / 1024)}KB, `
    + `index.js ${Math.round(serverSize / 1024)}KB, data ${dataFiles} файлов, `
    + `модулей хоста ${hostModules.length}`,
);
