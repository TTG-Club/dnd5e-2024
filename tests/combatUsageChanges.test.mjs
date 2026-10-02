import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEntityWrites } from './helpers/combatWrite.mjs';
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

    // Перенос траты из другой копии: ничего не снимает и не уменьшает
    assert.deepEqual(
      engine.mergeTriggerUsageSpend(
        { kept: { used: 2, per: 'turn' }, server: { used: 1, per: 'turn' } },
        { kept: { used: 1, per: 'turn' }, free: { used: 1, per: 'longRest' } },
      ),
      {
        kept: { used: 2, per: 'turn' },
        server: { used: 1, per: 'turn' },
        free: { used: 1, per: 'longRest' },
      },
    );
  });
});

describe('запись листа не откатывает журнал', () => {
  /**
   * Сервер: принимает полную запись целиком и сливает боевые снимки — как
   * ядро и система.
   *
   * @param {object} entity - сущность сервера (меняется)
   * @returns {object} приём записей
   */
  function createServer(entity) {
    const system = new engine.Dnd5eVttSystem();

    let current = entity;

    return {
      get entity() {
        return current;
      },
      receiveUpdate(next) {
        current = structuredClone(next);
      },
      receiveCombatState(copy) {
        system.settleCombatState(current, engine.pickCombatState(copy));
      },
    };
  }

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

    const server = createServer(structuredClone(entity));

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

  it('расход журнала в записи листа уходит боевым снимком, а не полной записью', async () => {
    const hero = withHp(createActor, TARGET_HP, { activeEffects: [FOCUS] });

    const { world, server, changeEntitySheet, emitted, updated } =
      await setup(hero);

    // Сервер записал расход, стор его ещё не видел
    engine.consumeTriggerUse(server.entity, 'server|key', {
      max: 1,
      per: 'turn',
    });

    // Только журнал: полной записи нет, расход — разницей
    changeEntitySheet(hero.id, (current) =>
      engine.withTriggerUsage(current, {
        ...engine.readTriggerUsage(current),
        'override|key': { used: 1, per: 'longRest' },
      }),
    );

    assert.equal(updated.length, 0);
    assert.equal(emitted.length, 1);
    server.receiveCombatState(emitted[0]);

    assert.deepEqual(
      Object.keys(engine.readTriggerUsage(server.entity)).sort(),
      ['override|key', 'server|key'],
    );

    // Лист и журнал вместе: запись — с прежним журналом, расход — снимком
    // следом
    changeEntitySheet(hero.id, (current) => {
      const paid = engine.withTriggerUsage(current, {
        ...engine.readTriggerUsage(current),
        'free|die': { used: 1, per: 'longRest' },
      });

      return { ...paid, system: { ...paid.system, inspiration: true } };
    });

    assert.equal(updated.length, 1);
    assert.equal(updated[0].system.effectUsage?.['free|die'], undefined);
    assert.equal(emitted.length, 2);

    server.receiveUpdate(updated[0]);
    server.receiveCombatState(emitted[1]);

    assert.equal(
      engine.readTriggerUsage(server.entity)['free|die'].used,
      1,
      'расход дошёл снимком',
    );

    assert.equal(
      engine.readTriggerUsage(server.entity)['override|key'].used,
      1,
      'первый расход запись не стёрла',
    );

    assert.equal(world.get(hero.id).system.inspiration, true);
    assert.equal(server.entity.system.inspiration, true);
  });

  it('перенос оплаты с ранней копии не снимает и не уменьшает журнал', () => {
    const live = withHp(createActor, TARGET_HP, {
      system: {
        ...createActor().system,
        effectUsage: { 'server|key': { used: 1, per: 'turn' } },
      },
    });

    // Копия снята до расхода сервера, оплата отметила бесплатную кость
    const spent = withHp(createActor, TARGET_HP, {
      system: {
        ...createActor().system,
        effectUsage: { 'free|die': { used: 1, per: 'longRest' } },
      },
    });

    const merged = engine.withSheetResources(live, spent);

    assert.deepEqual(engine.readTriggerUsage(merged), {
      'server|key': { used: 1, per: 'turn' },
      'free|die': { used: 1, per: 'longRest' },
    });
  });
});
