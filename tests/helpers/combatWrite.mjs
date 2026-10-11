import { loadEngineBundle } from './engineBundle.mjs';
import { loadHandler } from './sourceHandler.mjs';

/** Помощник записи боевого состояния — единственный путь боевого канала */
const COMBAT_WRITE_PATH = 'src/client/composables/entityCombatWrite.ts';

/** Помощник записи листа — запись ресурсов листа во время игры */
const SHEET_WRITE_PATH = 'src/client/composables/entitySheetWrite.ts';

// Движок собирается один раз на модуль помощника, как в самих тестах
// eslint-disable-next-line antfu/no-top-level-await
const engine = await loadEngineBundle(
  "export * from './src/engine/index.ts'; export { applyEntityPatch, buildEntityPatch } from '@vtt/shared';",
);

/** Ответ сервера на правку листа: записано */
const PATCH_ACCEPTED = { ok: true, changed: true };

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

/** Срок памяти посланных изменений эффектов — как в помощнике */
const SENT_EFFECTS_TTL_MS = 2000;

/**
 * Настоящие функции памяти посланного журнала с общим состоянием.
 *
 * @param {(entityId: string) => object | undefined} findEntity - сущность мира
 * @param {object} [clock] - часы и ход боя, которыми управляет тест
 * @param {() => number} [clock.now] - текущее время, мс
 * @param {() => string} [clock.turnStamp] - метка идущего хода
 * @returns {Promise<object>} память посланного: журнал срабатываний
 *   (`readSentTriggerUsage`, `rememberSentTriggerUsage`) и эффекты
 *   (`readSentActiveEffects`, `rememberSentEffects`, `rememberSentCastEnd`)
 */
