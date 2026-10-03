/**
 * Слияние черновика листа с миром на «Сохранить».
 *
 * Лист в режиме правки держит черновик — копию сущности на момент входа в
 * правку — и сохраняет его целиком (`actor:updated` / `creature:updated`
 * заменяют сущность тем, что прислал клиент). Мир за время правки меняется:
 * каст с горячей панели списал ячейку, другой клиент нанёс урон, сервер снял
 * эффект. Черновик этого не видит, и его «Сохранить» возвращало ячейку, хиты
 * и эффект обратно.
 *
 * Здесь черновик сливается с миром по трём точкам: основа (сущность на входе
 * в правку), черновик и мир. Что владелец не менял — берётся из мира; что
 * менял — из черновика; поменяли оба — главнее правка владельца. Сравнение
 * идёт вглубь по полям, а у списков записей с `id` (предметы, заклинания,
 * эффекты, счётчики) — по записям: правка одного заклинания не возвращает
 * заряд другого.
 *
 * Без правил D&D: работает над чистым JSON сущности.
 */

import type { DnDSceneEntity } from './dndEntities.js';

import { isRecord } from '@vtt/shared';

import { cloneEntityData } from './dataClone.js';

/** Запись списка, которую узнают по `id` */
type IdentifiedRecord = Record<string, unknown> & { id: string };

/**
 * Одинаковы ли два значения JSON.
 *
 * @param left - значение
 * @param right - значение
 * @returns `true`, если сериализация совпала
 */
function isSameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Запись с полями, а не список: `isRecord` ядра принимает и массив, а по
 * полям-индексам списки не сливают.
 *
 * @param value - значение
 * @returns `true`, если это запись с полями
 */
function isFieldRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

/**
 * Запись с собственным `id`.
 *
 * @param value - значение
 * @returns `true`, если запись узнаётся по `id`
 */
function isIdentifiedRecord(value: unknown): value is IdentifiedRecord {
  return isFieldRecord(value) && typeof value.id === 'string';
}

/**
 * Список записей с неповторяющимися `id`: его можно слить по записям.
 * Пустой список подходит — в нём нечему повторяться.
 *
 * @param value - значение
 * @returns `true`, если это список записей с `id`
 */
function isIdentifiedList(value: unknown): value is IdentifiedRecord[] {
  return (
    Array.isArray(value)
    && value.every(isIdentifiedRecord)
    && new Set(value.map((entry) => entry.id)).size === value.length
  );
}

/**
 * Сливает список записей по `id`. Порядок — как в черновике; запись,
 * добавленная миром, ложится в конец; снятая миром и не тронутая владельцем
 * — убирается; снятая владельцем — не возвращается.
 *
 * @param base - список на входе в правку
 * @param draft - список черновика
 * @param world - список мира
 * @returns слитый список
 */
function mergeIdentifiedLists(
  base: readonly IdentifiedRecord[],
  draft: readonly IdentifiedRecord[],
  world: readonly IdentifiedRecord[],
): unknown[] {
  const baseById = new Map(base.map((entry) => [entry.id, entry]));
  const worldById = new Map(world.map((entry) => [entry.id, entry]));
  const draftIds = new Set(draft.map((entry) => entry.id));

  const kept = draft.flatMap((entry) => {
    const before = baseById.get(entry.id);
    const current = worldById.get(entry.id);

    // Добавлена владельцем — остаётся его
    if (before === undefined) {
      return [entry];
    }

    // Снята миром: правленную владельцем оставляем, нетронутую убираем
    if (current === undefined) {
      return isSameJson(entry, before) ? [] : [entry];
    }

    return [mergeDraftValue(before, entry, current)];
  });

  const added = world.filter(
    (entry) => !baseById.has(entry.id) && !draftIds.has(entry.id),
  );

  return [...kept, ...added];
}

/**
 * Сливает значение черновика с миром по трём точкам.
 *
 * @param base - значение на входе в правку
 * @param draft - значение черновика
 * @param world - значение мира
 * @returns значение для записи
 */
function mergeDraftValue(
  base: unknown,
  draft: unknown,
  world: unknown,
): unknown {
  // Владелец не менял — мир главнее; мир не менялся — остаётся правка
  if (isSameJson(draft, base)) {
    return world;
  }

  if (isSameJson(world, base)) {
    return draft;
  }

  if (isFieldRecord(base) && isFieldRecord(draft) && isFieldRecord(world)) {
    const keys = new Set([
      ...Object.keys(draft),
      ...Object.keys(world),
      ...Object.keys(base),
    ]);

    return Object.fromEntries(
      [...keys].flatMap((key) => {
        const merged = mergeDraftValue(base[key], draft[key], world[key]);

        return merged === undefined ? [] : [[key, merged]];
      }),
    );
  }

  if (
    isIdentifiedList(base)
    && isIdentifiedList(draft)
    && isIdentifiedList(world)
  ) {
    return mergeIdentifiedLists(base, draft, world);
  }

  // Поменяли оба, и вглубь не разобрать — правка владельца
  return draft;
}

/**
 * Черновик листа, слитый с миром: правки владельца — из черновика, всё, что
 * он не трогал, — из мира.
 *
 * @param base - сущность на входе в правку
 * @param draft - черновик листа
 * @param world - сущность мира сейчас
 * @param isEntity - гвард формы листа: слитое обязано остаться сущностью
 *   того же вида
 * @returns сущность для записи — независимая копия; слитое не прошло гвард —
 *   копия черновика
 */
export function mergeEntityDraft<Entity extends DnDSceneEntity>(
  base: Entity,
  draft: Entity,
  world: DnDSceneEntity,
  isEntity: (value: unknown) => value is Entity,
): Entity {
  // Копии: вход — реактивный черновик и запись стора хоста, а слитое не
  // должно делить с ними вложенные объекты
  const merged = mergeDraftValue(
    cloneEntityData(base),
    cloneEntityData(draft),
    cloneEntityData(world),
  );

  return isEntity(merged) ? merged : cloneEntityData(draft);
}
