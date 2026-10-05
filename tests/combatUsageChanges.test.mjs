import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createEntityServer,
  loadEntityWrites,
} from './helpers/combatWrite.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Журнал срабатываний (`system.effectUsage`) в боевом снимке едет разницей.
 *
 * Клиент считал снимок от копии из стора. Сервер мог записать расход после
 * этой копии: бросок атаки израсходовал срабатывание «раз в ход», трата хода
 * легла снимком. Журнал копии целиком вернул бы расход назад — и лимит
 * сработал бы второй раз за ход.
 */

/** Хиты цели */
const TARGET_HP = 30;

/** «Следующая атака — с отметкой», не чаще раза в ход */
const FOCUS = createEffect('focus', {
  triggers: [
    {
      id: 'trigger_focus',
      event: 'attackRoll',
      actions: [{ type: 'applyCondition', conditionKey: 'prone' }],
      limit: { max: 1, per: 'turn' },
    },
  ],
});

/** «Замедление»: за ход — действие или бонусное действие */
const SLOW = createEffect('slow', {
  name: 'Замедление',
  flags: ['actions.oneActionOrBonus'],
});

/** Ключ счётчика «раз в ход» эффекта FOCUS */
const FOCUS_USAGE_KEY = `${FOCUS.id}|trigger_focus`;

/**
 * Копия, которую клиент снял из стора, с основой.
 *
 * @param {object} entity - сущность в момент копии
 * @returns {object} копия с записанной основой
 */
function clientCopy(entity) {
  const copy = structuredClone(entity);

  engine.recordCombatBaseline(copy, copy);

  return copy;
}

/**
 * Копия после урона: хиты меньше, журнал — какой был в копии.
 *
 * @param {object} entity - сущность в момент копии
 * @param {number} amount - урон
 * @returns {object} снимок урона
 */
function damageSnapshot(entity, amount) {
  const copy = clientCopy(entity);

  engine.writeEntityHitPoints(copy, {
    current: engine.resolveEntityCurrentHp(copy) - amount,
    temp: 0,
  });

  return engine.pickCombatState(copy);
}

