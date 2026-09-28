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

/**
 * Регэксп инлайн-токена типа урона: `@dmg.fire`, `@dmg.cold` и т.п.
 *
 * Лукэхед не даёт принять за тип начало токена «тип на выбор»
 * (`@dmg.choice(fire,cold)`): без него `choice` стал бы типом урона, а
 * скобка с вариантами — мусором в формуле.
 */
const DAMAGE_TYPE_TOKEN_REGEX = /@dmg\.([a-z]+)(?![a-z]|\s*\()/i;

/**
 * Глобальная версия {@link DAMAGE_TYPE_TOKEN_REGEX}: все токены типа урона
 * формулы — и для сбора типов (`matchAll`), и для вырезания (`replace`).
 * Звать на ней `.test()`/`.exec()` нельзя: у глобального регэкспа они двигают
 * `lastIndex`, и следующий вызов начнёт поиск с середины строки.
 */
export const DAMAGE_TYPE_TOKEN_GLOBAL_REGEX = /@dmg\.([a-z]+)(?![a-z]|\s*\()/gi;

/**
 * Токен «тип урона на выбор»: `@dmg.choice(acid,cold,fire)` — тип выбирает
 * бросающий перед броском, `@dmg.random(acid,cold,fire)` — тип выпадает
 * случайно с равными шансами. Варианты — ключи типов через запятую.
 *
 * Это не «урон всеми типами сразу», как несколько `@dmg.<тип>` подряд на
 * одной кости: бросок получает ровно один тип из списка.
 */
const DAMAGE_TYPE_CHOICE_TOKEN_REGEX = /@dmg\.(choice|random)\s*\(([^()]*)\)/i;

/** Глобальная версия {@link DAMAGE_TYPE_CHOICE_TOKEN_REGEX} — для замены и вырезания */
const DAMAGE_TYPE_CHOICE_TOKEN_GLOBAL_REGEX =
  /@dmg\.(choice|random)\s*\(([^()]*)\)/gi;

/**
 * Любой токен вида урона слагаемого — `@dmg.<тип>` или `@dmg.choice(…)` —
 * в порядке записи.
 */
const DAMAGE_KIND_TOKEN_GLOBAL_REGEX =
  /@dmg\.(?:(?:choice|random)\s*\([^()]*\)|[a-z]+(?![a-z]|\s*\())/gi;

/** Как выбирается тип урона токена «на выбор» */
export type DamageTypeChoiceMode = 'choose' | 'random';

/** Ключевые слова токена «на выбор» по способу выбора */
const DAMAGE_TYPE_CHOICE_KEYWORDS: Record<DamageTypeChoiceMode, string> = {
  choose: 'choice',
  random: 'random',
};

/** Тип урона на выбор, записанный токеном в формуле */
export interface DamageTypeChoice {
  /** Способ выбора: спросить бросающего или бросить случай */
  mode: DamageTypeChoiceMode;
  /** Ключи типов урона — варианты по порядку записи, без повторов */
  options: string[];
}

/**
 * Ключ типа на выбор: одинаковые списки у разных слагаемых и частей — один
 * вопрос на бросок.
 *
 * @param choice - способ и варианты
 * @returns ключ вида `choose:fire,cold`
 */
export function damageTypeChoiceKey(choice: DamageTypeChoice): string {
  return `${choice.mode}:${choice.options.join(',')}`;
}

/**
 * Разбирает варианты токена «на выбор»: ключи через запятую, регистр и
 * пробелы не важны, повторы и пустые места выбрасываются.
 *
 * @param mode - способ выбора
 * @param rawOptions - содержимое скобок токена
 * @returns тип на выбор; без вариантов — `null`
 */
function parseDamageTypeChoice(
  mode: DamageTypeChoiceMode,
  rawOptions: string,
): DamageTypeChoice | null {
  const options = [
    ...new Set(
      rawOptions
        .split(',')
        .map((option) => option.trim().toLowerCase())
        .filter((option) => option.length > 0),
    ),
  ];

  return options.length > 0 ? { mode, options } : null;
}

/**
 * Способ выбора по ключевому слову токена.
 *
 * @param keyword - `choice` или `random`
 * @returns способ выбора
 */
function readChoiceMode(keyword: string): DamageTypeChoiceMode {
  return keyword.toLowerCase() === DAMAGE_TYPE_CHOICE_KEYWORDS.random
    ? 'random'
    : 'choose';
}

/**
 * Первый токен «тип урона на выбор» в слагаемом или формуле.
 *
 * @param formula - слагаемое или формула
 * @returns тип на выбор либо `null`, если токена нет (или он без вариантов)
 */
export function readDamageTypeChoiceToken(
  formula: string,
): DamageTypeChoice | null {
  const match = formula.match(DAMAGE_TYPE_CHOICE_TOKEN_REGEX);

  return match
    ? parseDamageTypeChoice(readChoiceMode(match[1]), match[2])
    : null;
}

/**
 * Все токены «тип урона на выбор» формулы по порядку записи.
 *
 * @param formula - формула
 * @returns типы на выбор (повторы не схлопываются)
 */
export function listDamageTypeChoiceTokens(
  formula: string,
): DamageTypeChoice[] {
  if (!formula) {
    return [];
  }

  return [...formula.matchAll(DAMAGE_TYPE_CHOICE_TOKEN_GLOBAL_REGEX)].flatMap(
    (match) => parseDamageTypeChoice(readChoiceMode(match[1]), match[2]) ?? [],
  );
}

/**
 * Есть ли в формуле токен «тип урона на выбор».
 *
 * @param formula - формула
 * @returns true, если есть `@dmg.choice(…)` или `@dmg.random(…)`
 */
export function hasDamageTypeChoiceToken(formula: string): boolean {
  return Boolean(formula) && DAMAGE_TYPE_CHOICE_TOKEN_REGEX.test(formula);
}

/**
 * Собирает токен «тип урона на выбор».
 *
 * @param choice - способ и варианты
 * @returns токен вида `@dmg.choice(fire,cold)`
 */
export function buildDamageTypeChoiceToken(choice: DamageTypeChoice): string {
  return `@dmg.${DAMAGE_TYPE_CHOICE_KEYWORDS[choice.mode]}(${choice.options.join(',')})`;
}

/**
 * Заменяет токены «на выбор» итогом выбора: `@dmg.choice(fire,cold)` →
 * `@dmg.fire`. Токен, для которого `pick` ничего не вернул, остаётся как есть.
 *
 * @param formula - формула
 * @param pick - выбранный тип по токену; `undefined` — не заменять
 * @returns формула с выбранными типами
 */
export function replaceDamageTypeChoiceTokens(
  formula: string,
  pick: (choice: DamageTypeChoice) => string | undefined,
): string {
  if (!hasDamageTypeChoiceToken(formula)) {
    return formula;
  }

  return formula.replace(
    DAMAGE_TYPE_CHOICE_TOKEN_GLOBAL_REGEX,
    (token, keyword: string, rawOptions: string) => {
      const choice = parseDamageTypeChoice(readChoiceMode(keyword), rawOptions);
      const picked = choice ? pick(choice) : undefined;

      return picked ? `@dmg.${picked}` : token;
    },
  );
}

/**
 * Префикс инлайн-токена типа урона — дешёвая проверка «есть ли что снимать»
 * до полного разбора формулы.
 */
const DAMAGE_TYPE_TOKEN_PREFIX_REGEX = /@dmg\./i;

/**
 * Делит формулу на слагаемые верхнего уровня: по `+` вне скобок.
 *
 * `(1к8+3)@dmg.fire` — одно слагаемое: токен после скобки относится ко всей
 * скобке, а простое деление по `+` оставило бы обрывки «(1к8» и «3)», и
 * роллер их не разберёт. Слагаемые не обрезаются — `join('+')` собирает
 * исходную строку обратно.
 *
 * @param formula - формула
 * @returns слагаемые верхнего уровня
 */
export function splitFormulaTerms(formula: string): string[] {
  const terms: string[] = [];

  let depth = 0;
  let current = '';

  for (const char of formula) {
    if (char === '(') {
      depth++;
    } else if (char === ')' && depth > 0) {
      depth--;
    }

    if (char === '+' && depth === 0) {
      terms.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  terms.push(current);

  return terms;
}

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
 * Удаляет инлайн-токены типа урона `@dmg.<type>` и `@dmg.choice(…)` из
 * формулы (для отображения).
 *
 * @param formula - формула с возможными токенами @dmg
 * @returns формула без токенов @dmg (лишние пробелы схлопнуты)
 */
export function stripDamageTypeTokens(formula: string): string {
  if (!formula || !DAMAGE_TYPE_TOKEN_PREFIX_REGEX.test(formula)) {
    return formula ?? '';
  }

  return formula
    .replace(DAMAGE_TYPE_CHOICE_TOKEN_GLOBAL_REGEX, '')
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
 * как и при группировке) либо все его `@dmg.<тип>` и `@dmg.choice(…)` подряд.
 *
 * @param term - слагаемое формулы
 * @returns токены вида слагаемого или null, если их нет
 */
function readTermKindTokens(term: string): string | null {
  const heal = term.match(HEAL_TOKEN_REGEX);

  if (heal) {
    return heal[0];
  }

  const damage = [...term.matchAll(DAMAGE_KIND_TOKEN_GLOBAL_REGEX)];

  return damage.length > 0 ? damage.map((match) => match[0]).join('') : null;
}

/**
 * Токены-гейты слагаемого: условия по цели (`@target.full`,
 * `@target.type.undead`, `@target.status.prone`) и по состоянию бросающего
 * (`@self.status.bloodied`).
 */
const GATE_TOKEN_GLOBAL_REGEX =
  /@(?:target\.[a-z0-9.-]*[a-z0-9]|self\.status\.[a-z0-9][a-z0-9-]*)/gi;

/**
 * Любой инлайн-токен `@…` — снимается перед проверкой «есть ли в слагаемом
 * кость». Токен «на выбор» снимается вместе со скобкой вариантов.
 */
const ANY_TOKEN_REGEX = /@dmg\.(?:choice|random)\s*\([^()]*\)|@[\w.-]+/gi;

/** Кость в слагаемом: `2к6`, `1d8`, `к20` */
const DICE_IN_TERM_REGEX = /\d*\s*[кдd]\s*\d+/i;

/**
 * Гейты слагаемого одной строкой — в том порядке, в каком они записаны.
 *
 * @param term - слагаемое формулы
 * @returns токены-гейты подряд; пустая строка, если их нет
 */
function readTermGateTokens(term: string): string {
  return [...term.matchAll(GATE_TOKEN_GLOBAL_REGEX)]
    .map((match) => match[0])
    .join('');
}

/**
 * Есть ли в слагаемом кость — без учёта токенов (`@mod.dex` костью не считается).
 *
 * @param term - слагаемое формулы
 * @returns true, если слагаемое бросает кость
 */
function isDiceTerm(term: string): boolean {
  return DICE_IN_TERM_REGEX.test(term.replace(ANY_TOKEN_REGEX, ''));
}

/**
 * Дописывает токены в конец слагаемого, сохраняя пробелы вокруг `+`.
 *
 * @param term - слагаемое формулы
 * @param tokens - токены подряд
 * @returns слагаемое с токенами
 */
function appendTermTokens(term: string, tokens: string): string {
  return term.replace(/\s*$/, (tail) => `${tokens}${tail}`);
}

/**
 * Раздаёт вид (и условия) слагаемым без своего вида по правилу «тип в конце
 * блока».
 *
 * Формулы существ TTG Club пишут тип на ЧИСЛЕ в конце блока:
 * `1к8+3@dmg.piercing + 2к6+1@dmg.poison` — «1к8 + 3 колющего и 2к6 + 1 яда».
 * Кость блока токена не несёт, и при простом потоке слева направо 2к6 стала бы
 * колющей. Поэтому слагаемое с видом БЕЗ кости (число, `@mod.*`, `@heal` на
 * числе) закрывает свой блок: все слагаемые без вида после предыдущего
 * слагаемого с видом получают его вид, а если у них нет своих условий — и его
 * условия (`2к6+2@dmg.cold@target.status.prone` — условный блок целиком).
 *
 * Токен на КОСТИ (`2к6@dmg.fire`) — запись заклинаний: вид течёт от него
 * вправо, назад он забирает только ведущие слагаемые формулы, и только вид.
 * Число после такой кости (`3к8@dmg.force + 7 + 3к10@dmg.psychic`) остаётся
 * с ней: вид у следующего блока на кости, а не на числе.
 *
 * Ведущие слагаемые (до первого вида) при заданном типе части (`hasOwnType`)
 * не трогаются — они берут тип части: `1к8 + 2@dmg.fire` у рубящего оружия —
 * рубящий 1к8 и 2 огнём.
 *
 * Раскладку по веткам (`@target.*`, `@self.status.*`) делать ПОСЛЕ этого
 * вызова — ветка вырезает слагаемые, и без токена на месте кость ветки
 * потеряла бы тип.
 *
 * Примеры: `3к6+3@dmg.force` → `3к6@dmg.force+3@dmg.force`;
 * `1к8+3@heal` → `1к8@heal+3@heal`; формула без токенов вида — как есть.
 *
 * @param formula - формула части урона/лечения
 * @param hasOwnType - у части свой тип: ведущие слагаемые берут его
 * @returns формула, где у слагаемых блоков есть токен вида
 */
export function spreadKindTokens(formula: string, hasOwnType = false): string {
  if (!formula || (!hasDamageTypeToken(formula) && !hasHealToken(formula))) {
    return formula ?? '';
  }

  const terms = splitFormulaTerms(formula);
  const result = [...terms];

  // Начало текущего блока: первое слагаемое после предыдущего слагаемого с видом
  let blockStart = 0;

  for (const [index, term] of terms.entries()) {
    const kindTokens = readTermKindTokens(term);

    if (!kindTokens) {
      continue;
    }

    const isLeading = blockStart === 0;
    const closesBlock = !isDiceTerm(term);

    // Ведущие слагаемые при типе части — его; токен на кости назад берёт
    // только ведущие слагаемые и только вид
    const claims = isLeading ? !hasOwnType : closesBlock;
    const gateTokens = closesBlock ? readTermGateTokens(term) : '';
    const claimFrom = blockStart;

    blockStart = index + 1;

    if (!claims) {
      continue;
    }

    for (let claimed = claimFrom; claimed < index; claimed++) {
      const claimedTerm = terms[claimed];

      if (claimedTerm.trim().length === 0) {
        continue;
      }

      const ownGates = readTermGateTokens(claimedTerm);

      result[claimed] = appendTermTokens(
        claimedTerm,
        ownGates ? kindTokens : `${kindTokens}${gateTokens}`,
      );
    }
  }

  return result.join('+');
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
  const terms = splitFormulaTerms(formula).map((term) => term.trim());

  // Выбранный тип заменяет и тип на выбор: у слагаемого вид один
  const firstBase = (terms[0] ?? '')
    .replace(DAMAGE_TYPE_CHOICE_TOKEN_REGEX, '')
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
  return splitFormulaTerms(formula).some((term) => {
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

  for (const rawTerm of splitFormulaTerms(formula)) {
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

  for (const rawTerm of splitFormulaTerms(formula)) {
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
