/**
 * Выпуск новой версии системы: проверка сборкой, коммит (если номер меняется) и тег.
 *
 * Версия системы для VTTG — это git-тег `vX.Y.Z`: по нему CI штампует манифест
 * релиза (`scripts/stamp-manifest.mjs`). Но номер живёт ещё в трёх файлах репы, и
 * раньше их правили руками — они разъезжались (в `package.json` было 0.0.8, а в
 * движке до сих пор 1.0.0). Менять номер в репозитории разрешено только двумя
 * способами, и оба поднимают его ВЕЗДЕ одинаково: этот скрипт и pre-commit
 * (`scripts/bump-version.mjs`, +1 к patch на каждый коммит в main/dev).
 *
 * Использование:
 *
 *   npm run release                   # выпустить номер, накопленный коммитами
 *   npm run release -- patch          # 0.0.8 → 0.0.9 (фиксы)
 *   npm run release -- minor          # 0.0.8 → 0.1.0 (новые возможности)
 *   npm run release -- major          # 0.0.8 → 1.0.0 (несовместимые изменения)
 *   npm run release -- 0.2.5          # явный номер
 *   npm run release -- --push         # сразу отправить ветку и тег в origin
 *
 * БЕЗ аргумента шага номер не меняется: тег вешается на текущий HEAD, релизного
 * коммита не создаётся. Шаг нужен, когда релиз обязан отличаться от накопленного
 * patch — новые возможности (`minor`) или несовместимые изменения (`major`).
 *
 * БЕЗ `--push` скрипт ничего наружу не отправляет: он останавливается на
 * созданном локальном теге и печатает команду push. Публикация релиза — действие
 * необратимое (GitHub Release виден всем), поэтому её подтверждает человек.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  compareVersions,
  MANIFEST_PATH,
  nextVersion,
  readVersion,
  ROOT,
  VERSIONED_FILES,
  writeVersion,
} from './lib/version.mjs';

/** Ветка, с которой разрешено выпускать релизы. */
const RELEASE_BRANCH = 'main';

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
 * Выполняет операцию над версией, превращая её ошибку в остановку релиза:
 * `scripts/lib/version.mjs` бросает `Error`, а здесь у сообщений свой префикс.
 *
 * @param operation - что выполнить
 * @returns результат операции
 */
function attempt(operation) {
  try {
    return operation();
  } catch (error) {
    return fail(error.message);
  }
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

/**
 * Без шага выпускается номер, уже накопленный автобампом на коммитах: менять в
 * файлах нечего, релизного коммита не будет — тег вешается на текущий HEAD.
 */
const releaseCurrent = !bump;

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

const currentVersion = attempt(() => readVersion());

const version = releaseCurrent
  ? currentVersion
  : attempt(() => nextVersion(currentVersion, bump));

if (!releaseCurrent && compareVersions(version, currentVersion) <= 0) {
  fail(
    `версия ${version} не выше текущей ${currentVersion} — VTTG не увидит обновление`,
  );
}

const tag = `v${version}`;

// Тег уже есть — значит этот номер выпущен: коммиты после него не подняли патч
// (хук выключен или коммитили с --no-verify). Номер не переиспользуют.
if (capture('git', ['tag', '--list', tag])) {
  fail(
    releaseCurrent
      ? `тег ${tag} уже существует — выпускайте следующий номер: `
          + 'npm run release -- patch'
      : `тег ${tag} уже существует`,
  );
}

// 3. Один номер во всех трёх местах. В релиз уезжает проштампованный CI манифест,
//    но в репе номера обязаны совпадать — иначе они разъезжаются, как раньше.
if (releaseCurrent) {
  console.log(`[release] ${manifest.id}: выпускаем текущую версию ${version}`);
} else {
  console.log(`[release] ${manifest.id}: ${currentVersion} → ${version}`);

  try {
    writeVersion(version);
  } catch (error) {
    restoreVersionedFiles();
    fail(error.message);
  }
}

// 4. Сборка — единственный автоматический контроль в репозитории. Негодный бандл
//    не должен доехать до тега: CI на теге упадёт уже после публикации коммита.
run(
  'npm',
  ['run', 'build'],
  releaseCurrent ? undefined : restoreVersionedFiles,
);

// 5. Релизный коммит (только если номер менялся) и аннотированный тег.
if (!releaseCurrent) {
  run('git', ['add', ...VERSIONED_FILES]);
  // --no-verify: pre-commit поднял бы патч поверх релизного номера, и тег vX.Y.Z
  // указывал бы на код с версией X.Y.Z+1.
  run('git', ['commit', '--no-verify', '-m', `"chore(release): ${tag}"`]);
}

run('git', ['tag', '-a', tag, '-m', `"${tag}"`]);

console.log(
  releaseCurrent
    ? `\n[release] тег ${tag} создан локально на текущем коммите.`
    : `\n[release] коммит и тег ${tag} созданы локально.`,
);

if (!shouldPush) {
  const rollback = releaseCurrent
    ? `git tag -d ${tag}`
    : `git tag -d ${tag} && git reset --hard HEAD~1`;

  console.log(
    '[release] публикация НЕ выполнена. Отправить релиз (создаст GitHub Release):\n'
      + `\n    git push origin ${RELEASE_BRANCH} --follow-tags\n`
      + `\nОткатить локально: ${rollback}\n`,
  );

  process.exit(0);
}

run('git', ['push', 'origin', RELEASE_BRANCH, '--follow-tags']);

console.log(
  `\n[release] тег ${tag} отправлен — GitHub Actions собирает и публикует релиз.\n`
    + '[release] проверьте вкладку Actions и созданный Release.\n',
);
