/**
 * Выпуск новой версии системы: подъём номера, проверка сборкой, коммит и тег.
 *
 * Версия системы для VTTG — это git-тег `vX.Y.Z`: по нему CI штампует манифест
 * релиза (`scripts/stamp-manifest.mjs`). Но номер живёт ещё в трёх файлах репы, и
 * раньше их правили руками — они разъезжались (в `package.json` было 0.0.8, а в
 * движке до сих пор 1.0.0). Этот скрипт — единственный разрешённый способ менять
 * версию: он поднимает её ВЕЗДЕ одинаково и создаёт тег.
 *
 * Использование:
 *
 *   npm run release -- patch          # 0.0.8 → 0.0.9 (фиксы)
 *   npm run release -- minor          # 0.0.8 → 0.1.0 (новые возможности)
 *   npm run release -- major          # 0.0.8 → 1.0.0 (несовместимые изменения)
 *   npm run release -- 0.2.5          # явный номер
 *   npm run release -- patch --push   # сразу отправить ветку и тег в origin
 *
 * БЕЗ `--push` скрипт ничего наружу не отправляет: он останавливается на
 * созданном локальном теге и печатает команду push. Публикация релиза — действие
 * необратимое (GitHub Release виден всем), поэтому её подтверждает человек.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Ветка, с которой разрешено выпускать релизы. */
const RELEASE_BRANCH = 'main';

/** Файл движка, где номер версии зашит в поле класса `VttSystem`. */
const ENGINE_SYSTEM_PATH = path.join(ROOT, 'src', 'engine', 'dnd5eSystem.ts');

const PACKAGE_PATH = path.join(ROOT, 'package.json');
const MANIFEST_PATH = path.join(ROOT, 'system.json');

/** Файлы, в которых скрипт меняет номер версии (и только он). */
const VERSIONED_FILES = [PACKAGE_PATH, MANIFEST_PATH, ENGINE_SYSTEM_PATH];

/**
 * Завершает работу с сообщением об ошибке.
 *
 * @param message - что пошло не так
 */
function fail(message) {
  console.error(`\n[release] ${message}\n`);
  process.exit(1);
}

/**
 * Запускает команду и возвращает её stdout (обрезанный).
 *
 * @param command - исполняемая команда
 * @param args - аргументы
 * @returns stdout без хвостовых пробелов
 */
