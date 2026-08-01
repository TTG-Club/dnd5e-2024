/**
 * Утилиты для строгой проверки манифестов модулей и систем.
 *
 * @module utils/manifestValidation
 */

import type { BaseManifest } from '../types/module.js';

/**
 * Проверяет наличие и типы обязательных полей для базового манифеста.
 * Мутирует (или валидирует) сырой объект. Не выбрасывает исключений, а возвращает boolean
 * и выводит ошибку в консоль при проблемах.
 *
 * @param raw - сырой объект из JSON.parse
 * @param dir - директория (для логов)
 * @param fileName - имя файла манифеста (для логов)
 * @returns true, если манифест валиден
 */
export function validateBaseManifest(
  raw: unknown,
  dir: string,
  fileName: string,
): raw is BaseManifest {
  if (!raw || typeof raw !== 'object') {
    console.error(
      `[ManifestValidation] Invalid ${fileName} in ${dir}: not an object`,
    );

    return false;
  }

  const manifest = raw as Record<string, unknown>;

  if (typeof manifest.id !== 'string' || !manifest.id) {
    console.error(
      `[ManifestValidation] Invalid ${fileName} in ${dir}: missing or empty "id"`,
    );

    return false;
  }

  if (typeof manifest.name !== 'string' || !manifest.name) {
    console.error(
      `[ManifestValidation] Invalid ${fileName} in ${dir}: missing or empty "name"`,
    );

    return false;
  }

  if (typeof manifest.version !== 'string' || !manifest.version) {
    console.error(
      `[ManifestValidation] Invalid ${fileName} in ${dir}: missing or empty "version"`,
    );

    return false;
  }

  return true;
}

/**
 * Извлекает человекочитаемого автора из манифеста, понимая ОБА формата: простое
 * строковое поле `author` (формат VTTG) и массив `authors: [{ name }]` (формат
 * Foundry, которым пользуются внешние системы, установленные по ссылке).
 *
 * Единая точка нормализации автора: и список установленных систем, и библиотека
 * систем показывают автора одинаково, читая манифест этой функцией (DRY). Без
 * неё внешняя система с `authors[]` показывалась бы как «автор не указан», хотя
 * в библиотеке автор виден.
 *
 * @param raw - сырой объект манифеста (system.json / module.json) из JSON.parse
 * @returns автор одной строкой либо `undefined`, если автор не указан
 */
export function resolveManifestAuthor(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }

  if (
    'author' in raw
    && typeof raw.author === 'string'
    && raw.author.trim().length > 0
  ) {
    return raw.author;
  }

  if ('authors' in raw && Array.isArray(raw.authors)) {
    const names = raw.authors
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null,
      )
      .map((entry) => (typeof entry.name === 'string' ? entry.name.trim() : ''))
      .filter((name) => name.length > 0);

    if (names.length > 0) {
      return names.join(', ');
    }
  }

  return undefined;
}

/**
 * Проверяет совместимость модуля с игровой системой по полю `compatibleSystems`.
 *
 * `undefined` / пустой список / `['*']` — модуль системо-нейтрален (совместим с
 * любой системой). Строка вместо массива — частая опечатка автора манифеста:
 * трактуется как список из одного элемента (НЕ как «совместим со всеми», иначе
 * объявленное ограничение молча исчезало бы). Иначе список должен содержать
 * `systemId`. Общая логика для серверной загрузки модулей и клиентской раздачи
 * (DRY).
 *
 * @param compatibleSystems - объявленные системы модуля (из манифеста)
 * @param systemId - идентификатор активной системы мира
 * @returns true, если модуль совместим с системой
 */
export function isModuleCompatibleWithSystem(
  compatibleSystems: readonly string[] | string | undefined,
  systemId: string,
): boolean {
  const declaredSystems =
    typeof compatibleSystems === 'string'
      ? [compatibleSystems]
      : compatibleSystems;

  if (
    !declaredSystems
    || !Array.isArray(declaredSystems)
    || declaredSystems.length === 0
    || declaredSystems.includes('*')
  ) {
    return true;
  }

  return declaredSystems.includes(systemId);
}
