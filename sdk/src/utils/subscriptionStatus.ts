/**
 * Разбор ответа сервиса подписок TTG (subscriber-service).
 *
 * Ответ — ВНЕШНИЕ данные, поэтому приходит как `unknown` и проверяется схемой,
 * а не ручными проверками полей. Схема общая для клиента (отметка подписки
 * рядом с именем) и мастер-сервера (гейт премиум-контента компедиума), чтобы
 * обе стороны трактовали ответ одинаково.
 *
 * @module utils/subscriptionStatus
 */

import { z } from 'zod';

/**
 * Схема ответа `GET /api/subscriptions/status` (`SubscriptionStatusResponse`
 * из subscriber-service). Даты приходят строками ISO-8601, лишние поля
 * (`startsAt`, `type`) для наших решений не нужны и отбрасываются.
 */
const subscriptionStatusResponseSchema = z.object({
  active: z.boolean(),
  registered: z.boolean().optional(),
  expiresAt: z.string().nullish(),
});

/** Статус подписки в удобном для приложения виде */
export interface SubscriptionStatus {
  /** Активна ли подписка прямо сейчас (по данным сервиса) */
  active: boolean;
  /** Есть ли у пользователя хоть одна подписка (в т.ч. не активированная) */
  registered: boolean;
  /** Момент окончания активной подписки (мс epoch) или null */
  expiresAt: number | null;
}

/**
 * Разбирает момент времени из ответа сервиса (ISO-8601).
 *
 * @param value - строковое значение поля даты или null/undefined
 * @returns время в мс epoch или null, если поле пустое либо некорректное
 */
function parseInstant(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Проверяет и приводит ответ сервиса подписок к `SubscriptionStatus`.
 *
 * Fail-closed: невалидный ответ — это НЕ статус, и вызывающая сторона обязана
 * оставить прежнее решение, а не считать подписку активной по мусору.
 *
 * @param data - разобранный JSON ответа (внешние данные)
 * @returns статус подписки или null, если ответ не прошёл схему
 */
export function parseSubscriptionStatus(
  data: unknown,
): SubscriptionStatus | null {
  const result = subscriptionStatusResponseSchema.safeParse(data);

  if (!result.success) {
    return null;
  }

  return {
    active: result.data.active,
    registered: result.data.registered === true,
    expiresAt: parseInstant(result.data.expiresAt),
  };
}
