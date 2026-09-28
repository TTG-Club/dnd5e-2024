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
 * Токены вида одного слагаемого: `@heal`/`@heal.temp` (лечение важнее урона,
 * как и при группировке) либо все его `@dmg.<тип>` подряд.
 *
 * @param term - слагаемое формулы
 * @returns токены вида слагаемого или null, если их нет
 */
function readTermKindTokens(term: string): string | null {
  const heal = term.match(HEAL_TOKEN_REGEX);

  if (heal) {
    return heal[0];
  }

  const damage = [...term.matchAll(DAMAGE_TYPE_TOKEN_GLOBAL_REGEX)];

  return damage.length > 0 ? damage.map((match) => match[0]).join('') : null;
}

/**
 * Распространяет вид первого токена формулы на ведущие слагаемые без вида.
 *
 * Формулы вида `3к6+3@dmg.force` пишут тип в КОНЦЕ слагаемого-числа, а кость
 * перед ним токена не несёт. Без части со своим типом такие ведущие
 * слагаемые остались бы безтиповыми (сопротивления к ним не применяются),
 * поэтому токен(ы) вида первого слагаемого с видом — урона `@dmg.<тип>` или
 * лечения `@heal`/`@heal.temp` — дописываются к каждому слагаемому ДО него.
 * Дальше вид течёт слева направо как обычно.
 *
 * Звать, только когда у части нет своего типа: при заданном `part.type`
 * ведущие слагаемые берут его. Раскладку по веткам (`@target.*`,
 * `@self.status.*`) делать ПОСЛЕ этого вызова — ветка вырезает слагаемые, и
 * без токена на месте ведущая кость ветки потеряла бы тип.
 *
 * Примеры: `3к6+3@dmg.force` → `3к6@dmg.force+3@dmg.force`;
 * `1к8+3@heal` → `1к8@heal+3@heal`; формула без токенов вида — как есть.
 *
 * @param formula - формула части урона/лечения
 * @returns формула, где у ведущих слагаемых есть токен вида
 */
