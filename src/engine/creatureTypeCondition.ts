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
 *   аберрация или небожитель;
 * - `source.creatureType === "fiend, undead"` — спасбросок вызвал исчадие или
 *   нежить («Защита от зла и добра»: преимущество на такие спасброски).
 *
 * Список может быть не записан заранее, а взят из выбора владельца эффекта:
 * `target.creatureType === "@choice.monster-manual"` — типы, выбранные в
 * «Гримуаре монстров». Токен подставляет лист владельца
 * (`effectChoiceBinding.ts`); пока он не подставлен, условие не выполняется.
 * Тип в списке пишется ключом (`undead`) либо названием («Нежить») — так
 * значения выбора читаются, как бы их ни записал автор выбора.
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

import { typedObjectEntries } from '@vtt/shared';

import { CREATURE_CATEGORIES, isCreatureCategory } from './consts.js';

/** Типы существ с названиями — для чтения типа по названию */
const CREATURE_CATEGORY_ENTRIES = typedObjectEntries(CREATURE_CATEGORIES);

/** О ком условие: носитель, цель броска или атакующий у защиты */
export const CREATURE_TYPE_CONDITION_SUBJECTS = [
  'self.creatureType',
  'target.creatureType',
  'incoming.attackerCreatureType',
  'source.creatureType',
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
  /**
   * Ключ выбора владельца, из которого берётся список (`@choice.<ключ>`).
   * Задан — список ещё не подставлен, и условие не выполняется
   */
  choiceKey?: string;
}

/** Список типов целиком — токен выбора владельца */
const CHOICE_LIST_PATTERN = /^@choice\.([\w#:-]+)$/;

/** Начало токена выбора владельца в списке типов */
const CHOICE_LIST_PREFIX = '@choice.';

/**
 * Ключ типа по записи в списке: сам ключ либо название типа.
 *
 * @param text - запись списка в нижнем регистре
 * @returns ключ типа либо `undefined`, если тип незнакомый
 */
function readCreatureCategory(text: string): CreatureCategory | undefined {
  if (isCreatureCategory(text)) {
    return text;
  }

  return CREATURE_CATEGORY_ENTRIES.find(
    ([, label]) => label.toLowerCase() === text,
  )?.[0];
}

/** Разделитель типов внутри кавычек — общий для всего словаря условий */
export const CREATURE_TYPE_LIST_SEPARATOR = ',';

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

  const list = rest.slice(operator.length).trim().replace(QUOTES_PATTERN, '');
  const negate = operator === NOT_IN_OPERATOR;
  const choice = CHOICE_LIST_PATTERN.exec(list.trim());

  // Список — выбор владельца, который лист ещё не подставил
  if (choice) {
    return { types: [], negate, choiceKey: choice[1] };
  }

  const rawTypes = list
    .split(CREATURE_TYPE_LIST_SEPARATOR)
    .map((type) => type.trim().toLowerCase())
    .filter((type) => type.length > 0);

  const types = rawTypes.flatMap((type) => readCreatureCategory(type) ?? []);

  // Незнакомый тип делает непонятым всё условие: молча выкинутый тип сузил
  // бы список, и условие срабатывало бы не там, где задумано
  if (rawTypes.length === 0 || types.length !== rawTypes.length) {
    return undefined;
  }

  return { types: [...new Set(types)], negate };
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

  const list = condition.choiceKey
    ? `${CHOICE_LIST_PREFIX}${condition.choiceKey}`
    : condition.types.join(`${CREATURE_TYPE_LIST_SEPARATOR} `);

  return `${subject} ${operator} "${list}"`;
}

/**
 * Выполняется ли условие для типа существа. Дополнительные типы («получаете
 * тип существа цели в дополнение к собственному») считаются наравне с основным:
 * «из списка» — подходит любой из типов, «не из списка» — не подходит ни один.
 *
 * @param condition - условие
 * @param creatureType - тип существа; нет — данных нет
 * @param extraTypes - дополнительные типы существа
 * @returns `true`, если выполняется
 */
export function creatureTypeConditionHolds(
  condition: CreatureTypeCondition,
  creatureType: CreatureCategory | undefined,
  extraTypes: readonly CreatureCategory[] = [],
): boolean {
  // Список из выбора владельца не подставлен — данных для условия нет
  if (creatureType === undefined || condition.choiceKey !== undefined) {
    return false;
  }

  const inList = [creatureType, ...extraTypes].some((type) =>
    condition.types.includes(type),
  );

  return inList !== condition.negate;
}

/** Кто назван в подписи условия */
const SUBJECT_LABELS: Record<CreatureTypeConditionSubject, string> = {
  'self.creatureType': 'Носитель',
  'target.creatureType': 'Цель',
  'incoming.attackerCreatureType': 'Защита: атакующий',
  'source.creatureType': 'Источник спасброска',
};

/** Подписи списка, взятого из выбора владельца */
const CHOICE_LIST_LABELS = {
  in: 'тип из выбора владельца',
  not: 'тип не из выбора владельца',
} as const;

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
  if (condition.choiceKey) {
    return `${SUBJECT_LABELS[subject]} — ${
      condition.negate ? CHOICE_LIST_LABELS.not : CHOICE_LIST_LABELS.in
    } (${condition.choiceKey})`;
  }

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

/**
 * Субъект условия по типу, если значение — это он сам: пункт списка
 * «Действует», у которого типы выбираются вторым полем.
 *
 * @param value - значение пункта
 * @returns субъект либо `undefined`, если пункт о другом
 */
export function findCreatureTypeConditionSubject(
  value: string,
): CreatureTypeConditionSubject | undefined {
  return CREATURE_TYPE_CONDITION_SUBJECTS.find((subject) => subject === value);
}
