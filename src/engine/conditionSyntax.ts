/**
 * Общий синтаксис условий: список значений в кавычках и токен выбора
 * владельца `@choice.<ключ>`.
 *
 * Условия эффектов пишутся строками (`target.creatureType === "undead,
 * fiend"`), и одно и то же — кавычки вокруг списка, запятая между значениями,
 * вид ключа выбора — читают словарь модификаторов, словарь срабатываний,
 * подстановка выбора владельца и окно эффекта. Правило записи живёт здесь, в
 * модуле без зависимостей: разойдись оно по файлам, разбор и подстановка
 * перестали бы понимать друг друга.
 *
 * @module system/dnd/conditionSyntax
 */

/** Разделитель значений списка в условии */
export const CONDITION_LIST_SEPARATOR = ',';

/** Кавычки вокруг списка */
const LIST_QUOTES_PATTERN = /^["']|["']$/g;

/** Начало токена выбора владельца: дальше — ключ выбора */
export const CHOICE_TOKEN_PREFIX = '@choice.';

/** Из чего состоит ключ выбора: буквы, цифры, `-`, `_`, `#`, `:` */
const CHOICE_KEY_SOURCE = String.raw`[\w#:-]+`;

/** Ключ выбора владельца целиком — проверка поля в окне эффекта */
export const CHOICE_KEY_PATTERN = new RegExp(`^${CHOICE_KEY_SOURCE}$`);

/** Значение целиком — токен выбора владельца; группа 1 — ключ */
const CHOICE_VALUE_PATTERN = new RegExp(
  String.raw`^@choice\.(${CHOICE_KEY_SOURCE})$`,
);

/**
 * Токен выбора в любом месте текста; группа 1 — ключ. Глобальный: годится
 * для `replaceAll` и `matchAll`, но не для `test`/`exec` — те двигают
 * `lastIndex`.
 */
export const CHOICE_TOKEN_GLOBAL_PATTERN = new RegExp(
  String.raw`@choice\.(${CHOICE_KEY_SOURCE})`,
  'g',
);

/**
 * Список из условия без кавычек вокруг него.
 *
 * @param text - список после оператора условия, возможно в кавычках
 * @returns список без крайних пробелов и кавычек
 */
export function stripListQuotes(text: string): string {
  return text.trim().replace(LIST_QUOTES_PATTERN, '');
}

/**
 * Значения списка через запятую: без крайних пробелов и пустых.
 *
 * @param text - список без кавычек
 * @returns значения по порядку записи
 */
export function splitConditionList(text: string): string[] {
  return text
    .split(CONDITION_LIST_SEPARATOR)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Значения списка из условия в нижнем регистре: кавычки сняты. Так
 * сверяются свободные названия (вид существа) и ключи (школа, тип урона),
 * записанные автором.
 *
 * @param text - список после приставки условия, возможно в кавычках
 * @returns значения в нижнем регистре, без пустых
 */
export function splitQuotedList(text: string): string[] {
  return splitConditionList(stripListQuotes(text)).map((value) =>
    value.toLowerCase(),
  );
}

/**
 * Ключ выбора владельца, если значение целиком — токен выбора.
 *
 * @param value - значение условия без кавычек
 * @returns ключ выбора либо `undefined`
 */
export function readChoiceKey(value: string): string | undefined {
  return CHOICE_VALUE_PATTERN.exec(value.trim())?.[1];
}
