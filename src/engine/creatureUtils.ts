/**
 * Утилиты для работы с данными существ (Бестиарий) D&D 5e.
 *
 * Содержит чистые функции для преобразования полей существ
 * (например, склейку абзацев описания действий в Markdown).
 */

import type {
  CreatureAction,
  CreatureActionRangeType,
} from './creatureTypes.js';

/** Разделитель абзацев Markdown в описаниях действий существ. */
const ACTION_DESCRIPTION_PARAGRAPH_SEPARATOR = '\n\n';

/**
 * Требует ли действие существа спасбросок. Пустой `saveType` и `none` значат
 * одно и то же — «спасброска нет»: старые записи пишут одно, окно правки
 * другое. Правило нужно листу, окну действия и макросу хотбара сразу, поэтому
 * живёт здесь, а не тремя копиями у них.
 *
 * @param action - действие существа
 * @returns `true`, если по действию бросают спасбросок
 */
export function creatureActionHasSave(action: CreatureAction): boolean {
  return !!action.saveType && action.saveType !== 'none';
}

/**
 * Объединяет абзацы описания действия существа в единую Markdown-строку.
 * @param action - действие существа
 * @returns описание действия в формате Markdown
 */
export function getActionDescriptionMarkdown(action: CreatureAction): string {
  return action.description.join(ACTION_DESCRIPTION_PARAGRAPH_SEPARATOR);
}

/**
 * Преобразует Markdown-описание из редактора в массив абзацев,
 * совместимый с моделью `CreatureAction`.
 * @param description - описание из редактора
 * @returns массив описаний для действия существа
 */
export function buildActionDescription(description: string): string[] {
  const trimmedDescription = description.trim();

  return trimmedDescription ? [trimmedDescription] : [];
}

/**
 * Синонимы типа дальности действия существа. Ключи — значение источника в
 * нижнем регистре без разделителей: так `MELEE_OR_RANGE` из перечисления
 * сайта и наш `meleeOrRanged` сходятся в одну запись.
 */
const CREATURE_RANGE_TYPE_ALIASES: Record<string, CreatureActionRangeType> = {
  melee: 'melee',
  ranged: 'ranged',
  range: 'ranged',
  meleeorranged: 'meleeOrRanged',
  meleeorrange: 'meleeOrRanged',
};

/**
 * Приводит тип дальности действия существа из компендиума или старого мира
 * к канону. Нормализация терпимая: незнакомое значение остаётся как есть —
 * бросок читает его рукопашной, как и раньше.
 *
 * @param value - значение поля `rangeType` записи
 * @returns канонический тип либо исходное значение, если оно незнакомое
 */
export function normalizeCreatureActionRangeType(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return (
    CREATURE_RANGE_TYPE_ALIASES[value.toLowerCase().replace(/[_\s-]/g, '')]
    ?? value
  );
}
