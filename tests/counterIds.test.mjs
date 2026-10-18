import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { createActor } from './scenarios/_fixtures.mjs';

/**
 * `id` счётчиков листа.
 *
 * Частичная запись сущности правит списки по записям, только если у каждой
 * записи есть свой `id`. У счётчиков его не было, и трата ярости отправляла на
 * сервер весь их список: трата другого счётчика, сделанная в это же время с
 * другого клиента, затиралась (живая проверка 11.10).
 */

// Движок и построение правки ядра собираются один раз на файл

const engine = await loadEngineBundle(
  "export * from './src/engine/index.ts'; export { applyEntityPatch, buildEntityPatch } from '@vtt/shared';",
);

/** Ярость варвара */
const RAGE = { counterKey: 'rage', classKey: 'barbarian', current: 3, max: 4 };

/** Очки удачи от черты */
const LUCK = {
  counterKey: 'luck',
  featureId: 'feat_lucky',
  current: 2,
  max: 2,
};

/**
 * Персонаж со счётчиками.
 *
 * @param {object[]} classCounters - счётчики листа
 * @returns {object} персонаж
 */
function actorWith(classCounters) {
  const actor = createActor();

  return { ...actor, system: { ...actor.system, classCounters } };
}

describe('id счётчиков', () => {
  it('выводится из владельца и ключа и одинаков у одинаковых записей', () => {
    const [rage, luck] = engine.withCounterIds([RAGE, LUCK]);

    assert.equal(rage.id, 'barbarian::rage');
    assert.equal(luck.id, 'feat_lucky::luck');
    assert.equal(engine.withCounterIds([{ ...RAGE }])[0].id, rage.id);
  });

  it('список, где id уже на месте, возвращается тем же объектом', () => {
    const stamped = engine.withCounterIds([RAGE, LUCK]);

    assert.equal(engine.withCounterIds(stamped), stamped);
  });

  it('сменился ключ счётчика — id пересчитывается', () => {
    const [renamed] = engine.withCounterIds([
      { ...RAGE, id: 'barbarian::rage', counterKey: 'fury' },
    ]);

    assert.equal(renamed.id, 'barbarian::fury');
  });

  it('нормализация листа выставляет id на месте', () => {
    const actor = actorWith([{ ...RAGE }, { ...LUCK }]);

    engine.normalizeActor(actor);

    assert.deepEqual(
      actor.system.classCounters.map((counter) => counter.id),
      ['barbarian::rage', 'feat_lucky::luck'],
    );
  });

  it('сущность без счётчиков и существо возвращаются как есть', () => {
    const creature = { id: 'wolf', entityType: 'creature', system: {} };

    assert.equal(engine.withPatchRecordIds(creature), creature);
  });
});

describe('счётчики в частичной записи', () => {
  it('трата одного счётчика — правка одной записи, а не всего списка', () => {
    const before = engine.withPatchRecordIds(actorWith([RAGE, LUCK]));

    const after = engine.withPatchRecordIds(
      actorWith([{ ...RAGE, current: 2 }, LUCK]),
    );

    assert.deepEqual(engine.buildEntityPatch(before, after), [
      {
        op: 'set',
        path: ['system', 'classCounters', { id: 'barbarian::rage' }, 'current'],
        value: 2,
      },
    ]);
  });

  it('две траты разных счётчиков от одной копии ложатся обе', () => {
    const snapshot = engine.withPatchRecordIds(actorWith([RAGE, LUCK]));

    const spendRage = engine.buildEntityPatch(
      snapshot,
      engine.withPatchRecordIds(actorWith([{ ...RAGE, current: 2 }, LUCK])),
    );

    const spendLuck = engine.buildEntityPatch(
      snapshot,
      engine.withPatchRecordIds(actorWith([RAGE, { ...LUCK, current: 1 }])),
    );

    const afterRage = engine.applyEntityPatch(snapshot, spendRage);
    const afterBoth = engine.applyEntityPatch(afterRage.value, spendLuck);

    assert.deepEqual(
      afterBoth.value.system.classCounters.map((counter) => counter.current),
      [2, 1],
    );
  });

  it('счётчик без id (только что добавлен мастером класса) получает его перед правкой', () => {
    const before = engine.withPatchRecordIds(actorWith([RAGE]));
    const after = engine.withPatchRecordIds(actorWith([RAGE, { ...LUCK }]));

    assert.deepEqual(engine.buildEntityPatch(before, after), [
      {
        op: 'insert',
        path: ['system', 'classCounters'],
        value: { ...LUCK, id: 'feat_lucky::luck' },
        beforeId: null,
      },
    ]);
  });
});
