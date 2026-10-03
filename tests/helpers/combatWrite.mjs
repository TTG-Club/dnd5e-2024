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

/** Срок памяти посланного журнала — как в помощнике */
const SENT_USAGE_TTL_MS = 5000;

/**
 * Настоящие функции памяти посланного журнала с общим состоянием.
 *
 * @param {(entityId: string) => object | undefined} findEntity - сущность мира
 * @param {object} [clock] - часы и ход боя, которыми управляет тест
 * @param {() => number} [clock.now] - текущее время, мс
 * @param {() => string} [clock.turnStamp] - метка идущего хода
 * @returns {Promise<object>} `readSentTriggerUsage` и `rememberSentTriggerUsage`
 */
async function loadSentTriggerUsage(findEntity, clock = {}) {
  const ports = {
    ...usagePorts,
    sentTriggerUsage: new Map(),
    SENT_USAGE_TTL_MS,
    Date: { now: () => clock.now?.() ?? 0 },
    resolveTurnStamp: () => clock.turnStamp?.() ?? '',
    useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
    Object,
    Set,
  };

  for (const name of [
    'coversSentTriggerUsage',
    'forgetStaleSentTriggerUsage',
    'readSentTriggerUsage',
    'rememberSentTriggerUsage',
  ]) {
    ports[name] = await loadHandler(COMBAT_WRITE_PATH, name, ports);
  }

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
 * @param {object} [options.clock] - часы и ход боя памяти посланного журнала
 * @returns {Promise<object>} помощники, журналы отправок и ошибок
 */
export async function loadEntityWrites({
  world,
  recordCombatBaseline = () => {},
  onSend = () => {},
  clock,
}) {
  const findEntity = (entityId) => world.get(entityId);
  const emitted = [];
  const updated = [];
  const errors = [];
  const sent = await loadSentTriggerUsage(findEntity, clock);

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
      SHEET_WRITE_LOG_PREFIX: '[test]',
      SHEET_WRITE_ERRORS: await loadHandler(
        SHEET_WRITE_PATH,
        'SHEET_WRITE_ERRORS',
        {},
      ),
      console: { error: (message) => errors.push(message) },
      JSON,
    },
  );

  const combatPorts = {
    ...usagePorts,
    changeEntityCombatState,
    recordCombatBaseline,
    rememberSentTriggerUsage: sent.rememberSentTriggerUsage,
    useChatStore: () => ({ getSocket: () => ({}) }),
    useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
    emitEntityCombatState: (_socket, entity) => combatLog.push(entity),
  };

  const sendComputedCombatState = await loadHandler(
    COMBAT_WRITE_PATH,
    'sendComputedCombatState',
    combatPorts,
  );

  const sendTriggerUsageSpend = await loadHandler(
    COMBAT_WRITE_PATH,
    'sendTriggerUsageSpend',
    combatPorts,
  );

  return {
    changeEntityCombatState,
    changeEntitySheet,
    sendComputedCombatState,
    sendTriggerUsageSpend,
    emitted,
    updated,
    errors,
  };
}

/**
 * Сервер одной сущности: полную запись принимает целиком, боевой снимок
 * сливает правилами системы — как ядро и система.
 *
 * @param {object} engineBundle - движок, которым тест читает снимок
 * @param {object} entity - сущность сервера
 * @returns {object} приём записей и текущая сущность
 */
export function createEntityServer(engineBundle, entity) {
  const system = new engineBundle.Dnd5eVttSystem();

  let current = entity;

  return {
    get entity() {
      return current;
    },
    receiveUpdate(next) {
      current = structuredClone(next);
    },
    receiveCombatState(copy) {
      system.settleCombatState(current, engineBundle.pickCombatState(copy));
    },
    /**
     * Отправка клиента в порядке прихода.
     *
     * @param {'update' | 'combat'} kind - полная запись или боевой снимок
     * @param {object} sent - что прислал клиент
     */
    receive(kind, sent) {
      if (kind === 'update') {
        this.receiveUpdate(sent);
      } else {
        this.receiveCombatState(sent);
      }
    },
  };
}
