/**
 * Идентичность счётчиков листа и их `id`.
 *
 * Частичная запись сущности (`entity:patch` ядра) правит списки по записям,
 * только если у каждой записи есть свой `id`: список без него уезжает на
 * сервер целиком, и трата одного счётчика затирала бы правку соседнего,
 * сделанную в это же время с другого клиента. Свой `id` счётчику не нужен —
 * он и так опознаётся парой «владелец + ключ», — поэтому `id` выводится из
 * неё и хранится в записи: случайного значения нет, одинаковая запись на
 * клиенте и на сервере получает один и тот же `id`.
 *
 * Отдельный модуль без зависимостей от расчётов: им пользуется и нормализация
 * листа, и запись на клиенте.
 *
 * @module system/dnd/counterIds
 */

import type { DnDSceneEntity } from './dndEntities.js';
import type { ActorCounterState } from './types.js';

import { isActorEntity, isRecord } from '@vtt/shared';

/**
 * Идентичность счётчика на акторе: пара «владелец + ключ». Владелец — класс
 * (с подклассом), черта либо источник даров вида; без него два ресурса с
 * одинаковым ключом от разных записей считались бы одним, и кнопка «−» тратила
 * бы оба сразу.
 *
 * В движке, а не в интерфейсе: по ней же пересчёт ресурсов вида узнаёт
 * прежний счётчик, и два разных понятия «один и тот же ресурс» разошлись бы.
 *
 * @param counter - состояние счётчика на акторе
 * @returns строка, уникальная в пределах списка счётчиков актора
 */
export function counterIdentity(counter: ActorCounterState): string {
  const owner = counter.classKey ?? counter.featureId ?? '';

  return `${owner}:${counter.subclassKey ?? ''}:${counter.counterKey}`;
}

/**
 * Сырая запись — счётчик листа: у неё есть ключ и числа запаса.
 *
 * @param value - элемент `system.classCounters`
 * @returns `true`, если запись можно опознать как счётчик
 */
function isCounterRecord(value: unknown): value is ActorCounterState {
  return (
    isRecord(value)
    && typeof value.counterKey === 'string'
    && typeof value.current === 'number'
    && typeof value.max === 'number'
  );
}

/**
 * Счётчики с `id` по идентичности. Список, где все `id` уже на месте,
 * возвращается тем же объектом — лишних копий и ложных изменений нет.
 *
 * @param counters - счётчики листа
 * @returns счётчики с выставленным `id`
 */
export function withCounterIds(
  counters: ActorCounterState[],
): ActorCounterState[] {
  return counters.every((counter) => counter.id === counterIdentity(counter))
    ? counters
    : counters.map((counter) => ({ ...counter, id: counterIdentity(counter) }));
}

/**
 * Выставляет `id` счётчикам сырого блока `system` — на месте, как и вся
 * нормализация листа. Запись, которую счётчиком не опознать, не трогается.
 *
 * @param system - блок `system` персонажа (мутабельная запись)
 */
export function stampCounterIds(system: Record<string, unknown>): void {
  if (!Array.isArray(system.classCounters)) {
    return;
  }

  for (const counter of system.classCounters) {
    if (isCounterRecord(counter)) {
      counter.id = counterIdentity(counter);
    }
  }
}

/**
 * Сущность, у записей списков которой выставлены `id`, нужные частичной
 * записи. Сейчас это счётчики персонажа; сущность, где всё на месте,
 * возвращается тем же объектом.
 *
 * Зовётся перед построением правки: счётчик, только что добавленный мастером
 * класса или чертой, `id` ещё не имеет, и без него разница ушла бы списком.
 *
 * @param entity - персонаж или существо
 * @returns та же сущность либо её копия со счётчиками с `id`
 */
export function withPatchRecordIds<Entity extends DnDSceneEntity>(
  entity: Entity,
): Entity {
  if (!isActorEntity(entity) || !entity.system.classCounters) {
    return entity;
  }

  const classCounters = withCounterIds(entity.system.classCounters);

  return classCounters === entity.system.classCounters
    ? entity
    : { ...entity, system: { ...entity.system, classCounters } };
}
