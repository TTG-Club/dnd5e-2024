/**
 * Разбор полезной нагрузки карточек чата.
 *
 * Карточка получает запись строкой из сообщения: её мог отправить другой
 * клиент, другая версия системы или вовсе не система. Поэтому строка сначала
 * разбирается как `unknown`, а форму подтверждает гвард самой карточки —
 * испорченная запись показывается заглушкой `CardErrorFallback`, а не роняет
 * чат.
 *
 * @module systems/dnd5e/ui/chat/cardPayload
 */

import { isRecord } from '@vtt/shared';

/**
 * Разбирает нагрузку карточки и проверяет её форму.
 *
 * @param payload - сериализованная запись из сообщения чата
 * @param isValid - гвард формы, которую показывает карточка
 * @returns запись нужной формы либо `null`
 */
export function parseCardPayload<T>(
  payload: string,
  isValid: (value: unknown) => value is T,
): T | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  return isValid(parsed) ? parsed : null;
}

/**
 * Проверяет, что запись пригодна для показа карточкой: у неё есть название.
 *
 * Проверка намеренно ленивая — как у схем предметов: карточка показывает
 * название и описание, а по строгой сверке отвалились бы рабочие записи из
 * компендиумов и миров разных лет.
 *
 * @param value - разобранная нагрузка
 * @returns `true`, если у записи есть строковое название
 */
export function isNamedCardEntry(value: unknown): value is { name: string } {
  return isRecord(value) && typeof value.name === 'string';
}
