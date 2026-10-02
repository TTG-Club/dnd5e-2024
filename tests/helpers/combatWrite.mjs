import { loadEngineBundle } from './engineBundle.mjs';
import { loadHandler } from './sourceHandler.mjs';

/** Помощник записи боевого состояния — единственный путь боевого канала */
const COMBAT_WRITE_PATH = 'src/client/composables/entityCombatWrite.ts';

/** Помощник записи листа — единственный путь полной записи во время игры */
const SHEET_WRITE_PATH = 'src/client/composables/entitySheetWrite.ts';

// Движок собирается один раз на модуль помощника, как в самих тестах
// eslint-disable-next-line antfu/no-top-level-await
const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/** Правила журнала срабатываний, которыми пользуются оба помощника */
const usagePorts = {
  applyTriggerUsageChanges: engine.applyTriggerUsageChanges,
  diffTriggerUsage: engine.diffTriggerUsage,
  hasTriggerUsageChanges: engine.hasTriggerUsageChanges,
  readTriggerUsage: engine.readTriggerUsage,
  withTriggerUsage: engine.withTriggerUsage,
};

/**
 * Настоящие функции памяти посланного журнала с общим состоянием.
 *
 * @param {(entityId: string) => object | undefined} findEntity - сущность мира
 * @returns {Promise<object>} `readSentTriggerUsage` и `rememberSentTriggerUsage`
 */
async function loadSentTriggerUsage(findEntity) {
  const ports = {
    ...usagePorts,
    sentTriggerUsage: new Map(),
    useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
  };

  ports.readSentTriggerUsage = await loadHandler(
    COMBAT_WRITE_PATH,
    'readSentTriggerUsage',
    ports,
  );

  ports.rememberSentTriggerUsage = await loadHandler(
    COMBAT_WRITE_PATH,
    'rememberSentTriggerUsage',
    ports,
  );

  return ports;
}

/**
 * Настоящий `changeEntityCombatState` с подменённым миром и сокетом: тесты
 * мест записи видят, что ушло боевым каналом и от какой сущности.
 *
 * @param {object} options - окружение
 * @param {(entityId: string) => object | undefined} options.findEntity - сущность мира
 * @param {object[]} options.emitted - журнал отправленных снимков
 * @param {(copy: object, base: object) => void} [options.recordCombatBaseline] - запись основы
 * @param {object | null} [options.socket] - сокет; `null` — соединения нет
 * @param {object} [options.sent] - память посланного журнала (общая с записью листа)
 * @returns {Promise<Function>} помощник записи
 */
export async function loadChangeEntityCombatState({
  findEntity,
  emitted,
  recordCombatBaseline = () => {},
  socket = {},
  sent,
}) {
  const sentPorts = sent ?? (await loadSentTriggerUsage(findEntity));

  return loadHandler(COMBAT_WRITE_PATH, 'changeEntityCombatState', {
    useChatStore: () => ({ getSocket: () => socket }),
    useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
    recordCombatBaseline,
    rememberSentTriggerUsage: sentPorts.rememberSentTriggerUsage,
    emitEntityCombatState: (_socket, entity) => emitted.push(entity),
  });
}

/**
 * Настоящие помощники записи листа и боевого состояния с общим миром: стор
 * правится так, как его правит хост (`Object.assign` разделов), полные
 * записи и боевые снимки ложатся в журналы.
 *
 * @param {object} options - окружение
 * @param {Map<string, object>} options.world - сущности мира по id (меняются)
 * @param {(copy: object, base: object) => void} [options.recordCombatBaseline] -
 *   запись основы из того же движка, которым тест читает снимок: основа живёт
 *   в WeakMap движка
 * @param {(kind: 'update' | 'combat', entity: object) => void} [options.onSend] -
 *   каждая отправка по порядку: полная запись или боевой снимок
 * @returns {Promise<object>} помощники, журналы отправок и ошибок
 */
export async function loadEntityWrites({
  world,
  recordCombatBaseline = () => {},
  onSend = () => {},
}) {
  const findEntity = (entityId) => world.get(entityId);
  const emitted = [];
  const updated = [];
  const errors = [];
  const sent = await loadSentTriggerUsage(findEntity);

  // Журнал снимков с вызовом onSend на каждую отправку
  const combatLog = {
    push: (entity) => {
      emitted.push(entity);
      onSend('combat', entity);
    },
  };

  const changeEntityCombatState = await loadChangeEntityCombatState({
    findEntity,
    emitted: combatLog,
    recordCombatBaseline,
    sent,
  });

  const assignSections = (_worldId, entityId, sections) => {
    Object.assign(world.get(entityId), sections);
  };

  const changeEntitySheet = await loadHandler(
    SHEET_WRITE_PATH,
    'changeEntitySheet',
    {
      ...usagePorts,
      readSentTriggerUsage: sent.readSentTriggerUsage,
      changeEntityCombatState,
      keepsCombatState: await loadHandler(
        SHEET_WRITE_PATH,
        'keepsCombatState',
        {
          resolveEntityCurrentHp: engine.resolveEntityCurrentHp,
          resolveEntityTempHp: engine.resolveEntityTempHp,
        },
      ),
      useWorldStore: () => ({
        connectionState: { currentWorldId: 'world' },
        updateActor: assignSections,
        updateCreature: assignSections,
      }),
      useChatStore: () => ({ getSocket: () => ({}) }),
      useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
      isActorEntity: (entity) => entity.entityType === 'actor',
      isCreatureEntity: (entity) => entity.entityType === 'creature',
      emitEntityUpdate: (_socket, entity) => {
        updated.push(entity);
        onSend('update', entity);
      },
      console: { error: (message) => errors.push(message) },
      JSON,
    },
  );

  return {
    changeEntityCombatState,
    changeEntitySheet,
    emitted,
    updated,
    errors,
  };
}
