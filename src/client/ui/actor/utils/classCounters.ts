import type {
  ActorCounterState,
  ClassCounterDefinition,
} from '@vtt/shared/system/dnd.js';

/**
 * Находит определение счётчика в переданном списке определений компендиума.
 * Сначала пытается сопоставить по ключу счётчика и ключу подкласса,
 * если совпадение не найдено — ищет по ключу счётчика в целом.
 *
 * @param counter - состояние счётчика на акторе
 * @param counterDefinitions - список определений счётчиков классов
 * @returns найденное определение счётчика или undefined
 */
export function findCounterDefinition(
  counter: ActorCounterState,
  counterDefinitions: ClassCounterDefinition[],
): ClassCounterDefinition | undefined {
  const exactDefinition = counterDefinitions.find(
    (definition) =>
      definition.key === counter.counterKey
      && definition.subclassKey === counter.subclassKey,
  );

  if (exactDefinition) {
    return exactDefinition;
  }

  const matchingDefinitions = counterDefinitions.filter(
    (definition) => definition.key === counter.counterKey,
  );

  return matchingDefinitions.length === 1 ? matchingDefinitions[0] : undefined;
}

/**
 * Идентичность счётчика на акторе: пара «владелец + ключ». Владелец — класс
 * (с подклассом) либо черта; без него два ресурса с одинаковым ключом от разных
 * черт считались бы одним, и кнопка «−» тратила бы оба сразу.
 *
 * @param counter - состояние счётчика на акторе
 * @returns строка, уникальная в пределах списка счётчиков актора
 */
export function counterIdentity(counter: ActorCounterState): string {
  const owner = counter.classKey ?? counter.featureId ?? '';

  return `${owner}:${counter.subclassKey ?? ''}:${counter.counterKey}`;
}

/**
 * Один ли это счётчик. Сравнение по {@link counterIdentity} вместо пары полей:
 * у ресурсов черт `classKey` пуст, и прежнее сравнение сходилось у всех сразу.
 *
 * @param first - первый счётчик
 * @param second - второй счётчик
 */
export function isSameCounter(
  first: ActorCounterState,
  second: ActorCounterState,
): boolean {
  return counterIdentity(first) === counterIdentity(second);
}
