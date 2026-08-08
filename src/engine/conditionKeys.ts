/**
 * Состояния D&D 5e (PHB 2024): перечень ключей и выведенный из него тип.
 *
 * Вынесены в отдельный leaf-модуль БЕЗ импортов, чтобы их можно было
 * использовать в `activeEffectTypes`/`actionRiders` без циклических зависимостей
 * (`consts.ts` — хаб с обратными связями через `types`/`creatureTypes`).
 * Реэкспортируется из `consts.ts` ради обратной совместимости импортов.
 */

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
