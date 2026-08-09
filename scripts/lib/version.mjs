/**
 * Номер версии системы — единым местом для всех, кто его читает и меняет.
 *
 * Номер живёт в трёх файлах репозитория (`package.json`, `system.json` и поле
 * `readonly version` движка) плюс в git-теге. Раньше правила его менять были
 * зашиты в `scripts/release.mjs`; теперь версию поднимает ещё и pre-commit
 * (`scripts/bump-version.mjs`), поэтому «где лежит номер» и «как его записать»
 * вынесены сюда: два скрипта с двумя копиями регулярок разъедутся так же, как
 * до этого разъезжались сами файлы.
 *
 * Функции бросают `Error` с готовым текстом — вызывающий скрипт решает, как о
 * нём сообщить (у релиза и у хука разные префиксы и разные коды выхода).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень репозитория (файл лежит в `scripts/lib`). */
export const ROOT = path.dirname(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);

export const PACKAGE_PATH = path.join(ROOT, 'package.json');
export const MANIFEST_PATH = path.join(ROOT, 'system.json');

/** Файл движка, где номер версии зашит в поле класса `VttSystem`. */
export const ENGINE_SYSTEM_PATH = path.join(
  ROOT,
  'src',
  'engine',
  'dnd5eSystem.ts',
);

/** Файлы, в которых номер версии меняется — и только они. */
export const VERSIONED_FILES = [
  PACKAGE_PATH,
  MANIFEST_PATH,
  ENGINE_SYSTEM_PATH,
];

const JSON_VERSION_RE = /("version"\s*:\s*")[^"]+(")/;
const ENGINE_VERSION_RE = /(readonly version = ')[^']+(')/g;

/**
 * Читает текущий номер версии. Источник истины — `package.json`.
 *
 * @returns версия вида `X.Y.Z`
 */
export function readVersion() {
  const source = readFileSync(PACKAGE_PATH, 'utf-8');
  const match = source.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/);

  if (!match) {
    throw new Error(
      'в package.json не найдено поле "version" вида X.Y.Z — правьте вручную',
    );
  }

  return match[1];
}

/**
 * Заменяет значение поля `version` в JSON-файле, сохраняя формат файла.
 *
 * @param filePath - путь к JSON
 * @param version - новый номер версии
 */
function writeJsonVersion(filePath, version) {
  const source = readFileSync(filePath, 'utf-8');
  const updated = source.replace(JSON_VERSION_RE, `$1${version}$2`);

  if (updated === source) {
    throw new Error(
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
  const matches = source.match(ENGINE_VERSION_RE);

  if (matches?.length !== 1) {
    throw new Error(
      'в src/engine/dnd5eSystem.ts ожидалось РОВНО одно поле "readonly version", '
        + `найдено ${matches?.length ?? 0} — проверьте файл`,
    );
  }

  writeFileSync(
    ENGINE_SYSTEM_PATH,
    source.replace(ENGINE_VERSION_RE, `$1${version}$2`),
    'utf-8',
  );
}

/**
 * Записывает один номер версии во все файлы сразу.
 *
 * @param version - новый номер версии
 */
export function writeVersion(version) {
  writeJsonVersion(PACKAGE_PATH, version);
  writeJsonVersion(MANIFEST_PATH, version);
  writeEngineVersion(version);
}

/**
 * Вычисляет следующий номер версии.
 *
 * @param current - текущая версия
 * @param bump - `patch` / `minor` / `major` либо явный номер `X.Y.Z`
 * @returns новый номер версии
 */
export function nextVersion(current, bump) {
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
      throw new Error(
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
export function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (leftParts[i] !== rightParts[i]) {
      return leftParts[i] - rightParts[i];
    }
  }

  return 0;
}
