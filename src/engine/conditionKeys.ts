/**
 * Состояния D&D 5e (PHB 2024): перечень ключей и выведенный из него тип.
 *
 * Вынесены в отдельный leaf-модуль БЕЗ импортов, чтобы их можно было
 * использовать в `activeEffectTypes`/`actionRiders` без циклических зависимостей
 * (`consts.ts` — хаб с обратными связями через `types`/`creatureTypes`).
 * Реэкспортируется из `consts.ts` ради обратной совместимости импортов.
 */

/**
 * Ключ метки смерти.
 *
 * Не состояние PHB 2024, а системная метка: её ставит и снимает запас хитов
 * существа (`deathState.ts`), а ядро по ней рисует череп поверх токена. Ключ
 * живёт среди состояний, потому что метка едет обычным `ActiveEffect`, а его
 * `conditionKey` валидируется перечнем ниже — иначе сервер отбрасывал бы эффект
 * на границе боевого канала.
 */
export const DEATH_CONDITION_KEY = 'dead';

/** Полный список ключей состояний — единственный источник правды. */
export const CONDITION_KEYS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  // Метка смерти — вне перечня PHB, поэтому в конце списка, а не по алфавиту
  DEATH_CONDITION_KEY,
] as const;

/**
 * Ключ состояния D&D 5e (PHB 2024).
 *
 * Выводится из `CONDITION_KEYS`, а не пишется отдельным union'ом: тот же
 * перечень нужен в рантайме — Zod-схеме `ActiveEffect` (`conditionKey`,
 * `conditionImmunities`), иначе схема пропускала бы любую строку и тип поля был
 * бы неправдой. Один источник — список не может разойтись с типом.
 */
export type ConditionKey = (typeof CONDITION_KEYS)[number];
