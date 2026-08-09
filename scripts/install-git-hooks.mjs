/**
 * Включает хуки из `.githooks` для текущего клона. Git сам эту папку не видит:
 * без `core.hooksPath` pre-commit просто не выполняется, и разработчик об этом
 * никак не узнаёт — версия молча перестаёт расти. Запускается из `prepare` при
 * каждой установке зависимостей.
 *
 * Молча выходит там, где хуки не нужны или невозможны: сборка в CI из
 * распакованного архива, окружение без git.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (!existsSync(path.join(ROOT, '.git'))) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
} catch {
  console.warn(
    '[install-git-hooks] не удалось включить .githooks — версия при коммите '
      + 'подниматься не будет',
  );
}
