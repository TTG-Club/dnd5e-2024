/**
 * Утилита для централизованной генерации уникальных ID сущностей.
 *
 * Формат: `prefix_timestamp_random` (напр. `tok_1710000000000_ab3k7m9`)
 *
 * @module shared/generateId
 */

/** Хвост ID после префикса: `timestamp_random` */
const ID_TAIL_REGEX = /^\d+_[a-z0-9]+$/;

/**
 * Генерирует уникальный ID для сущности
 *
 * @param prefix - Префикс для ID (например, 'tok', 'msg', 'enc')
 * @returns Уникальный ID в формате `prefix_timestamp_random`
 */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Проверяет, что строка — ID, выданный `generateId` с указанным префиксом.
 *
 * Нужна там, где ID сущности приходит ОТ КЛИЕНТА (например, копия актёра при
 * вставке токена: id придумывает клиент, чтобы Ctrl + Z смог удалить копию).
 * Такой ID уходит в имя папки сущности, поэтому формат обязан быть строгим —
 * иначе `..` в нём увёл бы запись за пределы папки мира.
 *
 * @param value - проверяемое значение
 * @param prefix - ожидаемый префикс (например, 'actor')
 * @returns true, если строка имеет формат `prefix_timestamp_random`
 */
export function isGeneratedId(value: unknown, prefix: string): boolean {
  if (typeof value !== 'string' || !value.startsWith(`${prefix}_`)) {
    return false;
  }

  // Хвост проверяется ГОТОВЫМ шаблоном, а не собранным из префикса: попади в
  // префикс спецсимвол регулярки — проверка молча ослабла бы.
  return ID_TAIL_REGEX.test(value.slice(prefix.length + 1));
}