function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: true,
  });

  if (result.status !== 0) {
    fail(
      `команда "${command} ${args.join(' ')}" завершилась с ошибкой:\n${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

/**
 * Запускает команду, показывая её вывод; прерывает всё при ненулевом коде.
 *
 * @param command - исполняемая команда
 * @param args - аргументы
 * @param onFailure - вызывается перед выходом (откат изменений)
 */
function run(command, args, onFailure) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    onFailure?.();
    fail(`шаг "${command} ${args.join(' ')}" не прошёл — релиз остановлен`);
  }
}

/**
 * Вычисляет следующий номер версии.
 *
 * @param current - текущая версия из package.json
 * @param bump - `patch` / `minor` / `major` либо явный номер `X.Y.Z`
 * @returns новый номер версии
 */
function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump;
  }

  const [major, minor, patch] = current.split('.').map(Number);

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return fail(
        `непонятный аргумент "${bump}": ожидается patch | minor | major | X.Y.Z`,
      );
  }
}

/**
 * Сравнивает версии как числа (а не как строки — иначе 0.0.10 < 0.0.9).
 *
 * @param left - первая версия
 * @param right - вторая версия
 * @returns положительное число, если left больше right
 */
function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (leftParts[i] !== rightParts[i]) {
      return leftParts[i] - rightParts[i];
    }
  }

  return 0;
}

/**
 * Заменяет значение поля `version` в JSON-файле, сохраняя формат файла.
 *
 * @param filePath - путь к JSON
 * @param version - новый номер версии
 */
function writeJsonVersion(filePath, version) {
  const source = readFileSync(filePath, 'utf-8');

  const updated = source.replace(
    /("version"\s*:\s*")[^"]+(")/,
    `$1${version}$2`,
  );

  if (updated === source) {
    fail(
      `в ${path.basename(filePath)} не найдено поле "version" — правьте вручную`,
    );
  }

  writeFileSync(filePath, updated, 'utf-8');
}

/**
 * Заменяет номер версии в поле класса движка (`readonly version = '…'`).
 *
 * @param version - новый номер версии
 */
function writeEngineVersion(version) {
  const source = readFileSync(ENGINE_SYSTEM_PATH, 'utf-8');
  const pattern = /(readonly version = ')[^']+(')/g;
  const matches = source.match(pattern);

  if (matches?.length !== 1) {
    fail(
      `в src/engine/dnd5eSystem.ts ожидалось РОВНО одно поле "readonly version", `
        + `найдено ${matches?.length ?? 0} — проверьте файл`,
    );
  }

  writeFileSync(
    ENGINE_SYSTEM_PATH,
    source.replace(pattern, `$1${version}$2`),
    'utf-8',
  );
}

/** Возвращает изменённые скриптом файлы к состоянию HEAD. */
function restoreVersionedFiles() {
  spawnSync('git', ['checkout', '--', ...VERSIONED_FILES], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
}

const args = process.argv.slice(2);
const shouldPush = args.includes('--push');
const bump = args.find((argument) => !argument.startsWith('--'));

if (!bump) {
  fail(
    'не указан шаг версии: npm run release -- <patch|minor|major|X.Y.Z> [--push]',
  );
}

// 1. Рабочее дерево должно быть чистым: в релизный коммит попадут ТОЛЬКО файлы
//    с номером версии, а откат при неудачной сборке делается через git checkout.
if (capture('git', ['status', '--porcelain'])) {
  fail(
    'есть незакоммиченные изменения — сначала влейте их в main, потом выпускайте релиз',
  );
}

// 2. Релиз выпускается только с main: тег на побочной ветке уедет в релиз с
//    кодом, которого нет в основной истории.
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

if (branch !== RELEASE_BRANCH) {
  fail(
    `релиз выпускается только с ветки ${RELEASE_BRANCH}, а сейчас "${branch}"`,
  );
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
const currentVersion = JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8')).version;
const version = nextVersion(currentVersion, bump);
const tag = `v${version}`;

if (compareVersions(version, currentVersion) <= 0) {
  fail(
    `версия ${version} не выше текущей ${currentVersion} — VTTG не увидит обновление`,
  );
}

if (capture('git', ['tag', '--list', tag])) {
  fail(`тег ${tag} уже существует`);
}

console.log(`[release] ${manifest.id}: ${currentVersion} → ${version}`);

// 3. Один номер во всех трёх местах. В релиз уезжает проштампованный CI манифест,
//    но в репе номера обязаны совпадать — иначе они разъезжаются, как раньше.
writeJsonVersion(PACKAGE_PATH, version);
writeJsonVersion(MANIFEST_PATH, version);
writeEngineVersion(version);

// 4. Сборка — единственный автоматический контроль в репозитории. Негодный бандл
//    не должен доехать до тега: CI на теге упадёт уже после публикации коммита.
run('npm', ['run', 'build'], restoreVersionedFiles);

// 5. Релизный коммит и аннотированный тег.
run('git', ['add', ...VERSIONED_FILES]);
run('git', ['commit', '-m', `"chore(release): ${tag}"`]);
run('git', ['tag', '-a', tag, '-m', `"${tag}"`]);

console.log(`\n[release] коммит и тег ${tag} созданы локально.`);

if (!shouldPush) {
  console.log(
    '[release] публикация НЕ выполнена. Отправить релиз (создаст GitHub Release):\n'
      + `\n    git push origin ${RELEASE_BRANCH} --follow-tags\n`
      + `\nОткатить локально: git tag -d ${tag} && git reset --hard HEAD~1\n`,
  );

  process.exit(0);
}

run('git', ['push', 'origin', RELEASE_BRANCH, '--follow-tags']);

console.log(
  `\n[release] тег ${tag} отправлен — GitHub Actions собирает и публикует релиз.\n`
    + '[release] проверьте вкладку Actions и созданный Release.\n',
);
