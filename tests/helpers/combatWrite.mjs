import { loadHandler } from './sourceHandler.mjs';

/** Помощник записи боевого состояния — единственный путь боевого канала */
const COMBAT_WRITE_PATH = 'src/client/composables/entityCombatWrite.ts';

/**
 * Настоящий `changeEntityCombatState` с подменённым миром и сокетом: тесты
 * мест записи видят, что ушло боевым каналом и от какой сущности.
 *
 * @param {object} options - окружение
 * @param {(entityId: string) => object | undefined} options.findEntity - сущность мира
 * @param {object[]} options.emitted - журнал отправленных снимков
 * @param {(copy: object, base: object[]) => void} [options.recordEffectsBaseline] - запись основы
 * @param {object | null} [options.socket] - сокет; `null` — соединения нет
 * @returns {Promise<Function>} помощник записи
 */
export function loadChangeEntityCombatState({
  findEntity,
  emitted,
  recordEffectsBaseline = () => {},
  socket = {},
}) {
  return loadHandler(COMBAT_WRITE_PATH, 'changeEntityCombatState', {
    useChatStore: () => ({ getSocket: () => socket }),
    useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
    recordEffectsBaseline,
    emitEntityCombatState: (_socket, entity) => emitted.push(entity),
  });
}