export function spreadLeadingKindToken(formula: string): string {
  if (!formula || (!hasDamageTypeToken(formula) && !hasHealToken(formula))) {
    return formula ?? '';
  }

  const terms = formula.split('+');

  const firstKindIndex = terms.findIndex(
    (term) => readTermKindTokens(term) !== null,
  );

  const kindTokens =
    firstKindIndex > 0 ? readTermKindTokens(terms[firstKindIndex]) : null;

  if (!kindTokens) {
    return formula;
  }

  return terms
    .map((term, index) =>
      index < firstKindIndex && term.trim().length > 0
        ? term.replace(/\s*$/, (tail) => `${kindTokens}${tail}`)
        : term,
    )
    .join('+');
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

// ── Состояния в формуле: слагаемое только при состоянии стороны ──

/**
 * Чьё состояние проверяет токен: `self` — того, кто бросает (атакующий,
 * заклинатель, существо со своим действием), `target` — цели урона.
 */
export type StatusTokenSide = 'self' | 'target';

/**
 * Токены состояний: `@self.status.<ключ>` и `@target.status.<ключ>`, ключ —
 * состояния из справочника (`prone`, `bloodied`, своё состояние мира). Как и
 * `@target.full`, токен — гейт на своё слагаемое: «1к8 + 2к6@target.status.prone»
 * добавляет 2к6, только если цель лежит ничком. Отрицания нет: «иначе другой
 * урон» — это урон «или» действия, а не формула.
 */
const STATUS_TOKEN_REGEX = /@(self|target)\.status\.([a-z0-9][a-z0-9-]*)/i;

/** Глобальная версия {@link STATUS_TOKEN_REGEX} — только для вырезания */
const STATUS_TOKEN_STRIP_REGEX =
  /\s*@(?:self|target)\.status\.[a-z0-9][a-z0-9-]*/gi;

/** Токен состояния, найденный в слагаемом */
export interface StatusToken {
  /** Чьё состояние */
  side: StatusTokenSide;
  /** Ключ состояния */
  status: string;
}

/**
 * Собирает токен состояния.
 *
 * @param side - чьё состояние
 * @param status - ключ состояния
 * @returns токен вида `@target.status.prone`
 */
export function buildStatusToken(
  side: StatusTokenSide,
  status: string,
): string {
  return `@${side}.status.${status}`;
}

/**
 * Первый токен состояния в слагаемом или формуле.
 *
 * @param formula - слагаемое или формула
 * @returns токен либо `null`, если его нет
 */
export function readStatusToken(formula: string): StatusToken | null {
  const match = formula.match(STATUS_TOKEN_REGEX);

  if (!match) {
    return null;
  }

  return {
    side: match[1].toLowerCase() === 'self' ? 'self' : 'target',
    status: match[2].toLowerCase(),
  };
}

/**
 * Есть ли в формуле токен состояния нужной стороны.
 *
 * @param formula - формула части урона
 * @param side - чьё состояние; не задано — любой стороны
 * @returns true, если токен есть
 */
export function hasStatusToken(
  formula: string,
  side?: StatusTokenSide,
): boolean {
  return formula.split('+').some((term) => {
    const token = readStatusToken(term);

    return token !== null && (side === undefined || token.side === side);
  });
}

/**
 * Удаляет токены состояний из формулы (для показа).
 *
 * @param formula - формула с возможными токенами состояний
 * @returns формула без них (лишние пробелы схлопнуты)
 */
export function stripStatusTokens(formula: string): string {
  if (!formula || !STATUS_TOKEN_REGEX.test(formula)) {
    return formula ?? '';
  }

  return formula
    .replace(STATUS_TOKEN_STRIP_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Гасит слагаемые, чьего состояния у стороны нет, — ГЕЙТ НА СЛАГАЕМОЕ, как у
 * `@target.full`. Слагаемое без токена этой стороны остаётся как есть; у
 * оставленных токен снимается. Неактивное слагаемое удаляется целиком, а не
 * зануляется: иначе хвост без типа прилип бы к пустому месту.
 *
 * @param formula - формула с токенами состояний
 * @param side - чьи состояния известны
 * @param hasStatus - есть ли у стороны состояние с этим ключом
 * @returns формула с оставленными слагаемыми
 */
export function applyStatusConditionals(
  formula: string,
  side: StatusTokenSide,
  hasStatus: (status: string) => boolean,
): string {
  if (!formula || !hasStatusToken(formula, side)) {
    return formula ?? '';
  }

  const kept: string[] = [];

  for (const rawTerm of formula.split('+')) {
    const token = readStatusToken(rawTerm);
    const ownToken = token?.side === side ? token : null;

    if (ownToken && !hasStatus(ownToken.status)) {
      continue;
    }

    const term = ownToken
      ? rawTerm.replace(STATUS_TOKEN_STRIP_REGEX, '').trim()
      : rawTerm.trim();

    if (term.length > 0) {
      kept.push(term);
    }
  }

  return kept.join(' + ').trim();
}

/** Ветка формулы по состоянию цели */
export interface TargetStatusBranch {
  /** Состояние, при котором ветка достаётся цели; нет — любой цели */
  status?: string;
  /** Формула ветки со снятыми токенами состояний цели */
  formula: string;
}

/**
 * Раскладывает формулу по состояниям цели — цель неизвестна до нанесения
 * урона. Слагаемые без токена — одна ветка для любой цели; слагаемые с
 * состоянием — по ветке на состояние, сверху безусловной (как ветки по типу
 * существа: не исключают друг друга, а добавляются «своим»).
 *
 * @param formula - формула с возможными токенами `@target.status.*`
 * @returns ветки с непустыми формулами
 */
export function splitByTargetStatus(formula: string): TargetStatusBranch[] {
  if (!formula || !hasStatusToken(formula, 'target')) {
    return [{ formula: formula ?? '' }];
  }

  const unconditional: string[] = [];
  const byStatus = new Map<string, string[]>();

  for (const rawTerm of formula.split('+')) {
    const token = readStatusToken(rawTerm);

    if (!token || token.side !== 'target') {
      const term = rawTerm.trim();

      if (term.length > 0) {
        unconditional.push(term);
      }

      continue;
    }

    const cleaned = rawTerm.replace(STATUS_TOKEN_STRIP_REGEX, '').trim();

    if (cleaned.length === 0) {
      continue;
    }

    byStatus.set(token.status, [
      ...(byStatus.get(token.status) ?? []),
      cleaned,
    ]);
  }

  return [
    ...(unconditional.length > 0
      ? [{ formula: unconditional.join(' + ') }]
      : []),
    ...[...byStatus].map(([status, terms]) => ({
      status,
      formula: terms.join(' + '),
    })),
  ];
}
