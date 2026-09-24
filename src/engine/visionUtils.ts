/**
 * Утилиты представления настроек зрения токена D&D 5e.
 *
 * Дальность зрения хранится в футах, при этом `0` — не «слепой токен»,
 * а признак безграничного зрения (см. `TokenSettings.vision.range`).
 * Из-за этого значение нельзя подставлять в шаблон напрямую и нельзя
 * восстанавливать через `||` — обе ошибки уже приводили к тому, что
 * сохранённый ноль подменялся значением по умолчанию.
 */

import type { TokenSettings } from '@vtt/shared';

/** Значение дальности, означающее зрение без ограничений. */
const VISION_RANGE_UNLIMITED = 0;

/** Подпись для зрения без ограничения по дальности. */
const VISION_RANGE_UNLIMITED_LABEL = 'без ограничений';

/**
 * Форматирует дальность зрения для отображения в интерфейсе.
 * @param range - дальность в футах; `0` трактуется как безграничное зрение
 * @returns строка вида `60 фт.` либо `без ограничений`
 */
export function formatVisionRange(range: number): string {
  return range > VISION_RANGE_UNLIMITED
    ? `${range} фт.`
    : VISION_RANGE_UNLIMITED_LABEL;
}

/**
 * Включено ли зрение токена. Нет блока `vision` — это не слепота, а обычное
 * зрение с умолчаниями: так читает сцена приложения (`resolveEntityVision`
 * хоста). Лист, окна настроек и пайплайн обязаны читать так же, иначе шапка
 * теряла обычное зрение, а сохранение настроек ослепляло видящую фишку.
 *
 * @param token - настройки токена сущности
 * @returns `true`, если зрение включено
 */
export function isTokenVisionEnabled(
  token: TokenSettings | undefined,
): boolean {
  return token?.vision?.enabled ?? true;
}

/**
 * Тёмное зрение, настроенное на токене: база, поверх которой эффекты, предметы
 * и умения считают итог. При выключенном зрении тёмного зрения нет.
 *
 * @param token - настройки токена сущности
 * @returns дальность в футах; `0` — нет
 */
export function resolveTokenDarkvision(
  token: TokenSettings | undefined,
): number {
  return isTokenVisionEnabled(token) ? (token?.vision?.darkvision ?? 0) : 0;
}
