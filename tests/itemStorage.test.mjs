import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Сторона D&D у хранилищ предметов: взять/положить предмет в инвентарь,
 * передача фишка → фишка через те же два шага и вместимость мешка. Ошибка
 * здесь — потерянный или задвоенный предмет, поэтому проверяется и то, что
 * вход не меняется.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
`);

/**
 * Предмет инвентаря для проверок.
 *
 * @param {Record<string, unknown>} fields - поля поверх заготовки
 */
function makeItem(fields) {
  return {
    id: 'eq_1',
    name: 'Стрелы',
    description: '',
    type: 'equipment',
    quantity: 20,
    weight: 0.05,
    cost: '',
    rarity: 'none',
    equipped: false,
    isReadOnly: false,
    ...fields,
  };
}

/**
 * Сущность сцены с инвентарём.
 *
 * @param {string} id - id сущности
 * @param {unknown[]} equipment - снаряжение
 */
function makeEntity(id, equipment) {
  return { id, name: id, system: {}, equipment };
}

/** Хранилище ядра с предметами */
function makeStorage(items) {
  return {
    id: 'st_1',
    name: 'Рюкзак',
    location: { kind: 'entity', entityId: 'hero' },
    items,
    access: 'owners',
  };
}

describe('взять предмет из инвентаря', () => {
  it('весь предмет уходит со своим id и снимается со снаряжения', () => {
    const item = makeItem({ equipped: true });
    const entity = makeEntity('hero', [item]);
    const snapshot = structuredClone(entity);

    const result = engine.takeItemFromEntity(entity, 'eq_1');

    assert.equal(result.entity.equipment.length, 0);
    assert.equal(result.item.id, 'eq_1');
    assert.equal(result.item.equipped, false);
    assert.deepEqual(entity, snapshot);
  });

  it('часть стопки — копия с новым id, остаток в инвентаре', () => {
    const entity = makeEntity('hero', [makeItem({})]);
    const snapshot = structuredClone(entity);

    const result = engine.takeItemFromEntity(entity, 'eq_1', 5);

    assert.equal(result.item.quantity, 5);
    assert.notEqual(result.item.id, 'eq_1');
    assert.equal(result.entity.equipment[0].quantity, 15);
    assert.equal(result.entity.equipment[0].id, 'eq_1');
    assert.deepEqual(entity, snapshot);
  });

  it('просят больше, чем есть, — уходит вся стопка', () => {
    const entity = makeEntity('hero', [makeItem({})]);

    const result = engine.takeItemFromEntity(entity, 'eq_1', 99);

    assert.equal(result.item.id, 'eq_1');
    assert.equal(result.item.quantity, 20);
    assert.equal(result.entity.equipment.length, 0);
  });

  it('нет инвентаря, предмета или количество не целое — null', () => {
    const entity = makeEntity('hero', [makeItem({})]);

    assert.equal(
      engine.takeItemFromEntity({ id: 'x', name: 'x', system: {} }, 'eq_1'),
      null,
    );

    assert.equal(engine.takeItemFromEntity(entity, 'eq_404'), null);
    assert.equal(engine.takeItemFromEntity(entity, 'eq_1', 0), null);
    assert.equal(engine.takeItemFromEntity(entity, 'eq_1', 1.5), null);
  });
});

describe('положить предмет в инвентарь', () => {
  it('новый id, снят «надет», storageId мешка сохранён', () => {
    const entity = makeEntity('hero', []);
    const snapshot = structuredClone(entity);

    const bag = makeItem({
      id: 'eq_bag',
      name: 'Мешок',
      equipped: true,
      storageId: 'st_9',
      container: { capacityWeight: 30 },
    });

    const result = engine.giveItemToEntity(entity, bag);

    assert.notEqual(result.item.id, 'eq_bag');
    assert.equal(result.item.equipped, false);
    assert.equal(result.item.storageId, 'st_9');
    assert.deepEqual(result.item.container, { capacityWeight: 30 });
    assert.equal(result.entity.equipment.length, 1);
    assert.deepEqual(entity, snapshot);
  });

  it('без инвентаря или предмет чужой системы — null', () => {
    assert.equal(
      engine.giveItemToEntity({ id: 'x', name: 'x', system: {} }, makeItem({})),
      null,
    );

    assert.equal(
      engine.giveItemToEntity(
        makeEntity('hero', []),
        makeItem({ type: 'pf2-feat' }),
      ),
      null,
    );
  });

  it('список предметов сущности — снаряжение, без инвентаря пусто', () => {
    const item = makeItem({});

    assert.deepEqual(engine.listEntityItems(makeEntity('hero', [item])), [
      item,
    ]);

    assert.deepEqual(
      engine.listEntityItems({ id: 'x', name: 'x', system: {} }),
      [],
    );
  });
});

describe('передача фишка → фишка', () => {
  it('предмет уходит целиком, у получателя новый id и не надет', () => {
    const item = makeItem({ equipped: true });
    const source = makeEntity('a', [item]);
    const target = makeEntity('b', [makeItem({ id: 'eq_2' })]);
    const snapshots = structuredClone({ source, target });

    const result = engine.transferItem(source, target, item);

    assert.equal(result.source.equipment.length, 0);
    assert.equal(result.target.equipment.length, 2);

    const received = result.target.equipment[1];

    assert.notEqual(received.id, 'eq_1');
    assert.equal(received.equipped, false);
    assert.equal(received.quantity, 20);
    assert.deepEqual({ source, target }, snapshots);
  });

  it('самому себе, без инвентаря у получателя или без предмета — null', () => {
    const item = makeItem({});
    const source = makeEntity('a', [item]);

    assert.equal(engine.transferItem(source, source, item), null);

    assert.equal(
      engine.transferItem(source, { id: 'b', name: 'b', system: {} }, item),
      null,
    );

    assert.equal(
      engine.transferItem(
        source,
        makeEntity('b', []),
        makeItem({ id: 'eq_404' }),
      ),
      null,
    );
  });
});

describe('контейнеры', () => {
  it('контейнер — тот, у кого есть поле container', () => {
    assert.equal(engine.isContainerItem(makeItem({ container: {} })), true);
    assert.equal(engine.isContainerItem(makeItem({})), false);

    assert.equal(
      engine.isContainerItem(makeItem({ container: 'мешок' })),
      false,
    );
  });

  it('влезает, пока вес не больше вместимости', () => {
    const bag = makeItem({ name: 'Рюкзак', container: { capacityWeight: 30 } });
    const storage = makeStorage([makeItem({ weight: 1, quantity: 25 })]);

    assert.deepEqual(
      engine.canStoreItem({
        storage,
        container: bag,
        item: makeItem({ weight: 5, quantity: 1 }),
      }),
      { ok: true },
    );

    const refusal = engine.canStoreItem({
      storage,
      container: bag,
      item: makeItem({ name: 'Наковальня', weight: 6, quantity: 1 }),
    });

    assert.equal(refusal.ok, false);
    assert.match(refusal.reason, /Наковальня/);
    assert.match(refusal.reason, /31 фнт/);
  });

  it('дробный вес ровно до края — влезает', () => {
    const bag = makeItem({ container: { capacityWeight: 0.3 } });

    assert.deepEqual(
      engine.canStoreItem({
        storage: makeStorage([]),
        container: bag,
        item: makeItem({ weight: 0.1, quantity: 3 }),
      }),
      { ok: true },
    );
  });

  it('без мешка или без вместимости — влезает всё', () => {
    const heavy = makeItem({ weight: 1000, quantity: 1 });

    assert.deepEqual(
      engine.canStoreItem({
        storage: makeStorage([]),
        container: null,
        item: heavy,
      }),
      { ok: true },
    );

    assert.deepEqual(
      engine.canStoreItem({
        storage: makeStorage([]),
        container: makeItem({ container: { weightless: true } }),
        item: heavy,
      }),
      { ok: true },
    );
  });
});

describe('схема предмета', () => {
  it('принимает контейнер и отвергает испорченный', () => {
    assert.doesNotThrow(() =>
      engine.validateGameItem(
        makeItem({ container: { capacityWeight: '30' }, storageId: 'st_1' }),
      ),
    );

    assert.throws(() =>
      engine.validateGameItem(makeItem({ container: { weightless: 'да' } })),
    );
  });
});
