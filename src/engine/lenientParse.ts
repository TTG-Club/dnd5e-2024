/**
 * Терпимый разбор списков из недоверенных данных: негодный элемент
 * выбрасывается один, а не вместе со всем списком — снимок сущности
 * разбирается целиком, и одна чужая запись не должна ронять запись урона.
 */

import type { z } from 'zod';

/**
 * Годные элементы списка по схеме; не список — пусто.
 *
 * @param schema - схема элемента
 * @param value - значение из данных
 * @returns разобранные элементы по порядку
 */
export function parseEachValid<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
): Array<z.output<Schema>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((rawItem) => {
    const parsed = schema.safeParse(rawItem);

    return parsed.success ? [parsed.data] : [];
  });
}
