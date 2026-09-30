/**
 * Условие по типу существа: тип носителя, цели или атакующего — из списка
 * или вне его.
 *
 * «Защита от зла и добра» — атакующий аберрация, небожитель, элементаль, фея,
 * исчадие или нежить; «Магический круг» — те же типы; бонус против «избранных
 * врагов» — цель одного из выбранных типов; «цель не исчадие». Одного типа
 * здесь мало, поэтому условие пишется списком в кавычках через запятую, а
 * «не из списка» — оператором `!==`:
 *
 * - `target.creatureType === "undead, fiend"` — цель нежить или исчадие;
 * - `self.creatureType !== "construct, undead"` — носитель не конструкт и не
 *   нежить;
 * - `incoming.attackerCreatureType === "aberration, celestial"` — атакует
 *   аберрация или небожитель.
 *
 * Одиночный тип (`=== "undead"`) — тот же список из одного. Разбор один на
 * все места словаря условий: модификаторы, условие броска эффекта (бонусы,
 * преимущество и помеха), защиту от входящей атаки, срабатывания и отбор
 * кандидатов. Тип, которого нет в данных (текстовое существо), условию не
 * отвечает ни «да», ни «нет»: часть без данных не выполняется.
 *
 * @module system/dnd/creatureTypeCondition
 */

import type { CreatureCategory } from './creatureTypes.js';

import { CREATURE_CATEGORIES, isCreatureCategory } from './consts.js';

/** О ком условие: носитель, цель броска или атакующий у защиты */
export const CREATURE_TYPE_CONDITION_SUBJECTS = [
  'self.creatureType',
  'target.creatureType',
  'incoming.attackerCreatureType',
] as const;

/** О ком условие по типу существа */
export type CreatureTypeConditionSubject =
  (typeof CREATURE_TYPE_CONDITION_SUBJECTS)[number];

/** Разобранное условие по типу существа */
export interface CreatureTypeCondition {
  /** Типы списка по порядку, без повторов */
  types: CreatureCategory[];
  /** «Не из списка» */
  negate: boolean;
}

/** Разделитель типов внутри кавычек */
const TYPE_LIST_SEPARATOR = ',';

/** Оператор «из списка» */
const IN_OPERATOR = '===';

/** Оператор «не из списка» */
const NOT_IN_OPERATOR = '!==';

/** Кавычки вокруг списка */
const QUOTES_PATTERN = /^["']|["']$/g;

/**
 * Разбирает часть условия по типу существа.
 *
 * @param part - часть условия
 * @param subject - о ком условие
 * @returns условие либо `undefined`, если часть о другом или тип незнакомый
 */
export function parseCreatureTypeCondition(
  part: string,
  subject: CreatureTypeConditionSubject,
): CreatureTypeCondition | undefined {
  const trimmed = part.trim();

  if (!trimmed.startsWith(`${subject} `)) {
    return undefined;
  }

  const rest = trimmed.slice(subject.length).trim();

  const operator = [IN_OPERATOR, NOT_IN_OPERATOR].find((candidate) =>
    rest.startsWith(candidate),
  );

  if (!operator) {
    return undefined;
  }

  const rawTypes = rest
    .slice(operator.length)
    .trim()
    .replace(QUOTES_PATTERN, '')
    .split(TYPE_LIST_SEPARATOR)
    .map((type) => type.trim().toLowerCase())
    .filter((type) => type.length > 0);

  // Незнакомый тип делает непонятым всё условие: молча выкинутый тип сузил
  // бы список, и условие срабатывало бы не там, где задумано
  if (rawTypes.length === 0 || !rawTypes.every(isCreatureCategory)) {
    return undefined;
  }

  return {
    types: [...new Set(rawTypes.filter(isCreatureCategory))],
    negate: operator === NOT_IN_OPERATOR,
  };
}

/**
 * Часть условия по типу существа строкой словаря.
 *
 * @param subject - о ком условие
 * @param condition - типы и отрицание
 * @returns часть условия
 */
export function writeCreatureTypeCondition(
  subject: CreatureTypeConditionSubject,
  condition: CreatureTypeCondition,
): string {
  const operator = condition.negate ? NOT_IN_OPERATOR : IN_OPERATOR;

  return `${subject} ${operator} "${condition.types.join(`${TYPE_LIST_SEPARATOR} `)}"`;
}

/**
 * Выполняется ли условие для типа существа.
 *
 * @param condition - условие
 * @param creatureType - тип существа; нет — данных нет
 * @returns `true`, если выполняется
 */
export function creatureTypeConditionHolds(
  condition: CreatureTypeCondition,
  creatureType: CreatureCategory | undefined,
): boolean {
  if (creatureType === undefined) {
    return false;
  }

  return condition.types.includes(creatureType) !== condition.negate;
}

/** Кто назван в подписи условия */
const SUBJECT_LABELS: Record<CreatureTypeConditionSubject, string> = {
  'self.creatureType': 'Носитель',
  'target.creatureType': 'Цель',
  'incoming.attackerCreatureType': 'Защита: атакующий',
};

/**
 * Условие словами: «Цель: Нежить или Исчадие», «Носитель: не Конструкт и не
 * Нежить».
 *
 * @param subject - о ком условие
 * @param condition - типы и отрицание
 * @returns подпись
 */
export function describeCreatureTypeCondition(
  subject: CreatureTypeConditionSubject,
  condition: CreatureTypeCondition,
): string {
  const names = condition.types.map((type) => CREATURE_CATEGORIES[type]);

  const list = condition.negate
    ? names.map((name) => `не ${name}`).join(' и ')
    : names.join(' или ');

  return `${SUBJECT_LABELS[subject]} — ${list}`;
}

/**
 * Разбирает часть условия по типу существа о любом субъекте.
 *
 * @param part - часть условия
 * @returns субъект и условие либо `undefined`
 */
export function parseAnyCreatureTypeCondition(
  part: string,
):
  | { subject: CreatureTypeConditionSubject; condition: CreatureTypeCondition }
  | undefined {
  for (const subject of CREATURE_TYPE_CONDITION_SUBJECTS) {
    const condition = parseCreatureTypeCondition(part, subject);

    if (condition) {
      return { subject, condition };
    }
  }

  return undefined;
}
