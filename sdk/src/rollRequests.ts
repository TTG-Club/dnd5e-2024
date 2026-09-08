/**
 * Запросы бросков: константы времени и проверки формы того, что приходит по
 * сети. Типы — в `types/rollRequest.ts`.
 *
 * @module shared/rollRequests
 */

import type {
  RollRequestCancelReason,
  RollRequestNeutralAnswer,
  RollRequestOutcome,
  RollRequestSendAck,
  RollRequestSendInput,
} from './types/rollRequest.js';

import { z } from 'zod';

import { isRecord } from './utils/typeGuards.js';

/**
 * Потолок жизни запроса на сервере. Больше него `timeoutMs` не бывает: даже
 * запрос «без таймаута» завершится `timeout`, а не повиснет навсегда.
 */
export const ROLL_REQUEST_MAX_LIFETIME_MS = 15 * 60_000;

/**
 * Сколько сервер ждёт возвращения ушедшего участника, прежде чем считать его
 * пропавшим. Покрывает F5 и короткий обрыв связи: адресат за это время
 * перезагрузит страницу и получит запрос заново, инициатор — дождётся
 * результата. Не вернулся — адресат даёт `noRecipient`, запросы инициатора
 * снимаются у адресатов (ждать их уже некому).
 */
export const ROLL_REQUEST_OFFLINE_GRACE_MS = 60_000;

/**
 * Сколько сервер помнит завершённый запрос, чтобы переотдать результат
 * инициатору, если тот пришёл в обрыв связи.
 */
export const ROLL_REQUEST_RESULT_RETENTION_MS = 60_000;

/**
 * Запас клиента поверх серверного срока: если сервер по какой-то причине не
 * ответил вовсе, промис инициатора всё равно завершится `timeout`.
 */
export const ROLL_REQUEST_CLIENT_SAFETY_MARGIN_MS = 30_000;

/** Формула нейтрального броска ядра, если инициатор свою не передал */
export const ROLL_REQUEST_DEFAULT_FALLBACK_FORMULA = '1d20';

/**
 * Срок жизни запроса с учётом потолка: больше `ROLL_REQUEST_MAX_LIFETIME_MS`
 * не бывает, без `timeoutMs` — ровно потолок. Одна формула для сервера
 * (таймер запроса) и клиента (страховочный таймер промиса).
 *
 * @param timeoutMs - желаемый срок инициатора
 * @returns срок в миллисекундах
 */
export function resolveRollRequestLifetimeMs(
  timeoutMs: number | undefined,
): number {
  return Math.min(
    timeoutMs ?? ROLL_REQUEST_MAX_LIFETIME_MS,
    ROLL_REQUEST_MAX_LIFETIME_MS,
  );
}

/** Причины снятия запроса у адресата — для проверки входящих событий */
const CANCEL_REASONS: ReadonlySet<string> = new Set<RollRequestCancelReason>([
  'answered',
  'takenOver',
  'cancelled',
  'timeout',
]);

/**
 * Схема запроса, который присылает инициатор. Идентификаторы ограничены по
 * длине: они уходят в ключи карт и в подписи, а приходят от клиента.
 */
export const rollRequestSendInputSchema = z.object({
  requestId: z.string().min(1).max(120),
  entityId: z.string().min(1).max(200),
  sourceEntityId: z.string().min(1).max(200).optional(),
  title: z.string().max(200).optional(),
  fallbackFormula: z.string().min(1).max(64).optional(),
  payload: z.unknown(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(ROLL_REQUEST_MAX_LIFETIME_MS)
    .optional(),
  clientId: z.string().min(1).max(120),
});

/**
 * Разбирает запрос инициатора из сети.
 *
 * @param raw - аргумент события `roll-request:send`
 * @returns типизированный запрос или null, если форма не та
 */
export function parseRollRequestSendInput(
  raw: unknown,
): RollRequestSendInput | null {
  const parsed = rollRequestSendInputSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const {
    requestId,
    entityId,
    sourceEntityId,
    title,
    fallbackFormula,
    payload,
    timeoutMs,
    clientId,
  } = parsed.data;

  return {
    requestId,
    entityId,
    sourceEntityId,
    title,
    fallbackFormula,
    payload,
    timeoutMs,
    clientId,
  };
}

/**
 * Проверяет, что значение — исход запроса броска.
 *
 * @param value - произвольное значение из сети
 * @returns true, если это `RollRequestOutcome`
 */
export function isRollRequestOutcome(
  value: unknown,
): value is RollRequestOutcome {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return false;
  }

  switch (value.status) {
    case 'answered':
    case 'takenOver':
      return 'result' in value && typeof value.respondedByUserId === 'string';
    case 'declined':
    case 'timeout':
    case 'noRecipient':
      return true;
    case 'rejected':
      return typeof value.reason === 'string';
    default:
      return false;
  }
}

/**
 * Проверяет, что значение — ответ сервера на `roll-request:send`.
 *
 * @param value - первый аргумент ack
 * @returns true, если это `RollRequestSendAck`
 */
export function isRollRequestSendAck(
  value: unknown,
): value is RollRequestSendAck {
  if (!isRecord(value) || typeof value.accepted !== 'boolean') {
    return false;
  }

  if (value.accepted) {
    return (
      typeof value.recipientUserId === 'string'
      && typeof value.recipientName === 'string'
      && typeof value.entityName === 'string'
      && typeof value.expiresAt === 'number'
    );
  }

  return isRollRequestOutcome(value.outcome);
}

/**
 * Проверяет причину снятия запроса из события `roll-request:cancelled`.
 *
 * @param value - произвольное значение
 * @returns true, если это известная причина
 */
export function isRollRequestCancelReason(
  value: unknown,
): value is RollRequestCancelReason {
  return typeof value === 'string' && CANCEL_REASONS.has(value);
}

/**
 * Распознаёт ответ нейтрального окна ядра: адресат бросил без окна системы.
 *
 * @param value - `result` из исхода `answered`/`takenOver`
 * @returns true, если это `RollRequestNeutralAnswer`
 */
export function isNeutralRollAnswer(
  value: unknown,
): value is RollRequestNeutralAnswer {
  return (
    isRecord(value)
    && value.neutral === true
    && typeof value.formula === 'string'
    && typeof value.total === 'number'
    && isRecord(value.rollData)
  );
}
