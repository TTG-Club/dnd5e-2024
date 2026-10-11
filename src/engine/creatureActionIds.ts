/**
 * `id` записей боевого блока существа: особенностей, действий, бонусных
 * действий, реакций, легендарных действий и эффектов логова.
 *
 * Частичная запись сущности (`entity:patch` ядра) правит списки по записям,
 * только если у каждой записи есть свой `id`: список без него уезжает на
 * сервер целиком, и правка одного действия затирала бы правку соседнего,
 * сделанную в это же время с другого клиента.
 *
 * Своей идентичности у действия нет (название не уникально и правится),
 * поэтому `id` случайный и хранится в записи. Выдаёт его нормализация листа —
 * на сервере она идёт при загрузке мира и на каждой записи, так что клиенты
 * получают готовые `id` вместе с существом. Клиент ставит `id` только записи,
 * которую сам создаёт (форма действия): выдай он его уже существующей записи,
 * у клиента и сервера получились бы разные значения.
 *
 * @module system/dnd/creatureActionIds
 */

import { generateId, isRecord } from '@vtt/shared';

/** Приставка `id` записи боевого блока */
export const CREATURE_ACTION_ID_PREFIX = 'action';

/**
 * Новый `id` для записи боевого блока.
 *
 * @returns идентификатор записи
 */
export function createCreatureActionId(): string {
  return generateId(CREATURE_ACTION_ID_PREFIX);
}

/**
 * Списки боевого блока в сыром `system` существа.
 *
 * @param system - блок `system` существа
 * @returns списки записей; чего нет или что не список — пропущено
 */
function collectActionLists(system: Record<string, unknown>): unknown[][] {
  const legendary = isRecord(system.legendary) ? system.legendary : {};
  const lair = isRecord(system.lair) ? system.lair : {};

  return [
    system.traits,
    system.actions,
    system.bonusActions,
    system.reactions,
    legendary.actions,
    lair.effects,
  ].filter((list): list is unknown[] => Array.isArray(list));
}

/**
 * Выдаёт `id` записям боевого блока, у которых его нет, — на месте, как и вся
 * нормализация листа. Повтор `id` внутри списка (запись скопировали вместе с
 * ним) тоже получает новый: по одинаковым `id` записи не различить.
 *
 * @param system - блок `system` существа (мутабельная запись)
 */
export function stampCreatureActionIds(system: Record<string, unknown>): void {
  for (const list of collectActionLists(system)) {
    const seenIds = new Set<string>();

    for (const entry of list) {
      if (!isRecord(entry)) {
        continue;
      }

      const hasOwnId =
        typeof entry.id === 'string'
        && entry.id !== ''
        && !seenIds.has(entry.id);

      if (!hasOwnId) {
        entry.id = createCreatureActionId();
      }

      if (typeof entry.id === 'string') {
        seenIds.add(entry.id);
      }
    }
  }
}