describe('разница журнала: сервер сливает со своим', () => {
  it('расход «раз в ход» остаётся, когда следом приходит урон от старой копии', () => {
    const system = new engine.Dnd5eVttSystem();
    const server = withHp(createActor, TARGET_HP, { activeEffects: [FOCUS] });

    // Стор клиента: ответ сервера на расход ещё не пришёл
    const store = structuredClone(server);

    // Бросок атаки расходует срабатывание на копии и шлёт снимок
    const rolled = clientCopy(store);

    engine.runAttackRollTriggers(rolled, 'attacker', { inCombat: true });

    const rollState = engine.pickCombatState(rolled);

    assert.deepEqual(Object.keys(rollState.effectUsageChanges.spend), [
      FOCUS_USAGE_KEY,
    ]);

    system.settleCombatState(server, rollState);
    assert.equal(engine.readTriggerUsage(server)[FOCUS_USAGE_KEY].used, 1);

    // Урон собран в том же тике из стора — журнал в нём прежний
    system.settleCombatState(server, damageSnapshot(store, 5));

    assert.equal(engine.resolveEntityCurrentHp(server), TARGET_HP - 5);

    assert.equal(
      engine.readTriggerUsage(server)[FOCUS_USAGE_KEY].used,
      1,
      'расход не откатился',
    );

    // Лимит действует: второй бросок в том же ходу срабатывание не повторяет
    const second = engine.runAttackRollTriggers(server, 'attacker', {
      inCombat: true,
    });

    assert.equal(second.usageChanged, false);
  });

  it('трата хода остаётся, когда следом приходит снимок эффектов от старой копии', () => {
    const system = new engine.Dnd5eVttSystem();
    const server = withHp(createCreature, TARGET_HP, { activeEffects: [SLOW] });
    const store = structuredClone(server);

    // Трата действия снимком
    const spent = clientCopy(store);

    engine.writeTriggerUsage(spent, engine.recordActionSpend(spent, 'action'));
    system.settleCombatState(server, engine.pickCombatState(spent));

    // Эффект на себя — снимком от копии, снятой до ответа сервера
    const buffed = clientCopy(store);

    buffed.activeEffects = [...buffed.activeEffects, createEffect('shield')];
    system.settleCombatState(server, engine.pickCombatState(buffed));

    assert.deepEqual(
      server.activeEffects.map((effect) => effect.id),
      [SLOW.id, 'shield'],
    );

    assert.notEqual(
      engine.resolveActionCostBlock(server, 'bonus'),
      null,
      'бонусное действие после действия под «Замедлением» закрыто',
    );
  });

  it('расход из двух копий складывается, сброс сервера не воскресает', () => {
    const system = new engine.Dnd5eVttSystem();

    const limited = createEffect('limited', {
      triggers: [{ ...FOCUS.triggers[0], limit: { max: 3, per: 'turn' } }],
    });

    const server = withHp(createActor, TARGET_HP, { activeEffects: [limited] });
    const store = structuredClone(server);
    const key = `${limited.id}|trigger_focus`;

    for (const copy of [clientCopy(store), clientCopy(store)]) {
      engine.runAttackRollTriggers(copy, 'attacker', { inCombat: true });
      system.settleCombatState(server, engine.pickCombatState(copy));
    }

    assert.equal(engine.readTriggerUsage(server)[key].used, 2);

    // Клиент снял копию, затем сервер закончил ход и сбросил счётчики
    const stale = structuredClone(server);

    engine.resetTriggerUsage(server, ['turn']);
    system.settleCombatState(server, damageSnapshot(stale, 3));

    assert.deepEqual(engine.readTriggerUsage(server), {});
  });

  it('снимок без разницы журнала — полная замена, как раньше; негодная разница — отказ', () => {
    const system = new engine.Dnd5eVttSystem();
    const server = withHp(createActor, TARGET_HP, { activeEffects: [FOCUS] });

    engine.consumeTriggerUse(server, FOCUS_USAGE_KEY, FOCUS.triggers[0].limit);

    // Старый клиент: основы нет, журнал целиком
    const legacy = structuredClone(server);

    engine.writeTriggerUsage(legacy, {});
    engine.writeEntityHitPoints(legacy, { current: TARGET_HP - 1, temp: 0 });

    const legacyState = engine.pickCombatState(legacy);

    assert.equal(legacyState.effectUsageChanges, undefined);

    // Пустой журнал без поля — не «снять всё»: старый клиент поля не шлёт
    system.settleCombatState(server, legacyState);
    assert.equal(engine.readTriggerUsage(server)[FOCUS_USAGE_KEY].used, 1);

    system.settleCombatState(server, {
      ...legacyState,
      effectUsage: { [FOCUS_USAGE_KEY]: { used: 1, per: 'round' } },
    });

    assert.equal(
      engine.readTriggerUsage(server)[FOCUS_USAGE_KEY].per,
      'round',
      'журнал снимка лёг целиком',
    );

    const before = JSON.stringify(server);

    for (const effectUsageChanges of [
      {
        spend: { [FOCUS_USAGE_KEY]: { used: -1, per: 'turn' } },
        removeKeys: [],
      },
      { spend: {}, removeKeys: [''] },
      { spend: {} },
    ]) {
      assert.equal(
        engine.applyCombatState(server, {
          ...damageSnapshot(server, 2),
          effectUsageChanges,
        }),
        false,
      );
    }

    assert.equal(JSON.stringify(server), before, 'негодный снимок не лёг');
  });

  it('разница и слияние журнала — по ключам', () => {
    const base = {
      kept: { used: 1, per: 'turn' },
      grown: { used: 1, per: 'turn' },
      reset: { used: 2, per: 'round' },
      lowered: { used: 3, per: 'turn' },
    };

    const next = {
      kept: { used: 1, per: 'turn' },
      grown: { used: 2, per: 'turn' },
      lowered: { used: 1, per: 'turn' },
      added: { used: 1, per: 'shortRest' },
    };

    const changes = engine.diffTriggerUsage(base, next);

    assert.deepEqual(changes, {
      spend: {
        grown: { used: 1, per: 'turn' },
        lowered: { used: 1, per: 'turn' },
        added: { used: 1, per: 'shortRest' },
      },
      removeKeys: ['reset', 'lowered'],
    });

    assert.deepEqual(
      engine.applyTriggerUsageChanges(
        { ...base, grown: { used: 2, per: 'turn' } },
        changes,
      ),
      {
        kept: { used: 1, per: 'turn' },
        grown: { used: 3, per: 'turn' },
        lowered: { used: 1, per: 'turn' },
        added: { used: 1, per: 'shortRest' },
      },
    );

    assert.equal(
      engine.hasTriggerUsageChanges(engine.diffTriggerUsage(base, base)),
      false,
    );
  });
});

