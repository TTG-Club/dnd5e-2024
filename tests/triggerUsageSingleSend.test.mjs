import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import {
  createEntityServer,
  loadEntityWrites,
} from './helpers/combatWrite.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Расход журнала срабатываний (`system.effectUsage`) едет одним путём и один
 * раз на действие.
 *
 * Действие, которое меняет и лист, и боевое состояние (кнопка «При действии» с
 * ценой, включение переключателя с оплатой), шлёт две записи: полную запись
 * листа и боевой снимок. Раньше расход журнала уходил с обеими — помощник
 * листа слал разницу журнала сам, следом её же слал боевой снимок, и сервер
 * прибавлял оба: лимит «2 раза за отдых» сгорал за одно нажатие.
 *
 * Правило: журнал шлёт только боевой помощник, разницей «до → после» от того,
 * кто делал действие; помощник листа журнал не шлёт и из копии не берёт.
 */

const PAY_PATH = 'src/client/composables/effectPayChoice.ts';
const TOGGLE_PATH = 'src/client/composables/effectToggle.ts';

/** Хиты персонажа */
const HERO_HP = 30;

/** Воин 5 уровня: пять костей к10 */
const FIGHTER = { classKey: 'fighter', level: 5, hitDie: 10 };

/** Ключ счётчика «Очки удали» */
const GRIT = 'grit';

/** Сколько очков удали у персонажа */
const GRIT_POINTS = 5;

/** Лимит срабатывания: два раза за продолжительный отдых */
const TWICE_PER_REST = { max: 2, per: 'longRest' };

/** Id срабатывания с лимитом */
const LIMITED_TRIGGER_ID = 'trigger_limited';

/**
 * Персонаж с костями хитов и счётчиком.
 *
 * @param {object[]} activeEffects - эффекты листа
 * @returns {object} персонаж
 */
function hero(activeEffects) {
  const actor = withHp(createActor, HERO_HP, { activeEffects });

  actor.system = {
    ...actor.system,
    classes: [FIGHTER],
    classCounters: [
      {
        counterKey: GRIT,
        classKey: 'custom',
        current: GRIT_POINTS,
        max: GRIT_POINTS,
      },
    ],
  };

  return actor;
}

/**
 * Срабатывание с лимитом «2 раза за отдых» и ценой — очком удали.
 *
 * @returns {object} срабатывание «при включении / при действии»
 */
function limitedPaidTrigger() {
  return {
    id: LIMITED_TRIGGER_ID,
    event: 'activate',
    pay: [{ kind: 'counter', counter: GRIT }],
    limit: TWICE_PER_REST,
    actions: [{ type: 'notify', text: 'Сработало' }],
  };
}

/**
 * Мир клиента и сервер с одной сущностью: каждая отправка клиента доходит до
 * сервера в порядке отправки, стор клиента ответа сервера не видит, пока тест
 * сам его не доставит.
 *
 * @param {object} entity - сущность
 * @param {object} [clock] - часы и ход боя памяти посланного журнала
 * @returns {Promise<object>} помощники записи, мир и сервер
 */
async function setup(entity, clock) {
  const world = new Map([[entity.id, structuredClone(entity)]]);
  const server = createEntityServer(engine, structuredClone(entity));
  const sends = [];

  const writes = await loadEntityWrites({
    world,
    recordCombatBaseline: engine.recordCombatBaseline,
    clock,
    onSend: (kind, sent) => {
      sends.push(kind);
      server.receive(kind, sent);
    },
  });

  /** Ответ сервера дошёл до стора: разделы заменяются, как у хоста */
  const deliverEcho = () => {
    Object.assign(world.get(entity.id), {
      system: structuredClone(server.entity.system),
      activeEffects: structuredClone(server.entity.activeEffects),
      equipment: structuredClone(server.entity.equipment),
    });
  };

  return { world, server, sends, deliverEcho, ...writes };
}

/**
 * Настоящий `emitActedEntity` поверх настоящих помощников записи.
 *
 * @param {object} writes - помощники записи
 * @returns {Promise<Function>} отправка сущности после действия
 */
function loadEmitActedEntity(writes) {
  return loadHandler(PAY_PATH, 'emitActedEntity', {
    sheetResourcesDiffer: engine.sheetResourcesDiffer,
    withSheetResources: engine.withSheetResources,
    changeEntitySheet: writes.changeEntitySheet,
    sendComputedCombatState: writes.sendComputedCombatState,
  });
}

