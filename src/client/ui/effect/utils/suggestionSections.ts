import type { EffectLibrarySuggestion } from '@vtt/shared/system/dnd.js';

/** Строка раздела на экране */
export interface SuggestionRow {
  suggestion: EffectLibrarySuggestion;
  /**
   * Показывать ли пояснение. Общее для раздела пояснение («считается по
   * листу») стоит у каждой строки данных, но на экране — только у первой
   * строки подряд: четырнадцать одинаковых строк под типами существ читать
   * никто не станет.
   */
  showHint: boolean;
}

/** Раздел библиотеки со строками для показа */
export interface SuggestionSection {
  /** Подпись раздела */
  label: string;
  rows: SuggestionRow[];
}

/**
 * Подписи разделов в порядке первого появления в списке.
 *
 * @param suggestions - строки библиотеки
 * @returns подписи разделов без повторов
 */
export function listSuggestionSections(
  suggestions: readonly EffectLibrarySuggestion[],
): string[] {
  return [...new Set(suggestions.map((suggestion) => suggestion.section))];
}

/**
 * Подходит ли строка под поиск: по названию, значению и пояснению — автор
 * ищет и «урон», и «steps», и «только у заклинания».
 *
 * @param suggestion - строка библиотеки
 * @param queryText - поисковая строка в нижнем регистре
 * @returns `true`, если строка подходит
 */
export function matchesSuggestionQuery(
  suggestion: EffectLibrarySuggestion,
  queryText: string,
): boolean {
  return [suggestion.label, suggestion.value, suggestion.hint ?? ''].some(
    (text) => text.toLowerCase().includes(queryText),
  );
}

/**
 * Раскладывает строки по разделам для показа: раздел встаёт туда, где
 * встретилась его первая строка, повтор пояснения соседней строки прячется.
 *
 * @param suggestions - строки библиотеки
 * @returns разделы со строками
 */
export function groupSuggestionsBySection(
  suggestions: readonly EffectLibrarySuggestion[],
): SuggestionSection[] {
  return listSuggestionSections(suggestions).map((label) => {
    const items = suggestions.filter(
      (suggestion) => suggestion.section === label,
    );

    return {
      label,
      rows: items.map((suggestion, index) => ({
        suggestion,
        showHint:
          Boolean(suggestion.hint)
          && suggestion.hint !== items[index - 1]?.hint,
      })),
    };
  });
}
