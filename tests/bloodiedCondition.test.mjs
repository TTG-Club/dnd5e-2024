import assert from 'node:assert/strict';

import { afterEach, describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

const system = new engine.Dnd5eVttSystem();

/**
 * Есть ли на сущности значок состояния.
 *
 * @param {object} entity - персонаж или существо
 * @param {string} conditionKey - ключ состояния
 * @returns {boolean} значок стоит
 */
function hasMark(entity, conditionKey = 'bloodied') {
  return (entity.activeEffects ?? []).some(
    (effect) => effect.conditionKey === conditionKey,
  );
}

/**
 * Запись мира со состоянием — как её собирает форма «Мастерской».
 *
 * @param {object} input - поля формы
 * @returns {object} запись мира
 */
function conditionRecord(input) {
  return engine.buildConditionRecord({
    id: `condition_${input.conditionKey}`,
    description: '',
    effect: null,
    ...input,
  });
}

/**
 * Подключает записи мира к движку — как это делает серверная часть системы.
 *
 * @param {object[]} records - записи мира
 */
function useWorldRecords(records) {
  const conditions = engine.parseWorldConditionRecords(records);

  engine.setWorldConditionsSource(() => conditions);
}

afterEach(() => {
  engine.setWorldConditionsSource(null);
});

describe('«Окровавленный» — правило канона', () => {
  it('у канона правило «хитов не больше половины», своей механики нет', () => {
    const entry = engine.getConditionEntry('bloodied');
    const mark = engine.buildConditionActiveEffect('bloodied');

    assert.equal(entry?.autoApply, engine.BLOODIED_AUTO_APPLY);
    assert.deepEqual(mark?.changes, []);
    assert.deepEqual(mark?.flags ?? [], []);
  });

  it('нормализация существа ставит значок на половине хитов и снимает выше', () => {
    const hurt = withHp(createCreature, 10, { id: 'creature_hurt' }, 20);
    const healthy = withHp(createCreature, 11, { id: 'creature_ok' }, 20);

    healthy.activeEffects = [
      createEffect('condition_bloodied', { conditionKey: 'bloodied' }),
    ];

    system.normalizeCreature(hurt);
    system.normalizeCreature(healthy);

    assert.equal(hasMark(hurt), true);
    assert.equal(hasMark(healthy), false);
  });

  it('нормализация персонажа сверяет значок с хитами, значок один', () => {
    const actor = withHp(createActor, 4, { id: 'actor_hurt' }, 30);

    system.normalizeActor(actor);
    system.normalizeActor(actor);

    const marks = actor.activeEffects.filter(
      (effect) => effect.conditionKey === 'bloodied',
    );

    assert.equal(marks.length, 1);
  });

  it('существо без максимума хитов значка не получает', () => {
    const creature = withHp(createCreature, 0, { id: 'creature_text' }, 0);

    system.normalizeCreature(creature);

    assert.equal(hasMark(creature), false);
  });
});

describe('правило состояния из мира', () => {
  it('правка канона с пустым правилом выключает его', () => {
    useWorldRecords([
      conditionRecord({
        conditionKey: 'bloodied',
        name: 'Окровавленный',
        autoApply: '',
      }),
    ]);

    const hurt = withHp(createCreature, 2, { id: 'creature_hurt' }, 20);

    system.normalizeCreature(hurt);

    assert.equal(hasMark(hurt), false);
  });

  it('правка канона без поля правила наследует правило канона', () => {
    useWorldRecords([
      conditionRecord({ conditionKey: 'bloodied', name: 'Окровавлен' }),
    ]);

    const hurt = withHp(createCreature, 2, { id: 'creature_hurt' }, 20);

    system.normalizeCreature(hurt);

    assert.equal(hasMark(hurt), true);
  });

  it('своё состояние мира вешается и снимается по своему правилу', () => {
    useWorldRecords([
      conditionRecord({
        conditionKey: 'gravely_wounded_x1',
        name: 'Тяжело ранен',
        autoApply: 'self.hp.value <= 5',
      }),
    ]);

    const actor = withHp(createActor, 5, { id: 'actor_grave' }, 30);

    system.normalizeActor(actor);
    assert.equal(hasMark(actor, 'gravely_wounded_x1'), true);

    actor.system.hitPoints.current = 6;
    system.normalizeActor(actor);
    assert.equal(hasMark(actor, 'gravely_wounded_x1'), false);
  });

  it('запись сохраняет и отдаёт правило', () => {
    const record = conditionRecord({
      conditionKey: 'shaken_x2',
      name: 'Потрясён',
      autoApply: 'self.hp.temp === 0',
    });

    assert.equal(
      engine.parseConditionRecord(record)?.autoApply,
      'self.hp.temp === 0',
    );
  });
});

describe('части правила состояния', () => {
  it('только о виде сущности: без событий и без источника', () => {
    const kinds = engine.listStateConditionKinds();

    assert.ok(kinds.includes('selfBloodied'));
    assert.ok(kinds.includes('selfHpAtMost'));

    for (const kind of [
      'damageType',
      'attackLanded',
      'otherBloodied',
      'selfTagFromSource',
      'sourceWithin',
    ]) {
      assert.equal(kinds.includes(kind), false, kind);
    }
  });
});