/**
 * Сколько раз израсходовано срабатывание эффекта по журналу сущности.
 *
 * @param {object} entity - сущность
 * @param {string} effectId - эффект
 * @returns {number} расход
 */
function usedOf(entity, effectId) {
  return (
    engine.readTriggerUsage(entity)[`${effectId}|${LIMITED_TRIGGER_ID}`]?.used
    ?? 0
  );
}

describe('журнал срабатываний уходит один раз на действие', () => {
  it('кнопка «При действии» с ценой и лимитом 2: одно нажатие — в журнале сервера 1', async () => {
    const surge = createEffect('surge', { triggers: [limitedPaidTrigger()] });
    const actor = hero([surge]);
    const env = await setup(actor);
    const emitActedEntity = await loadEmitActedEntity(env);

    const press = () => {
      const current = env.world.get(actor.id);

      emitActedEntity(current, engine.runEffectActiveAction(current, surge.id));
    };

    press();

    assert.deepEqual(env.sends, ['update', 'combat']);
    assert.equal(usedOf(env.server.entity, surge.id), 1);

    assert.equal(
      env.server.entity.system.classCounters[0].current,
      GRIT_POINTS - 1,
    );

    assert.deepEqual(env.errors, []);

    // Второе нажатие после ответа сервера — второй и последний раз
    env.deliverEcho();
    press();

    assert.equal(usedOf(env.server.entity, surge.id), 2);

    // Третье лимит не пускает: ни цены, ни расхода
    env.deliverEcho();
    press();

    assert.equal(usedOf(env.server.entity, surge.id), 2);

    assert.equal(
      env.server.entity.system.classCounters[0].current,
      GRIT_POINTS - 2,
    );
  });

  it('переключатель с ценой и лимитом 2: одно включение — в журнале сервера 1', async () => {
    const tough = createEffect('tough', {
      flags: [engine.HIT_DICE_FIRST_FREE_FLAG],
    });

    // Цена включения — кость хитов (первая после отдыха бесплатна: отметка в
    // журнале), срабатывание «при включении» — с лимитом и своей ценой
    const stance = createEffect('stance', {
      disabled: true,
      activation: { mode: 'toggle' },
      pay: [{ kind: 'hitDice' }],
      triggers: [limitedPaidTrigger()],
    });

    const actor = hero([tough, stance]);
    const env = await setup(actor);
    const toasts = [];

    const payPorts = {
      planEffectPay: engine.planEffectPay,
      settleEffectPay: engine.settleEffectPay,
      payNeedsChoice: engine.payNeedsChoice,
      defaultPayPicks: engine.defaultPayPicks,
      withSheetResources: engine.withSheetResources,
      changeEntitySheet: env.changeEntitySheet,
      sendTriggerUsageSpend: env.sendTriggerUsageSpend,
      useWorldEntities: () => ({
        findCurrentDndEntity: (entityId) => env.world.get(entityId),
      }),
      useChatStore: () => ({ getSocket: () => ({}), sendMessage: () => {} }),
      warnPayShortfall: (...shortfall) => toasts.push(shortfall),
      EFFECT_PAY_PROMPT_LABELS: {
        chatMiddle: '',
        chatSuffix: '',
        chatJoiner: '',
        shortfallTitle: '',
      },
      Set,
    };

    for (const name of [
      'commitPaySettlement',
      'choosePayOptions',
      'runWithEffectPay',
    ]) {
      payPorts[name] = await loadHandler(PAY_PATH, name, payPorts);
    }

    const switchOnEntityEffect = await loadHandler(
      TOGGLE_PATH,
      'switchOnEntityEffect',
      {
        ...payPorts,
        emitActedEntity: await loadEmitActedEntity(env),
        payEntityActivation: (entity) => entity,
        needsActivationPayment: engine.needsActivationPayment,
        findBurningActivationPeer: engine.findBurningActivationPeer,
        activateEffectOnEntity: engine.activateEffectOnEntity,
        usesPaidHitDiceRoll: engine.usesPaidHitDiceRoll,
        stampEffectPaid: engine.stampEffectPaid,
        stampEffectOnApply: (effect) => effect,
        resolveCombatRound: () => undefined,
        recordEntityActionSpend: () => {},
        sendSelfTriggerReport: () => {},
      },
    );

    switchOnEntityEffect(actor.id, stance.id);

    assert.deepEqual(toasts, []);
    assert.deepEqual(env.errors, []);

    const ledger = engine.readTriggerUsage(env.server.entity);

    assert.equal(usedOf(env.server.entity, stance.id), 1, 'лимит — один раз');

    assert.deepEqual(
      Object.values(ledger).map((entry) => entry.used),
      [1, 1],
      'отметка бесплатной кости и срабатывание — по одному разу',
    );

    assert.equal(
      env.server.entity.activeEffects.find((effect) => effect.id === stance.id)
        .disabled,
      false,
      'переключатель включён',
    );

    assert.equal(
      env.server.entity.system.classCounters[0].current,
      GRIT_POINTS - 1,
    );

    assert.equal(
      env.server.entity.system.classes[0].hitDiceUsed ?? 0,
      0,
      'первая кость после отдыха не списана',
    );
  });

  it('расход журнала шлёт только боевой помощник: в записи листа его нет', () => {
    const sheetWrite = readFileSync(
      listClientSources().find((path) =>
        toSystemPath(path).endsWith('composables/entitySheetWrite.ts'),
      ),
      'utf8',
    );

    assert.doesNotMatch(
      sheetWrite,
      /\b(?:changeEntityCombatState|sendComputedCombatState|sendTriggerUsageSpend|diffTriggerUsage)\(/u,
      'помощник листа боевой канал не зовёт',
    );
  });
});

describe('память посланного журнала', () => {
  /** Трата действия под «Замедлением» */
  const SLOW = createEffect('slow', { flags: ['actions.oneActionOrBonus'] });

  /** Ключ траты действия в журнале */
  const ACTION_SPEND_KEY = 'turnSpend|action';

  /**
   * Тратит действие боевым снимком.
   *
   * @param {object} env - окружение теста
   * @param {string} entityId - сущность
   */
  function spendAction(env, entityId) {
    env.changeEntityCombatState(entityId, (current) =>
      engine.withTriggerUsage(
        current,
        engine.recordActionSpend(current, 'action'),
      ),
    );
  }

  /**
   * Пишет лист: ячейка первого круга.
   *
   * @param {object} env - окружение теста
   * @param {string} entityId - сущность
   * @param {number} used - сколько ячеек потрачено
   */
  function writeSlots(env, entityId, used) {
    env.changeEntitySheet(entityId, (current) => ({
      ...current,
      system: {
        ...current.system,
        spellSlotsUsed: [used, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    }));
  }

  it('ответ сервера на более раннее сообщение память не сбрасывает', async () => {
    const actor = withHp(createActor, HERO_HP, { activeEffects: [SLOW] });
    const env = await setup(actor);

    // Раннее сообщение: запись листа. Ответ на неё ещё в пути
    writeSlots(env, actor.id, 1);

    const earlyEcho = structuredClone(env.server.entity.system);

    spendAction(env, actor.id);

    // Пришёл ответ на РАННЮЮ запись: объект `system` в сторе новый, расхода
    // в нём ещё нет
    Object.assign(env.world.get(actor.id), { system: earlyEcho });

    writeSlots(env, actor.id, 2);

    assert.deepEqual(
      Object.keys(engine.readTriggerUsage(env.server.entity)),
      [ACTION_SPEND_KEY],
      'полная запись несёт посланный расход',
    );
  });

  it('стор догнал — память пуста; конец хода и срок давности её стирают', async () => {
    const actor = withHp(createActor, HERO_HP, { activeEffects: [SLOW] });
    const clock = { time: 0, stamp: '1:0' };

    const env = await setup(actor, {
      now: () => clock.time,
      turnStamp: () => clock.stamp,
    });

    spendAction(env, actor.id);

    // Ход кончился: сервер сбросил счётчики хода, ответ ещё в пути
    engine.resetTriggerUsage(env.server.entity, ['turn']);
    clock.stamp = '1:1';

    writeSlots(env, actor.id, 1);

    assert.deepEqual(
      engine.readTriggerUsage(env.server.entity),
      {},
      'расход прошлого хода запись не возвращает',
    );

    // Снимок не лёг (пауза), стор его не догонит: срок вышел — забыто
    env.deliverEcho();
    spendAction(env, actor.id);
    engine.resetTriggerUsage(env.server.entity, ['turn']);
    clock.time += 6000;

    writeSlots(env, actor.id, 2);

    assert.deepEqual(engine.readTriggerUsage(env.server.entity), {});

    // Стор догнал посланное: дальше запись несёт журнал стора
    spendAction(env, actor.id);
    env.deliverEcho();
    writeSlots(env, actor.id, 3);

    assert.deepEqual(Object.keys(engine.readTriggerUsage(env.server.entity)), [
      ACTION_SPEND_KEY,
    ]);
  });
});