async function loadSentTriggerUsage(findEntity, clock = {}) {
  const ports = {
    ...usagePorts,
    sentTriggerUsage: new Map(),
    SENT_USAGE_TTL_MS,
    sentEffects: [],
    SENT_EFFECTS_TTL_MS,
    applyEffectChanges: engine.applyEffectChanges,
    diffEffects: engine.diffEffects,
    withoutCastEffects: engine.withoutCastEffects,
    JSON,
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
    'forgetStaleSentEffects',
    'readSentActiveEffects',
    'rememberSentEffects',
    'rememberSentCastEnd',
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
 * @param {(base: object, next: object) => boolean} [options.changesCombatState] -
 *   «меняет ли копия что-нибудь» из того же движка, которым тест пишет удары:
 *   удары живут в WeakMap движка
 * @param {object | null} [options.socket] - сокет; `null` — соединения нет
 * @param {object} [options.sent] - память посланного журнала (общая с записью листа)
 * @returns {Promise<Function>} помощник записи
 */
export async function loadChangeEntityCombatState({
  findEntity,
  emitted,
  recordCombatBaseline = () => {},
  changesCombatState = engine.changesCombatState,
  socket = {},
  sent,
}) {
  const sentPorts = sent ?? (await loadSentTriggerUsage(findEntity));

  return loadHandler(COMBAT_WRITE_PATH, 'changeEntityCombatState', {
    useChatStore: () => ({ getSocket: () => socket }),
    useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
    recordCombatBaseline,
    rememberSentTriggerUsage: sentPorts.rememberSentTriggerUsage,
    rememberSentEffects: sentPorts.rememberSentEffects,
    changesCombatState,
    emitEntityCombatState: (_socket, entity) => emitted.push(entity),
  });
}

/**
 * Настоящие помощники записи листа и боевого состояния с общим миром: стор
 * правится так, как его правит хост (`Object.assign` разделов), правки листа
 * и боевые снимки ложатся в журналы.
 *
 * Правка листа — частичная запись (`entity:patch`): в `patches` лежит то, что
 * ушло на сервер (сущность и операции), в `updated` — лист, каким его после
 * этой правки показывает стор, в `fullWrites` — запасные полные записи, в
 * `toasts` — уведомления об отказе.
 *
 * @param {object} options - окружение
 * @param {Map<string, object>} options.world - сущности мира по id (меняются)
 * @param {(copy: object, base: object) => void} [options.recordCombatBaseline] -
 *   запись основы из того же движка, которым тест читает снимок: основа живёт
 *   в WeakMap движка
 * @param {(base: object, next: object) => boolean} [options.changesCombatState] -
 *   «меняет ли копия что-нибудь» из того же движка, которым тест пишет удары
 * @param {(kind: 'update' | 'combat', sent: object) => void} [options.onSend] -
 *   каждая отправка по порядку: правка листа (`{ id, operations }`) или
 *   боевой снимок
 * @param {(patch: object) => object} [options.answerPatch] - ответ сервера на
 *   правку листа; по умолчанию — записано
 * @param {object} [options.clock] - часы и ход боя памяти посланного журнала
 * @returns {Promise<object>} помощники, журналы отправок и ошибок
 */
export async function loadEntityWrites({
  world,
  recordCombatBaseline = () => {},
  changesCombatState = engine.changesCombatState,
  onSend = () => {},
  answerPatch = () => PATCH_ACCEPTED,
  clock,
}) {
  const findEntity = (entityId) => world.get(entityId);
  const emitted = [];
  const updated = [];
  const patches = [];
  const fullWrites = [];
  const toasts = [];
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
    changesCombatState,
    sent,
  });

  const assignSections = (_worldId, entityId, sections) => {
    Object.assign(world.get(entityId), sections);
  };

  const sheetErrors = await loadHandler(
    SHEET_WRITE_PATH,
    'SHEET_WRITE_ERRORS',
    {},
  );

  // Запасной путь: правка не легла — сущность стора уходит целиком
  const resendSheetInFull = await loadHandler(
    SHEET_WRITE_PATH,
    'resendSheetInFull',
    {
      ...usagePorts,
      readSentTriggerUsage: sent.readSentTriggerUsage,
      readSentActiveEffects: sent.readSentActiveEffects,
      useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
      emitEntityUpdate: (_socket, entity) => fullWrites.push(entity),
    },
  );

  const pickSheetSections = await loadHandler(
    SHEET_WRITE_PATH,
    'pickSheetSections',
    {},
  );

  // Память разделов последней записи — общая у записи и разбора ответа
  const lastWrittenSections = new Map();

  const keepsWrittenSections = await loadHandler(
    SHEET_WRITE_PATH,
    'keepsWrittenSections',
    { lastWrittenSections, toRaw: (value) => value },
  );

  // Запись и разбор ответа зовут друг друга (повтор после отказа), поэтому
  // запись приходит разбору ссылкой, которая заполняется ниже
  const sheetWrite = { writeSheetChange: () => null };

  const settleSheetWrite = await loadHandler(
    SHEET_WRITE_PATH,
    'settleSheetWrite',
    {
      resendSheetInFull,
      pickSheetSections,
      keepsWrittenSections,
      writeSheetChange: (...args) => sheetWrite.writeSheetChange(...args),
      buildEntityPatch: engine.buildEntityPatch,
      useWorldEntities: () => ({ findCurrentDndEntity: findEntity }),
      PATCH_CONFLICT_REASON: 'conflict',
      SHEET_WRITE_LOG_PREFIX: '[test]',
      SHEET_WRITE_ERRORS: sheetErrors,
      buildEntityPatchFailureToast: (outcome, name) => ({
        title: name,
        description: outcome.reason,
      }),
      useSystemToastStore: () => ({ add: (toast) => toasts.push(toast) }),
      console: { error: (message) => errors.push(message) },
    },
  );

  sheetWrite.writeSheetChange = await loadHandler(
    SHEET_WRITE_PATH,
    'writeSheetChange',
    {
      ...usagePorts,
      buildEntityPatch: engine.buildEntityPatch,
      withPatchRecordIds: engine.withPatchRecordIds,
      pickSheetSections,
      lastWrittenSections,
      settleSheetWrite,
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
      emitEntityPatch: (_socket, entityId, operations) => {
        const patch = { id: entityId, operations };

        patches.push(patch);
        // Стор к этому моменту уже несёт разделы правки
        updated.push(structuredClone(world.get(entityId)));
        onSend('update', patch);

        return Promise.resolve(answerPatch(patch));
      },
      SHEET_WRITE_LOG_PREFIX: '[test]',
      SHEET_WRITE_ERRORS: sheetErrors,
      console: { error: (message) => errors.push(message) },
      JSON,
    },
  );

  const combatPorts = {
    ...usagePorts,
    changeEntityCombatState,
    recordCombatBaseline,
    rememberSentTriggerUsage: sent.rememberSentTriggerUsage,
    rememberSentEffects: sent.rememberSentEffects,
    changesCombatState,
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

  const changeEntitySheet = await loadHandler(
    SHEET_WRITE_PATH,
    'changeEntitySheet',
    { writeSheetChange: sheetWrite.writeSheetChange },
  );

  return {
    changeEntityCombatState,
    changeEntitySheet,
    sendComputedCombatState,
    sendTriggerUsageSpend,
    rememberSentCastEnd: sent.rememberSentCastEnd,
    emitted,
    updated,
    patches,
    fullWrites,
    toasts,
    errors,
  };
}

/**
 * Сервер одной сущности: полную запись принимает целиком, правку листа
 * кладёт на свою сущность, боевой снимок сливает правилами системы — как ядро
 * и система.
 *
 * @param {object} engineBundle - движок, которым тест читает снимок
 * @param {object} entity - сущность сервера
 * @returns {object} приём записей и текущая сущность
 */
export function createEntityServer(engineBundle, entity) {
  const system = new engineBundle.Dnd5eVttSystem();

  // Сервер нормализует сущность при загрузке мира и на каждой записи: записи
  // списков, которые частичная запись правит по одной, уже несут `id`
  let current = engine.withPatchRecordIds(entity);

  return {
    get entity() {
      return current;
    },
    receiveUpdate(next) {
      current = structuredClone(next);
    },
    /**
     * Частичная запись: операции ложатся на сущность СЕРВЕРА.
     *
     * @param {object} patch - правка листа
     * @param {object[]} patch.operations - операции
     */
    receivePatch({ operations }) {
      const applied = engine.applyEntityPatch(current, operations);

      if (!applied.ok) {
        throw new Error(`Правка не легла: ${applied.problem}`);
      }

      current = structuredClone(applied.value);
    },
    receiveCombatState(copy) {
      system.settleCombatState(current, engineBundle.pickCombatState(copy));
    },
    /**
     * Отправка клиента в порядке прихода.
     *
     * @param {'update' | 'combat'} kind - правка листа или боевой снимок
     * @param {object} sent - что прислал клиент
     */
    receive(kind, sent) {
      if (kind === 'update') {
        this.receivePatch(sent);
      } else {
        this.receiveCombatState(sent);
      }
    },
  };
}
