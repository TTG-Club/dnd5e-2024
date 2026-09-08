/**
 * Контракт запроса спасброска у владельца цели.
 *
 * Ядро доставляет запрос броска адресно (`api.rollRequests`), но правил не
 * знает: и нагрузка запроса, и результат ответа для него непрозрачны и едут
 * через сеть как `unknown`. Форму придумывает система — и описана она здесь,
 * ОДИН раз на обе стороны канала: инициатор нагрузку кладёт, слот адресата её
 * разбирает, инициатор разбирает пришедший назад ответ.
 *
 * Обе формы заданы схемами, а не только типами: то, что приезжает по сети с
 * чужого клиента, — внешние данные, и разбирать их обязательно проверкой.
 *
 * @module system/dnd/savingThrowRequest
 */

import type { AbilityType } from '@vtt/shared';

import type { ConditionRef } from './conditionKeys.js';

import { z } from 'zod';

import { isAbilityType } from './consts.js';

/**
 * Метка нашей нагрузки. По ней слот адресата отличает свой запрос от чужого:
 * тем же каналом поедут проверки характеристик и что угодно ещё.
 */
export const SAVING_THROW_REQUEST_KIND = 'savingThrow';

/**
 * Нагрузка запроса спасброска — всё, чего адресату хватит, чтобы посчитать
 * бросок у себя.
 *
 * Модификатора и режима (преимущество/помеха) здесь НЕТ намеренно: их считает
 * сторона адресата по своей же сущности. Инициатор их не знает лучше — у него
 * может быть устаревший снимок эффектов цели, а бросок должен идти по тому
 * состоянию, которое видит владелец.
 */
export const savingThrowRequestPayloadSchema = z.object({
  /** Метка формы — у чужого запроса она другая */
  kind: z.literal(SAVING_THROW_REQUEST_KIND),
  /**
   * Характеристика спасброска. `z.custom` даёт узкий `AbilityType` без `as`, а
   * проверка та же, что и у данных мира.
   */
  ability: z.custom<AbilityType>(isAbilityType),
  /** Сложность (СЛ): с ней адресат сравнивает свой бросок */
  dc: z.number(),
  /**
   * Спасбросок навязан магией. Едет явно: от этого зависят флаги вроде
   * «Мантии сопротивления заклинаниям», а адресат не видит, чем его бьют.
   */
  againstMagic: z.boolean(),
  /**
   * Состояние, которого спасбросок позволяет избежать (флаги преимущества
   * против конкретного состояния). Рантайм широкий: состояния стола дают свои
   * ключи помимо канонных.
   */
  againstCondition: z
    .custom<ConditionRef>((value) => typeof value === 'string')
    .optional(),
  /** Чем бьют — «Огненный шар», «Укус»: уходит в заголовок окна у адресата */
  sourceName: z.string().optional(),
});

/** Нагрузка запроса спасброска (форма — `savingThrowRequestPayloadSchema`) */
export type SavingThrowRequestPayload = z.infer<
  typeof savingThrowRequestPayloadSchema
>;

/**
 * Разбирает нагрузку запроса броска.
 *
 * @param value - непрозрачный `payload` запроса от ядра
 * @returns нагрузка спасброска либо `null`, если форма чужая
 */
export function parseSavingThrowRequestPayload(
  value: unknown,
): SavingThrowRequestPayload | null {
  const parsed = savingThrowRequestPayloadSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * Результат спасброска — и своего, и приехавшего ответом на запрос.
 */
export const savingThrowResultSchema = z.object({
  /** Натуральное значение кости, без модификатора */
  roll: z.number(),
  /** Модификатор спасброска цели */
  modifier: z.number(),
  /** Итог: кость плюс модификатор */
  total: z.number(),
  /** Пройден ли спасбросок */
  passed: z.boolean(),
});

/** Результат броска спасброска */
export type SavingThrowResult = z.infer<typeof savingThrowResultSchema>;

/**
 * Разбирает ответ на запрос спасброска.
 *
 * @param value - непрозрачный `result` из исхода запроса
 * @returns результат спасброска либо `null`, если форма чужая
 */
export function parseSavingThrowResult(
  value: unknown,
): SavingThrowResult | null {
  const parsed = savingThrowResultSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}