describe('запись листа не откатывает журнал', () => {
  /**
   * Мир клиента и сервер с одной сущностью.
   *
   * @param {object} entity - сущность
   * @returns {Promise<object>} помощники записи, мир и сервер
   */
  async function setup(entity) {
    const world = new Map([[entity.id, structuredClone(entity)]]);

    const writes = await loadEntityWrites({
      world,
      recordCombatBaseline: engine.recordCombatBaseline,
    });

    const server = createEntityServer(engine, structuredClone(entity));

    return { world, server, ...writes };
  }

  it('запись ресурса сразу после расхода журнала боевым снимком несёт расход', async () => {
    const hero = withHp(createActor, TARGET_HP, {
      activeEffects: [SLOW],
      system: {
        ...createActor().system,
        spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    });

    const {
      world,
      server,
      changeEntityCombatState,
      changeEntitySheet,
      emitted,
      updated,
    } = await setup(hero);

    // Трата хода снимком: стор клиента ответа сервера ещё не видел
    changeEntityCombatState(hero.id, (current) =>
      engine.withTriggerUsage(
        current,
        engine.recordActionSpend(current, 'action'),
      ),
    );

    server.receiveCombatState(emitted[0]);

    assert.equal(world.get(hero.id).system.effectUsage, undefined);

    // В том же тике — полная запись ячейки
    changeEntitySheet(hero.id, (current) => ({
      ...current,
      system: {
        ...current.system,
        spellSlotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    }));

    assert.equal(updated.length, 1);
    server.receiveUpdate(updated[0]);

    assert.deepEqual(
      Object.keys(engine.readTriggerUsage(server.entity)),
      ['turnSpend|action'],
      'полная запись не стёрла трату хода',
    );

    assert.equal(server.entity.system.spellSlotsUsed[0], 1);

    // Ответ сервера пришёл — стор догнал, помнить больше нечего
    Object.assign(world.get(hero.id), {
      system: structuredClone(server.entity.system),
    });

    changeEntitySheet(hero.id, (current) => ({
      ...current,
      system: {
        ...current.system,
        spellSlotsUsed: [2, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    }));

    assert.deepEqual(Object.keys(engine.readTriggerUsage(updated[1])), [
      'turnSpend|action',
    ]);
  });

  it('запись листа журнал не шлёт: расход уходит боевым помощником, один раз', async () => {
    const hero = withHp(createActor, TARGET_HP, { activeEffects: [FOCUS] });

    const {
      world,
      server,
      changeEntitySheet,
      sendTriggerUsageSpend,
      emitted,
      updated,
      errors,
    } = await setup(hero);

    // Сервер записал расход, стор его ещё не видел
    engine.consumeTriggerUse(server.entity, 'server|key', {
      max: 1,
      per: 'turn',
    });

    // Оплата на копии: отметка бесплатной кости и вдохновение
    const payer = world.get(hero.id);

    const paid = engine.withTriggerUsage(
      { ...payer, system: { ...payer.system, inspiration: true } },
      { 'free|die': { used: 1, per: 'longRest' } },
    );

    // Ресурсы — записью листа: журнал копии в неё не попадает
    changeEntitySheet(hero.id, (current) =>
      engine.withSheetResources(current, paid),
    );

    assert.equal(updated.length, 1);
    assert.equal(emitted.length, 0, 'запись листа боевой снимок не шлёт');
    assert.equal(updated[0].system.effectUsage?.['free|die'], undefined);
    assert.deepEqual(errors, []);

    // Расход журнала — боевым помощником, разницей «до оплаты → после»
    assert.equal(sendTriggerUsageSpend(payer, paid), true);
    assert.equal(emitted.length, 1);

    server.receiveCombatState(emitted[0]);

    assert.deepEqual(
      Object.keys(engine.readTriggerUsage(server.entity)).sort(),
      ['free|die', 'server|key'],
      'расход дошёл и расход сервера не стёрт',
    );

    assert.equal(engine.readTriggerUsage(server.entity)['free|die'].used, 1);
    assert.equal(world.get(hero.id).system.inspiration, true);

    // Без расхода слать нечего
    assert.equal(sendTriggerUsageSpend(paid, paid), false);
    assert.equal(emitted.length, 1);
  });

  it('преобразование листа, тронувшее журнал, — ошибка: журнал не уходит', async () => {
    const hero = withHp(createActor, TARGET_HP);
    const { changeEntitySheet, emitted, updated, errors } = await setup(hero);

    // Только журнал: писать нечего
    assert.equal(
      changeEntitySheet(hero.id, (current) =>
        engine.withTriggerUsage(current, {
          'override|key': { used: 1, per: 'longRest' },
        }),
      ),
      null,
    );

    // Журнал вместе с листом: лист уходит, журнал — нет
    changeEntitySheet(hero.id, (current) => {
      const marked = engine.withTriggerUsage(current, {
        'override|key': { used: 1, per: 'longRest' },
      });

      return { ...marked, system: { ...marked.system, inspiration: true } };
    });

    assert.equal(errors.length, 2);
    assert.equal(emitted.length, 0);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].system.effectUsage, undefined);
    assert.equal(updated[0].system.inspiration, true);
  });

  it('перенос оплаты с ранней копии журнал не трогает: ключ прошлого хода не возвращается', () => {
    // Свежая сущность: ход кончился, сервер сбросил счётчики хода
    const live = withHp(createActor, TARGET_HP, {
      system: {
        ...createActor().system,
        effectUsage: { 'server|key': { used: 1, per: 'longRest' } },
      },
    });

    // Копия снята до конца хода: вопрос о цене висел через него
    const spent = withHp(createActor, TARGET_HP, {
      system: {
        ...createActor().system,
        inspiration: true,
        effectUsage: {
          'turnSpend|action': { used: 1, per: 'turn' },
          'free|die': { used: 1, per: 'longRest' },
        },
      },
    });

    const merged = engine.withSheetResources(live, spent);

    assert.equal(merged.system.inspiration, true, 'ресурсы листа — с копии');

    assert.deepEqual(
      engine.readTriggerUsage(merged),
      { 'server|key': { used: 1, per: 'longRest' } },
      'журнал — свежей сущности',
    );
  });
});
