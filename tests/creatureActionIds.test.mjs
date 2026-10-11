import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { createCreature } from './scenarios/_fixtures.mjs';

/**
 * `id` записей боевого блока существа.
 *
 * Частичная запись сущности правит списки по записям, только если у каждой
 * записи есть свой `id`. У действий существа его не было: удаление одного
 * действия отправляло на сервер весь список, и правка соседнего действия,
 * сделанная в это же время с другого клиента, затиралась (живая проверка
 * 11.10).
 */

// Движок и построение правки ядра собираются один раз на файл

const engine = await loadEngineBundle(
  "export * from './src/engine/index.ts'; export { applyEntityPatch, buildEntityPatch } from '@vtt/shared';",
);

/**
 * Существо с боевым блоком без `id` — как из компендиума или старого мира.
 *
 * @returns {object} существо
 */
function createHawk() {
  const creature = createCreature();

  return {
    ...creature,
    system: {
      ...creature.system,
      traits: [{ name: 'Острое зрение', description: [] }],
      actions: [
        { name: 'Клюв', description: [], attackBonus: 4 },
        { name: 'Когти', description: [], attackBonus: 4 },
      ],
      bonusActions: [{ name: 'Рывок', description: [] }],
      reactions: [{ name: 'Уклонение', description: [] }],
      legendary: { count: 1, actions: [{ name: 'Взмах', description: [] }] },
      lair: { effects: [{ name: 'Порыв ветра', description: [] }] },
    },
  };
}

/**
 * Все записи боевого блока существа одним списком.
 *
 * @param {object} creature - существо
 * @returns {object[]} записи
 */
function collectEntries(creature) {
  const { system } = creature;

  return [
    ...system.traits,
    ...system.actions,
    ...system.bonusActions,
    ...system.reactions,
    ...system.legendary.actions,
    ...system.lair.effects,
  ];
}

describe('id записей боевого блока', () => {
  it('нормализация выдаёт id каждой записи каждого списка', () => {
    const hawk = createHawk();

    engine.normalizeCreature(hawk);

    const ids = collectEntries(hawk).map((entry) => entry.id);

    assert.equal(ids.length, 7);
    assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
    assert.equal(new Set(ids).size, ids.length, 'id не повторяются');
  });

  it('id предсказуем: клиент и сервер выдают одной записи один и тот же', () => {
    const onServer = createHawk();
    const onClient = structuredClone(onServer);

    engine.normalizeCreature(onServer);
    engine.normalizeCreature(onClient);

    assert.deepEqual(
      collectEntries(onClient).map((entry) => entry.id),
      collectEntries(onServer).map((entry) => entry.id),
    );
  });

  it('выданный id от места и названия дальше не зависит', () => {
    const hawk = createHawk();

    engine.normalizeCreature(hawk);

    const [beak, claws] = hawk.system.actions;
    const beakId = beak.id;

    // Действие переименовали и переставили — id хранится в записи
    hawk.system.actions = [claws, { ...beak, name: 'Острый клюв' }];
    engine.normalizeCreature(hawk);

    assert.equal(hawk.system.actions[1].id, beakId);
  });

  it('повторная нормализация id не меняет', () => {
    const hawk = createHawk();

    engine.normalizeCreature(hawk);

    const firstIds = collectEntries(hawk).map((entry) => entry.id);

    engine.normalizeCreature(hawk);

    assert.deepEqual(
      collectEntries(hawk).map((entry) => entry.id),
      firstIds,
    );
  });

  it('запись, скопированная вместе с id, получает свой', () => {
    const hawk = createHawk();

    hawk.system.actions = [
      { name: 'Клюв', description: [], id: 'action_same' },
      { name: 'Клюв (копия)', description: [], id: 'action_same' },
    ];

    engine.normalizeCreature(hawk);

    const [original, copy] = hawk.system.actions;

    assert.equal(original.id, 'action_same', 'первая запись id сохраняет');
    assert.notEqual(copy.id, 'action_same');
  });
});

describe('боевой блок в частичной записи', () => {
  it('удаление одного действия — одна операция, а не весь список', () => {
    const hawk = createHawk();

    engine.normalizeCreature(hawk);

    const [beak, claws] = hawk.system.actions;

    const after = {
      ...hawk,
      system: { ...hawk.system, actions: [claws] },
    };

    assert.deepEqual(engine.buildEntityPatch(hawk, after), [
      { op: 'remove', path: ['system', 'actions'], id: beak.id },
    ]);
  });

  it('две правки разных действий от одной копии ложатся обе', () => {
    const hawk = createHawk();

    engine.normalizeCreature(hawk);

    const [beak, claws] = hawk.system.actions;

    const editBeak = engine.buildEntityPatch(hawk, {
      ...hawk,
      system: {
        ...hawk.system,
        actions: [{ ...beak, attackBonus: 6 }, claws],
      },
    });

    const editClaws = engine.buildEntityPatch(hawk, {
      ...hawk,
      system: {
        ...hawk.system,
        actions: [beak, { ...claws, name: 'Острые когти' }],
      },
    });

    const afterBeak = engine.applyEntityPatch(hawk, editBeak);
    const afterBoth = engine.applyEntityPatch(afterBeak.value, editClaws);

    assert.deepEqual(
      afterBoth.value.system.actions.map((action) => [
        action.name,
        action.attackBonus,
      ]),
      [
        ['Клюв', 6],
        ['Острые когти', 4],
      ],
    );
  });

  it('новое действие с id — одна вставка', () => {
    const hawk = createHawk();

    engine.normalizeCreature(hawk);

    const bite = {
      id: engine.createCreatureActionId(),
      name: 'Укус',
      description: [],
    };

    const after = {
      ...hawk,
      system: { ...hawk.system, actions: [...hawk.system.actions, bite] },
    };

    assert.deepEqual(engine.buildEntityPatch(hawk, after), [
      {
        op: 'insert',
        path: ['system', 'actions'],
        value: bite,
        beforeId: null,
      },
    ]);
  });
});
