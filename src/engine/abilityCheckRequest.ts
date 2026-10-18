/**
 * Контракт запроса проверки характеристики или навыка у владельца сущности.
 *
 * Мастер просит игрока бросить проверку («Внимательность, Сл 15»), ядро
 * доставляет запрос адресно (`api.rollRequests`), а нагрузку и ответ для него
 * непрозрачны. Форма описана здесь один раз на обе стороны канала: окно
 * мастера нагрузку кладёт, слот адресата её разбирает, а ответ возвращается
 * в той же форме, что и у спасброска (`SavingThrowResult`): кость, модификатор,
 * итог и успех против Сл.
 *
 * @module system/dnd/abilityCheckRequest
 */

import type { AbilityType, SkillType } from '@vtt/shared';

import { z } from 'zod';

import {
  ABILITY_GENITIVE_LABELS,
  isAbilityType,
  isSkillType,
  SKILLS_LABELS,
} from './consts.js';
import {
  SAVING_THROW_REQUEST_TITLE_PARTS,
  withRequestSource,
} from './savingThrowRequest.js';

/**
 * Метка нашей нагрузки: по ней слот адресата отличает проверку от
 * спасброска, выбора цели и вопроса, которые едут тем же каналом.
 */
export const ABILITY_CHECK_REQUEST_KIND = 'abilityCheck';

/** Части подписи запроса проверки: «Проверка Ловкости (DC 15)» */
export const ABILITY_CHECK_REQUEST_TITLE_PARTS = {
  /** Проверка характеристики: дальше идёт её название в родительном падеже */
  abilityPrefix: 'Проверка ',
  /** Проверка навыка: дальше идёт название навыка */
  skillPrefix: 'Проверка навыка ',
} as const;

/** Поля нагрузки, общие для проверки характеристики и навыка */
const abilityCheckRequestBaseSchema = z.object({
  /** Метка формы — у чужого запроса она другая */
  kind: z.literal(ABILITY_CHECK_REQUEST_KIND),
  /** Сложность (Сл): с ней адресат сравнивает свой бросок */
  dc: z.number(),
  /** Кто просит — уходит в заголовок окна у адресата */
  sourceName: z.string().optional(),
});

/**
 * Нагрузка запроса проверки. Модификатора и режима здесь нет намеренно: их
 * считает сторона адресата по своей сущности, как и у спасброска.
 *
 * У навыка характеристики в нагрузке нет: её берут из настройки листа
 * бросающего (Атлетику переводят на Телосложение), как при броске с листа.
 */
export const abilityCheckRequestPayloadSchema = z.discriminatedUnion('check', [
  abilityCheckRequestBaseSchema.extend({
    /** Проверка характеристики */
    check: z.literal('ability'),
    /** Характеристика проверки */
    ability: z.custom<AbilityType>(isAbilityType),
  }),
  abilityCheckRequestBaseSchema.extend({
    /** Проверка навыка */
    check: z.literal('skill'),
    /** Навык проверки */
    skill: z.custom<SkillType>(
      (value) => typeof value === 'string' && isSkillType(value),
    ),
  }),
]);

/** Нагрузка запроса проверки (форма — `abilityCheckRequestPayloadSchema`) */
export type AbilityCheckRequestPayload = z.infer<
  typeof abilityCheckRequestPayloadSchema
>;

/** Что проверяют: характеристику или навык (нагрузка без служебных полей) */
export type AbilityCheckSubject =
  | Pick<
      Extract<AbilityCheckRequestPayload, { check: 'ability' }>,
      'check' | 'ability'
    >
  | Pick<
      Extract<AbilityCheckRequestPayload, { check: 'skill' }>,
      'check' | 'skill'
    >;

/**
 * Разбирает нагрузку запроса броска.
 *
 * @param value - непрозрачный `payload` запроса от ядра
 * @returns нагрузка проверки либо `null`, если форма чужая
 */
export function parseAbilityCheckRequestPayload(
  value: unknown,
): AbilityCheckRequestPayload | null {
  const parsed = abilityCheckRequestPayloadSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * Название проверки без сложности: «Проверка Ловкости», «Проверка навыка
 * Скрытность». Одно на подпись запроса, заголовок окна и строку чата.
 *
 * @param subject - что проверяют
 * @returns название проверки
 */
export function formatAbilityCheckName(subject: AbilityCheckSubject): string {
  const { abilityPrefix, skillPrefix } = ABILITY_CHECK_REQUEST_TITLE_PARTS;

  return subject.check === 'ability'
    ? `${abilityPrefix}${ABILITY_GENITIVE_LABELS[subject.ability]}`
    : `${skillPrefix}${SKILLS_LABELS[subject.skill]}`;
}

/**
 * Подпись запроса проверки для плашек ядра: «Проверка Ловкости (DC 15)».
 * Имени цели здесь нет: ядро показывает его само, рядом с подписью.
 *
 * @param subject - что проверяют
 * @param dc - сложность
 * @param sourceName - кто просит, если это стоит показать
 * @returns короткая подпись запроса
 */
export function formatAbilityCheckRequestTitle(
  subject: AbilityCheckSubject,
  dc: number,
  sourceName?: string,
): string {
  const { dcPrefix, dcSuffix } = SAVING_THROW_REQUEST_TITLE_PARTS;

  return withRequestSource(
    `${formatAbilityCheckName(subject)}${dcPrefix}${dc}${dcSuffix}`,
    sourceName,
  );
}
