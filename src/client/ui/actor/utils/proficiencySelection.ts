/**
 * Общая логика владений, которые хранятся либо ключом конкретного предмета,
 * либо ключом целой категории (`martial`, `heavy`).
 *
 * Дары компендиума используют категории, а ручной редактор — конкретные ключи.
 * Оба представления обязаны давать одинаковый выбор в интерфейсе и не затирать
 * друг друга при сохранении.
 */

/** Базовый тип снаряжения, участвующий в выборе владений. */
export interface ProficiencyBaseType {
  /** Ключ конкретного вида снаряжения */
  key: string;
  /** Ключ его категории */
  category: string;
}

/**
 * Проверяет, выбрана ли категория целиком: явным ключом категории либо всеми
 * её конкретными видами.
 *
 * @param selected - текущие ключи владений
 * @param category - ключ проверяемой категории
 * @param categoryItems - конкретные виды этой категории
 * @returns `true`, если владение распространяется на всю категорию
 */
export function isProficiencyCategorySelected(
  selected: ReadonlySet<string>,
  category: string,
  categoryItems: ReadonlyArray<ProficiencyBaseType>,
): boolean {
  return (
    selected.has(category)
    || (categoryItems.length > 0
      && categoryItems.every((item) => selected.has(item.key)))
  );
}

/**
 * Проверяет владение конкретным видом с учётом владения всей его категорией.
 *
 * @param selected - текущие ключи владений
 * @param item - проверяемый вид снаряжения
 * @returns `true`, если выбран сам вид либо его категория
 */
export function isProficiencyItemSelected(
  selected: ReadonlySet<string>,
  item: ProficiencyBaseType,
): boolean {
  return selected.has(item.category) || selected.has(item.key);
}

/**
 * Переключает конкретный вид, сохраняя смысл владения категорией.
 *
 * При снятии одного вида из выданной категории категория заменяется остальными
 * конкретными видами: иначе снятие либо не работало бы, либо снимало владение
 * со всей группы. Прочие категории и ключи не изменяются.
 *
 * @param selected - текущие ключи владений
 * @param item - переключаемый вид снаряжения
 * @param categoryItems - все конкретные виды его категории
 * @returns новый набор ключей владений
 */
export function toggleProficiencyItem(
  selected: ReadonlySet<string>,
  item: ProficiencyBaseType,
  categoryItems: ReadonlyArray<ProficiencyBaseType>,
): Set<string> {
  const next = new Set(selected);

  if (!isProficiencyItemSelected(selected, item)) {
    next.add(item.key);

    return next;
  }

  if (selected.has(item.category)) {
    next.delete(item.category);

    for (const categoryItem of categoryItems) {
      if (categoryItem.key !== item.key) {
        next.add(categoryItem.key);
      }
    }
  }

  next.delete(item.key);

  return next;
}

/**
 * Переключает владение всей категорией.
 *
 * Явный ключ категории при снятии удаляется вместе с конкретными видами, а при
 * добавлении категория по-прежнему представляется набором конкретных ключей —
 * так сохраняется прежний формат ручного редактирования.
 *
 * @param selected - текущие ключи владений
 * @param category - ключ переключаемой категории
 * @param categoryItems - все конкретные виды этой категории
 * @returns новый набор ключей владений
 */
export function toggleProficiencyCategory(
  selected: ReadonlySet<string>,
  category: string,
  categoryItems: ReadonlyArray<ProficiencyBaseType>,
): Set<string> {
  const next = new Set(selected);

  const wasSelected = isProficiencyCategorySelected(
    selected,
    category,
    categoryItems,
  );

  if (wasSelected) {
    next.delete(category);
  }

  for (const item of categoryItems) {
    if (wasSelected) {
      next.delete(item.key);
    } else {
      next.add(item.key);
    }
  }

  return next;
}

/**
 * Оставляет только известные справочнику ключи владений.
 *
 * Категории передаются отдельно от конкретных видов: фильтр ручного редактора
 * обязан сохранить дары вроде `martial`, иначе простое открытие и сохранение
 * окна сотрёт их с листа. Устаревшие неизвестные ключи по-прежнему удаляются.
 *
 * @param selectedKeys - ключи владений на листе
 * @param baseTypes - известные конкретные виды снаряжения
 * @param categories - известные категории снаряжения
 * @returns отфильтрованные ключи в исходном порядке
 */
export function filterKnownProficiencyKeys(
  selectedKeys: ReadonlyArray<string>,
  baseTypes: ReadonlyArray<ProficiencyBaseType>,
  categories: ReadonlyArray<string>,
): string[] {
  const knownKeys = new Set(categories);

  for (const baseType of baseTypes) {
    knownKeys.add(baseType.key);
  }

  return selectedKeys.filter((key) => knownKeys.has(key));
}
