/**
 * Поднимает patch-версию (0.5.3 → 0.5.4) во всех файлах с номером и добавляет их
 * в текущий коммит. Вызывается из `.githooks/pre-commit` на рабочих ветках.
 *
 * Зачем: каждая сборка, установленная локально или отданная на проверку, должна
 * отличаться номером от предыдущей — иначе в списке систем VTTG не видно, какой
 * именно код туда попал, а обновление по манифесту (сравнение номеров) вообще не
 * срабатывает. Руками номер не поднимают: он живёт в трёх файлах и разъезжается.
 *
 * Релизный коммит (`scripts/release.mjs`) хук не задевает — там commit идёт с
 * `--no-verify`, иначе тег `vX.Y.Z` указывал бы на код с версией X.Y.Z+1.
 */
import { execFileSync } from 'node:child_process';

import {
  nextVersion,
  readVersion,
  ROOT,
  VERSIONED_FILES,
  writeVersion,
} from './lib/version.mjs';

/**
 * Возвращает файлы с версией, у которых есть НЕпроиндексированные правки.
 *
 * Такие файлы важно назвать вслух: ниже идёт `git add` целиком, и вместе с
 * номером версии в коммит уедут соседние правки того же файла, которые автор
 * оставил «на потом».
 *
 * @returns список путей относительно корня репозитория
 */
function findUnstagedFiles() {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...VERSIONED_FILES],
    { cwd: ROOT, encoding: 'utf-8' },
  );

  return output.split('\n').filter(Boolean);
}

try {
  const unstaged = findUnstagedFiles();
  const current = readVersion();
  const next = nextVersion(current, 'patch');

  writeVersion(next);

  execFileSync('git', ['add', ...VERSIONED_FILES], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  console.log(`[bump-version] версия ${current} → ${next}`);

  if (unstaged.length > 0) {
    console.warn(
      '[bump-version] в коммит целиком добавлены файлы, где были и другие '
        + `незаиндексированные правки: ${unstaged.join(', ')}`,
    );
  }
} catch (error) {
  console.error(`[bump-version] ${error.message}`);
  process.exit(1);
}
