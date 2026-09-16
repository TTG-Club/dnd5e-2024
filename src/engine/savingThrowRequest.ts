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

import type { AbilityType, SceneEntity } from '@vtt/shared';

import type { ConditionRef } from './conditionKeys.js';

import { z } from 'zod';

import { isCreatureEntity } from '@vtt/shared';

import { isAbilityType } from './consts.js';
import { EFFECT_TRIGGER_SAVE_MODES } from './effectTriggerTypes.js';
import { SAVE_TYPE_LABELS } from './spellTypes.js';

/**
 * Части подписи запроса спасброска: «Огненный шар — Спасбросок Ловкость (DC 15)».
 * Подпись собирают обе стороны — клиент (запрос по заклинанию) и сервер (зона,
 * эффект хода), поэтому части лежат в движке.
 */
export const SAVING_THROW_REQUEST_TITLE_PARTS = {
  /** Подпись самого броска: дальше через пробел идёт характеристика */
  rollPrefix: 'Спасбросок ',
  /** Сложность в подписи: «… (DC 15)» */
  dcPrefix: ' (DC ',
  dcSuffix: ')',
  /** Разделитель «чем бьют» и самого спасброска */
  sourceSeparator: ' — ',
} as const;

/**
 * Подпись запроса для плашек ядра: «Огненный шар — Спасбросок Ловкость (DC 15)».
 *
 * Имени цели здесь нет намеренно: ядро показывает её само, рядом с подписью.
 *
 * @param ability - характеристика спасброска
 * @param dc - сложность
 * @param sourceName - чем бьют (заклинание, действие, зона), если известно
 * @returns короткая подпись запроса
 */
export function formatSavingThrowRequestTitle(
  ability: AbilityType,
  dc: number,
  sourceName?: string,
): string {
  const { rollPrefix, dcPrefix, dcSuffix, sourceSeparator } =
    SAVING_THROW_REQUEST_TITLE_PARTS;

  const save = `${rollPrefix}${SAVE_TYPE_LABELS[ability]}${dcPrefix}${dc}${dcSuffix}`;

  return sourceName ? `${sourceName}${sourceSeparator}${save}` : save;
}

/**
 * Бросает ли сущность спасброски сама, без окна.
 *
 * Существа (NPC) по умолчанию бросают сами: окно на каждый спасбросок стаи
 * волков мастеру не нужно. Персонажи — только если игрок явно включил
 * «Авто-спасброски»: по умолчанию игрок бросает свои спасброски сам.
 *
 * Правило одно для клиента (спасбросок от заклинания) и сервера (зона,
 * эффект хода) — поэтому оно в движке.
 *
 * @param entity - сущность, которая бросает
 * @returns `true`, если спасбросок бросается автоматически
 */
export function resolveAutoSaves(entity: SceneEntity): boolean {
  return isCreatureEntity(entity)
    ? (entity.autoSaves ?? true)
    : entity.autoSaves === true;
}

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
   * Спасбросок навязан именно заклинанием: «Кольцо отражения заклинаний» у
   * адресата. Нет поля — не заклинание (старый инициатор его не шлёт).
   */
  againstSpell: z.boolean().optional(),
  /**
   * Состояние, которого спасбросок позволяет избежать (флаги преимущества
   * против конкретного состояния). Рантайм широкий: состояния стола дают свои
   * ключи помимо канонных.
   */
  againstCondition: z
    .custom<ConditionRef>((value) => typeof value === 'string')
    .optional(),
  /** Спасбросок концентрации: «Боевой заклинатель» у адресата */
  againstConcentration: z.boolean().optional(),
  /** Преимущество или помеха самого спасброска */
  mode: z.enum(EFFECT_TRIGGER_SAVE_MODES).optional().catch(undefined),
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
