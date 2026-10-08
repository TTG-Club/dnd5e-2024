import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  answeredSave,
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  engine,
  MIN_ROLL,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Хуки срока (`expireTurnEffects`, `decrementEffectDurations`) отдают ядру
 * полный итог срабатывания: состояние, кончившееся по сроку, запускает «когда
 * с носителя снимается состояние», и его строка в чат, спасбросок по запросу
 * владельцу и действия другим сторонам не теряются.
 */

const CASTER_ID = 'actor_caster';

/**
 * «Испуганный», который кончится на ближайшей границе раунда.
 *
 * @returns {object} эффект состояния
 */
function expiringFright() {
  return {
    ...engine.buildConditionActiveEffect('frightened'),
    duration: { type: 'rounds', value: 1, remaining: 1 },
  };
}

/**
 * Эффект со срабатыванием на конец испуга.
 *
 * @param {object} trigger - поля срабатывания
 * @param {object} overrides - поля эффекта
 * @returns {object} эффект
 */
function afterFright(trigger, overrides = {}) {
  return createEffect('После испуга', {
    triggers: [
      {
        id: 'trigger_after_fright',
        event: 'conditionLost',
        conditionKey: 'frightened',
        ...trigger,
      },
    ],
    ...overrides,
  });
}

describe('итог хуков срока', () => {
  it('срок не истёк — пустой итог', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 30);

    assert.deepEqual(system.decrementEffectDurations(hero, {}), {
      changed: false,
      chatSummary: null,
    });

    assert.deepEqual(
      system.expireTurnEffects(hero, hero.id, 'end', new Set([hero.id]), {}),
      { changed: false, chatSummary: null },
    );
  });

  it('срабатывание по сроку пишет строку в чат', () => {
    const system = new engine.Dnd5eVttSystem();

    const hero = withHp(createActor, 30, {
      activeEffects: [
        afterFright({
          actions: [{ type: 'damage', parts: [{ formula: '3@dmg.psychic' }] }],
        }),
        expiringFright(),
      ],
    });

    const result = system.decrementEffectDurations(hero, {});

    assert.equal(result.changed, true);
    assert.equal(engine.resolveEntityCurrentHp(hero), 27);
    assert.match(result.chatSummary, new RegExp(hero.name));
  });

  it('спасбросок срабатывания спрашивается у владельца', async () => {
    const system = new engine.Dnd5eVttSystem();
    const rolls = createRequestRoll();

    const hero = withHp(createActor, 30, {
      activeEffects: [
        afterFright({
          save: { ability: 'wisdom', dc: 13 },
          actions: [
            {
              on: 'failed',
              type: 'damage',
              parts: [{ formula: '4@dmg.psychic' }],
            },
          ],
        }),
        expiringFright(),
      ],
    });

    const result = system.decrementEffectDurations(hero, {
      requestRoll: rolls.requestRoll,
    });

    assert.equal(rolls.requests.length, 1, 'запрос ушёл владельцу');
    assert.equal(result.deferred?.length, 1, 'ядро ждёт ответа');
    assert.equal(engine.resolveEntityCurrentHp(hero), 30, 'до ответа — ничего');

    rolls.answer(answeredSave(false));

    const apply = await result.deferred[0].resolution;
    const applied = apply(hero);

    assert.equal(applied.changed, true);
    assert.equal(engine.resolveEntityCurrentHp(hero), 26);
  });

  it('действие наложившему уходит ядру другой стороной', () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = withHp(createActor, 30, { id: CASTER_ID, name: 'Колдун' });

    const victim = withHp(createCreature, 30, {
      id: 'creature_victim',
      activeEffects: [
        afterFright(
          {
            recipient: 'source',
            actions: [
              { type: 'damage', parts: [{ formula: '5@dmg.psychic' }] },
            ],
          },
          { sourceActorId: CASTER_ID },
        ),
        expiringFright(),
      ],
    });

    const context = {
      getEntity: (id) => (id === CASTER_ID ? caster : undefined),
    };

    const result = withRandom([MIN_ROLL], () =>
      system.decrementEffectDurations(victim, context),
    );

    assert.equal(result.changed, true);

    assert.deepEqual(
      result.related?.map((related) => related.entity.id),
      [CASTER_ID],
      'правки наложившего без этого остались бы в памяти сервера',
    );

    assert.equal(engine.resolveEntityCurrentHp(caster), 25);
    assert.equal(engine.resolveEntityCurrentHp(victim), 30);
    assert.match(result.related[0].chatSummary, /Колдун/);
  });

  it('граница хода отдаёт тот же итог', () => {
    const system = new engine.Dnd5eVttSystem();

    const hero = withHp(createActor, 30, {
      activeEffects: [
        afterFright({
          actions: [{ type: 'damage', parts: [{ formula: '2@dmg.psychic' }] }],
        }),
        {
          ...engine.buildConditionActiveEffect('frightened'),
          duration: { type: 'turn', turnAnchor: 'carrier', turnTiming: 'end' },
        },
      ],
    });

    const result = system.expireTurnEffects(
      hero,
      hero.id,
      'end',
      new Set([hero.id]),
      {},
    );

    assert.equal(result.changed, true);
    assert.equal(engine.resolveEntityCurrentHp(hero), 28);
    assert.match(result.chatSummary, new RegExp(hero.name));
  });
});
