/**
 * Заголовок плашки запроса: «Аура жизни: выберите цель», «Опутывание — вопрос».
 *
 * Без источника — одна подпись с заглавной буквы; с источником подпись идёт
 * после него строчной.
 *
 * @param fallback - подпись запроса
 * @param separator - разделитель источника и подписи
 * @param sourceName - чей это запрос, если известно
 * @returns заголовок плашки
 */
export function formatPromptTitle(
  fallback: string,
  separator: string,
  sourceName?: string,
): string {
  return sourceName
    ? `${sourceName}${separator}${fallback.toLowerCase()}`
    : fallback;
}
