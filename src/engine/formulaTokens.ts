/**
 * Инлайн-токены формул: тип урона `@dmg.<тип>`, лечение `@heal`/`@heal.temp`
 * и условие по цели `@target.<условие>`.
 *
 * Модуль знает только форму самих токенов — как их найти, снять и записать.
 * Зависимостей у него нет намеренно: форму токена спрашивают и движок, и
 * клиент, и разложи её по двум файлам — они разойдутся (так и было: показ
 * оружия резал `@healing` до `ing`, а разбор тот же `@healing` токеном не
 * считал). Всё, что выше уровнем — группировка слагаемых по видам, показ,
 * подстановка переменных, — живёт в `spellUtils.ts`.
 */

/** Регэксп инлайн-токена типа урона: `@dmg.fire`, `@dmg.cold` и т.п. */
const DAMAGE_TYPE_TOKEN_REGEX = /@dmg\.([a-z]+)/i;

/**
 * Глобальная версия {@link DAMAGE_TYPE_TOKEN_REGEX}: все токены типа урона
 * формулы — и для сбора типов (`matchAll`), и для вырезания (`replace`).
 * Звать на ней `.test()`/`.exec()` нельзя: у глобального регэкспа они двигают
 * `lastIndex`, и следующий вызов начнёт поиск с середины строки.
 */
export const DAMAGE_TYPE_TOKEN_GLOBAL_REGEX = /@dmg\.([a-z]+)/gi;

/**
 * Префикс инлайн-токена типа урона — дешёвая проверка «есть ли что снимать»
 * до полного разбора формулы.
 */
const DAMAGE_TYPE_TOKEN_PREFIX_REGEX = /@dmg\./i;

/**
 * Вид лечения сегмента формулы: обычные хиты (`@heal`) или временные ХП
 * (`@heal.temp`). Временные ХП не суммируются с текущими — берётся большее.
 */
export type HealKind = 'hp' | 'temp';

/**
 * Регэксп инлайн-токена лечения: `@heal` (хиты) или `@heal.temp` (врем. ХП).
 * Лукэхед запрещает хвост (`@heal.spell` НЕ матчится и всплывёт ошибкой
 * парсера формул, а не молча станет лечением).
 */
export const HEAL_TOKEN_REGEX = /@heal(\.temp)?(?![\w.])/i;

/** Глобальная версия {@link HEAL_TOKEN_REGEX} для вырезания токенов. */
const HEAL_TOKEN_STRIP_REGEX = /@heal(\.temp)?(?![\w.])/gi;

/**
 * Префикс инлайн-токена условия по цели (`@target.full`, `@target.type.undead`
 * и прочие) — проверка наличия без разбора самого условия.
 */
const TARGET_TOKEN_PREFIX_REGEX = /@target\./i;

/**
 * Есть ли в формуле инлайн-токен условия по цели.
 *
 * @param formula - формула части урона
 * @returns true, если в формуле есть `@target.<условие>`
 */
export function hasTargetToken(formula: string): boolean {
  return TARGET_TOKEN_PREFIX_REGEX.test(formula);
}

/**
 * Есть ли в формуле инлайн-токен типа урона.
 *
 * @param formula - формула части урона
 * @returns true, если в формуле есть хотя бы один `@dmg.<тип>`
 */
export function hasDamageTypeToken(formula: string): boolean {
  return DAMAGE_TYPE_TOKEN_PREFIX_REGEX.test(formula);
}

/**
 * Есть ли в формуле инлайн-токен лечения.
 *
 * Слово, которое лишь начинается с `@heal` (`@healing`), токеном не считается —
 * ограничитель тот же, что у разбора, иначе проверка и разбор разойдутся.
 *
 * @param formula - формула части урона
 * @returns true, если в формуле есть `@heal` или `@heal.temp`
 */
export function hasHealToken(formula: string): boolean {
  return HEAL_TOKEN_REGEX.test(formula);
}

/**
 * Удаляет инлайн-токены лечения `@heal`/`@heal.temp` из формулы
 * (для отображения и legacy-путей, где формула идёт в роллер целиком).
 *
 * @param formula - формула с возможными токенами @heal
 * @returns формула без токенов @heal (лишние пробелы схлопнуты)
 */
export function stripHealTokens(formula: string): string {
  if (!formula || !HEAL_TOKEN_REGEX.test(formula)) {
    return formula ?? '';
  }

  return formula
    .replace(HEAL_TOKEN_STRIP_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Определяет вид лечения из первого инлайн-токена `@heal`/`@heal.temp`.
 *
 * Формула — единственный источник истины вида части (legacy-флаг
 * `DamagePart.isHealing` удалён).
 *
 * @param formula - формула с возможным токеном @heal
 * @returns вид лечения или null, если токена нет
 */
export function detectFormulaHealKind(formula: string): HealKind | null {
  const match = formula.match(HEAL_TOKEN_REGEX);

  if (!match) {
    return null;
  }

  return match[1] ? 'temp' : 'hp';
}

/**
 * Удаляет инлайн-токены типа урона `@dmg.<type>` из формулы (для отображения).
 *
 * @param formula - формула с возможными токенами @dmg
 * @returns формула без токенов @dmg (лишние пробелы схлопнуты)
 */
export function stripDamageTypeTokens(formula: string): string {
  if (!formula || !DAMAGE_TYPE_TOKEN_PREFIX_REGEX.test(formula)) {
    return formula ?? '';
  }

  return formula
    .replace(DAMAGE_TYPE_TOKEN_GLOBAL_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Определяет тип урона из первого инлайн-токена `@dmg.<type>` в формуле.
 *
 * Используется как канонический источник типа части (формула — источник истины).
 *
 * @param formula - формула с возможным токеном @dmg
 * @returns тип урона (lowercase) или null, если токена нет
 */
export function detectFormulaDamageType(formula: string): string | null {
  const match = formula.match(DAMAGE_TYPE_TOKEN_REGEX);

  return match ? match[1].toLowerCase() : null;
}

/**
 * Устанавливает/заменяет токен `@dmg.<type>` на ПЕРВОМ слагаемом формулы.
 *
 * Первое слагаемое — «базовое»; его тип задаёт тип всех последующих слагаемых
 * без собственного токена (см. поток типов в `splitFormulaByDamageType`).
 * Пустой `type` — удаляет токен с первого слагаемого.
 *
 * Примеры: `setFormulaDamageType("1к8", "fire")` → `"1к8@dmg.fire"`;
 * `setFormulaDamageType("1к8@dmg.fire + @mod.spell", "cold")`
 * → `"1к8@dmg.cold + @mod.spell"`.
 *
 * @param formula - исходная формула
 * @param type - тип урона (или пустая строка для удаления)
 * @returns формула с обновлённым токеном типа на первом слагаемом
 */
export function setFormulaDamageType(formula: string, type: string): string {
  const terms = formula.split('+').map((term) => term.trim());

  const firstBase = (terms[0] ?? '')
    .replace(DAMAGE_TYPE_TOKEN_REGEX, '')
    .trim();

  terms[0] = type ? `${firstBase}@dmg.${type}` : firstBase;

  return terms.filter((term) => term.length > 0).join(' + ');
}
