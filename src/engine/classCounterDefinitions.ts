import type {
  ClassCounterDefinition,
  ClassDefinition,
  SubclassDefinition,
} from './classTypes.js';
import type { ActorCounterState } from './types.js';

/**
 * Ресурсы класса и его подклассов из записи класса.
 *
 * Запись хранит ресурсы подклассов двумя способами. Выгрузка сайта кладёт их в
 * общий список класса с ключом подкласса (`VttgClassMapper.counters` в
 * core-api) — у `subclasses[].counters` там пусто. Форма мира — внутрь самого
 * подкласса (`SubclassDefinition.counters`). Лист обязан читать обе формы и
 * выдавать персонажу ресурсы ТОЛЬКО его подкласса: пока мастер брал список
 * класса целиком, воин получал кости превосходства и кости психической энергии
 * разом — ресурсы всех подклассов лежали в одном списке.
 *
 * @module engine/classCounterDefinitions
 */

/**
 * Ресурсы самого класса — без ресурсов его подклассов.
 *
 * @param definition - запись класса
 * @returns ресурсы, которые получает любой персонаж этого класса
 */
export function classOwnCounterDefinitions(
  definition: ClassDefinition,
): ClassCounterDefinition[] {
  return (definition.counters ?? []).filter((counter) => !counter.subclassKey);
}

/**
 * Ресурсы одного подкласса: из общего списка класса (выгрузка сайта) и из
 * самого подкласса (форма мира). Повтор по ключу отсеивается — у копии класса,
 * сохранённой формой, ресурс мог оказаться в обоих местах.
 *
 * Ключ подкласса ресурсу не проставляется: запись-подкласс мира несёт свои
 * ресурсы без него, и на листе они уже лежат без ключа — проставив его сейчас,
 * мастер не узнал бы их и выдал второй раз.
 *
 * @param definition - запись класса
 * @param subclassKey - ключ подкласса
 * @returns ресурсы подкласса; пусто, если подкласса нет или ресурсов у него нет
 */
export function subclassCounterDefinitions(
  definition: ClassDefinition,
  subclassKey: string,
): ClassCounterDefinition[] {
  const subclass: SubclassDefinition | undefined = definition.subclasses?.find(
    (entry) => entry.key === subclassKey,
  );

  const fromClass = (definition.counters ?? []).filter(
    (counter) => counter.subclassKey === subclassKey,
  );

  const seen = new Set<string>();

  return [...fromClass, ...(subclass?.counters ?? [])].filter((counter) => {
    if (seen.has(counter.key)) {
      return false;
    }

    seen.add(counter.key);

    return true;
  });
}

/**
 * Ресурсы, положенные персонажу с этим классом и выбранным подклассом: свои
 * ресурсы класса и ресурсы выбранного подкласса. Без подкласса — только свои.
 *
 * @param definition - запись класса
 * @param subclassKey - ключ выбранного подкласса; `null`/`undefined` — не выбран
 * @returns ресурсы записи в порядке «класс, затем подкласс»
 */
export function collectClassCounterDefinitions(
  definition: ClassDefinition,
  subclassKey: string | null | undefined,
): ClassCounterDefinition[] {
  return [
    ...classOwnCounterDefinitions(definition),
    ...(subclassKey ? subclassCounterDefinitions(definition, subclassKey) : []),
  ];
}

/**
 * Один ли это ресурс: счётчик на листе и определение из записи класса.
 *
 * Сравнение включает ключ подкласса: у двух подклассов ключ ресурса может
 * совпасть, и по одному ключу ресурса мастер принял бы чужой за свой.
 *
 * @param counter - счётчик на листе
 * @param classKey - ключ класса, чей ресурс проверяется
 * @param definition - определение ресурса из записи класса
 * @returns `true`, если счётчик заведён по этому определению
 */
export function isCounterOfDefinition(
  counter: ActorCounterState,
  classKey: string,
  definition: ClassCounterDefinition,
): boolean {
  return (
    counter.classKey === classKey
    && counter.counterKey === definition.key
    && (counter.subclassKey ?? undefined)
      === (definition.subclassKey ?? undefined)
  );
}

/**
 * Ресурс чужого подкласса этого класса: подкласс у персонажа один, и счётчик
 * с ключом другого подкласса мог попасть на лист только по ошибке — так и
 * случалось, пока мастер выдавал ресурсы всех подклассов сразу. Мастер снимает
 * такие при следующем повышении уровня.
 *
 * @param counter - счётчик на листе
 * @param classKey - ключ класса
 * @param subclassKey - ключ выбранного подкласса; `null`/`undefined` — не выбран
 * @returns `true`, если счётчик принадлежит подклассу, которого у персонажа нет
 */
export function isForeignSubclassCounter(
  counter: ActorCounterState,
  classKey: string,
  subclassKey: string | null | undefined,
): boolean {
  return (
    counter.classKey === classKey
    && Boolean(counter.subclassKey)
    && counter.subclassKey !== (subclassKey ?? undefined)
  );
}
