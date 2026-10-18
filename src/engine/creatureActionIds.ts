/**
 * `id` записей боевого блока существа: особенностей, действий, бонусных
 * действий, реакций, легендарных действий и эффектов логова.
 *
 * Частичная запись сущности (`entity:patch` ядра) правит списки по записям,
 * только если у каждой записи есть свой `id`: список без него уезжает на
 * сервер целиком, и правка одного действия затирала бы правку соседнего,
 * сделанную в это же время с другого клиента.
 *
 * Записи без `id` его выдаёт нормализация листа — и выдаёт предсказуемо: из
 * списка, места в нём и названия. Нормализация идёт и на сервере, и на
 * клиенте (лист нормализует свою копию), а до первой записи существа `id`
 * живёт только в памяти: случайный `id` у них разошёлся бы, и правка по нему
 * не нашла бы запись. Дальше `id` хранится в записи и от места и названия уже
 * не зависит. Новой записи, которую создаёт форма действия, `id` случайный —
 * она появляется сразу с ним.
 *
 * @module system/dnd/creatureActionIds
 */

import { generateId, isRecord } from '@vtt/shared';

/** Приставка `id` записи боевого блока */
export const CREATURE_ACTION_ID_PREFIX = 'action';

/** Основание отпечатка названия: значения укладываются в 32 бита */
const FINGERPRINT_MODULUS = 4294967296;

/** Начальное значение и множитель отпечатка (хеш djb2) */
const FINGERPRINT_SEED = 5381;

const FINGERPRINT_MULTIPLIER = 33;

/** Запись числа, которой отпечаток попадает в `id` */
const FINGERPRINT_RADIX = 36;

/**
 * Новый `id` для записи боевого блока, которую создают сейчас.
 *
 * @returns идентификатор записи
 */
export function createCreatureActionId(): string {
  return generateId(CREATURE_ACTION_ID_PREFIX);
}

/** Список боевого блока и его имя в `id` записи */
interface NamedActionList {
  /** Имя списка: часть предсказуемого `id` */
  listKey: string;
  /** Записи списка */
  entries: unknown[];
}

/**
 * Списки боевого блока в сыром `system` существа.
 *
 * @param system - блок `system` существа
 * @returns списки записей с именами; чего нет или что не список — пропущено
 */
function collectActionLists(
  system: Record<string, unknown>,
): NamedActionList[] {
  const legendary = isRecord(system.legendary) ? system.legendary : {};
  const lair = isRecord(system.lair) ? system.lair : {};

  const lists: Array<[string, unknown]> = [
    ['traits', system.traits],
    ['actions', system.actions],
    ['bonusActions', system.bonusActions],
    ['reactions', system.reactions],
    ['legendary', legendary.actions],
    ['lair', lair.effects],
  ];

  return lists.flatMap(([listKey, entries]) =>
    Array.isArray(entries) ? [{ listKey, entries }] : [],
  );
}

/**
 * Короткий отпечаток строки: одинаковая строка даёт одинаковый отпечаток на
 * клиенте и на сервере. Не для защиты — только чтобы `id` был предсказуем.
 *
 * @param text - строка
 * @returns отпечаток
 */
function fingerprint(text: string): string {
  let hash = FINGERPRINT_SEED;

  for (const symbol of text) {
    hash =
      (hash * FINGERPRINT_MULTIPLIER + (symbol.codePointAt(0) ?? 0))
      % FINGERPRINT_MODULUS;
  }

  return hash.toString(FINGERPRINT_RADIX);
}

/**
 * Предсказуемый `id` записи без `id`: список, место в нём и название. Занятый
 * `id` (запись с таким уже есть в списке) получает порядковую добавку.
 *
 * @param listKey - имя списка
 * @param index - место записи в списке
 * @param name - название записи
 * @param takenIds - `id`, уже занятые в списке
 * @returns свободный `id`
 */
function deriveActionId(
  listKey: string,
  index: number,
  name: string,
  takenIds: ReadonlySet<string>,
): string {
  const baseId = [
    CREATURE_ACTION_ID_PREFIX,
    listKey,
    index,
    fingerprint(name),
  ].join('_');

  let candidate = baseId;
  let attempt = 1;

  while (takenIds.has(candidate)) {
    attempt += 1;
    candidate = `${baseId}_${attempt}`;
  }

  return candidate;
}

/**
 * Выдаёт `id` записям боевого блока, у которых его нет, — на месте, как и вся
 * нормализация листа. Повтор `id` внутри списка (запись скопировали вместе с
 * ним) тоже получает новый: по одинаковым `id` записи не различить.
 *
 * @param system - блок `system` существа (мутабельная запись)
 */
export function stampCreatureActionIds(system: Record<string, unknown>): void {
  for (const { listKey, entries } of collectActionLists(system)) {
    const takenIds = new Set<string>();

    // Сначала — `id`, которые уже есть: выданный не должен занять чужой
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.id === 'string') {
        takenIds.add(entry.id);
      }
    }

    const seenIds = new Set<string>();

    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry)) {
        continue;
      }

      const hasOwnId =
        typeof entry.id === 'string'
        && entry.id !== ''
        && !seenIds.has(entry.id);

      if (!hasOwnId) {
        entry.id = deriveActionId(
          listKey,
          index,
          typeof entry.name === 'string' ? entry.name : '',
          takenIds,
        );
      }

      if (typeof entry.id === 'string') {
        takenIds.add(entry.id);
        seenIds.add(entry.id);
      }
    }
  }
}
