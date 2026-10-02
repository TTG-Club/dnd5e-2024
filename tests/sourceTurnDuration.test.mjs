import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  answeredSave,
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  engine,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Срок «до конца / начала хода НАЛОЖИВШЕГО»: бой ведёт ядро, поэтому тест
 * повторяет его порядок вызовов на границе хода (модуль инициативы ядра):
 * конец хода — эффекты хода уходящего, «ход наложившего» у всех, снятие точных
 * сроков у всех; начало хода — то же для входящего.
 */

const HERO_ID = 'actor_hero';
const MONSTER_ID = 'creature_monster';
const BYSTANDER_ID = 'creature_bystander';
const OUTSIDER_ID = 'creature_outsider';

/** Порядок инициативы: герой, чудовище, посторонний */
const ORDER = [HERO_ID, MONSTER_ID, BYSTANDER_ID];

/**
 * Бой из трёх участников с порядком вызовов ядра и существом вне инициативы.
 *
 * @param {object} options - каким ядром ведётся бой
 * @param {boolean} options.boundariesForAll - ядро разносит границы ходов и
 *   сущностям вне боя
 * @returns {object} участники и шаги боя
 */
function createEncounter({ boundariesForAll = false } = {}) {
  const system = new engine.Dnd5eVttSystem();

  const entities = new Map([
    [HERO_ID, withHp(createActor, 30, { id: HERO_ID, name: 'Герой' })],
    [
      MONSTER_ID,
      withHp(createCreature, 30, { id: MONSTER_ID, name: 'Чудовище' }),
    ],
    [
      BYSTANDER_ID,
      withHp(createCreature, 30, { id: BYSTANDER_ID, name: 'Посторонний' }),
    ],
  ]);

  // Существо мира, которого в инициативе нет
  const outsider = withHp(createCreature, 30, {
    id: OUTSIDER_ID,
    name: 'Зритель',
  });

  const worldEntities = () => [...entities.values(), outsider];

  // Кому ядро приносит границы ходов: участникам либо всему миру
  const boundaryEntities = () =>
    boundariesForAll ? worldEntities() : [...entities.values()];

  let turnIndex = 0;

  const rolls = createRequestRoll();

  const context = {
    getEntity: (entityId) =>
      entityId === OUTSIDER_ID ? outsider : entities.get(entityId),
    getActiveTurnActorId: () => ORDER[turnIndex],
    isInCombat: (entity) => entities.has(entity.id),
    getCombatRound: () => 1,
    requestRoll: rolls.requestRoll,
  };

  const participantIds = new Set(ORDER);

  /** Смена хода — как `initiative:next-turn` ядра */
  const nextTurn = () => {
    const endingId = ORDER[turnIndex];

    system.runTurnEffects(entities.get(endingId), 'endOfTurn', context);

    for (const entity of entities.values()) {
      system.runSourceTurnEffects(entity, endingId, 'endOfTurn', context);
    }

    for (const entity of boundaryEntities()) {
      system.expireTurnEffects(
        entity,
        endingId,
        'end',
        participantIds,
        context,
      );
    }

    turnIndex = (turnIndex + 1) % ORDER.length;

    // Срок в раундах идёт у всех сущностей мира, не только у участников
    if (turnIndex === 0) {
      for (const entity of worldEntities()) {
        system.decrementEffectDurations(entity, context);
      }
    }

    const startingId = ORDER[turnIndex];

    system.runTurnEffects(entities.get(startingId), 'startOfTurn', context);

    for (const entity of entities.values()) {
      system.runSourceTurnEffects(entity, startingId, 'startOfTurn', context);
    }

    for (const entity of boundaryEntities()) {
      system.expireTurnEffects(
        entity,
        startingId,
        'start',
        participantIds,
        context,
      );
    }
  };

  return {
    system,
    context,
    rolls,
    entities,
    outsider,
    nextTurn,
    activeTurnActorId: () => ORDER[turnIndex],
    /** Ходы до начала хода участника */
    advanceTo: (entityId) => {
      do {
        nextTurn();
      } while (ORDER[turnIndex] !== entityId);
    },
  };
}

/**
 * Накладывает эффект боевым снимком — как окно броска клиента.
 *
 * @param {object} encounter - бой
 * @param {string} carrierId - носитель
 * @param {string} sourceId - наложивший
 * @param {object} effect - эффект
 */
function land(encounter, carrierId, sourceId, effect) {
  const carrier = encounter.context.getEntity(carrierId);
  const copy = structuredClone(carrier);

  copy.activeEffects = engine.mergeAppliedEffects(copy.activeEffects ?? [], [
    engine.withInitializedDuration(
      engine.stampAppliedEffect(effect, {
        carrierId,
        sourceId,
        activeTurnActorId: encounter.activeTurnActorId(),
      }),
    ),
  ]);

  return encounter.system.settleCombatState(
    carrier,
    engine.pickCombatState(copy),
    encounter.context,
  );
}

/**
 * Лежит ли эффект на носителе.
 *
 * @param {object} encounter - бой
 * @param {string} carrierId - носитель
 * @param {string} name - имя эффекта
 * @returns {boolean} лежит ли
 */
function carries(encounter, carrierId, name) {
  return (encounter.context.getEntity(carrierId).activeEffects ?? []).some(
    (effect) => effect.name === name,
  );
}

const PAIRS = [
  ['персонаж → существо', HERO_ID, MONSTER_ID],
  ['существо → персонаж', MONSTER_ID, HERO_ID],
];

describe('срок «ход наложившего»', () => {
  for (const [label, sourceId, carrierId] of PAIRS) {
    it(`${label}: «до конца следующего хода наложившего»`, () => {
      const encounter = createEncounter();

      encounter.advanceTo(sourceId);
      encounter.advanceTo(sourceId);

      land(
        encounter,
        carrierId,
        sourceId,
        createEffect('Испуг', {
          conditionKey: 'frightened',
          duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'end' },
        }),
      );

      // Конец хода, в который эффект наложен, — не «следующий»
      encounter.nextTurn();
      assert.equal(carries(encounter, carrierId, 'Испуг'), true);

      // Весь круг до хода наложившего эффект держится
      encounter.advanceTo(sourceId);
      assert.equal(carries(encounter, carrierId, 'Испуг'), true);

      // Конец следующего хода наложившего снимает
      encounter.nextTurn();
      assert.equal(carries(encounter, carrierId, 'Испуг'), false);
    });

    it(`${label}: «до начала следующего хода наложившего»`, () => {
      const encounter = createEncounter();

      encounter.advanceTo(sourceId);
      encounter.advanceTo(sourceId);

      land(
        encounter,
        carrierId,
        sourceId,
        createEffect('Испуг', {
          conditionKey: 'frightened',
          duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'start' },
        }),
      );

      encounter.nextTurn();
      assert.equal(carries(encounter, carrierId, 'Испуг'), true);

      // Начало следующего хода наложившего снимает
      encounter.advanceTo(sourceId);
      assert.equal(carries(encounter, carrierId, 'Испуг'), false);
    });

    it(`${label}: удар реакцией в чужой ход — до конца хода наложившего`, () => {
      const encounter = createEncounter();

      // Ход постороннего: наложивший бьёт реакцией
      encounter.advanceTo(BYSTANDER_ID);

      land(
        encounter,
        carrierId,
        sourceId,
        createEffect('Испуг', {
          conditionKey: 'frightened',
          duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'end' },
        }),
      );

      // Первый же конец хода наложившего — «следующий»: пропуска нет
      encounter.advanceTo(sourceId);
      assert.equal(carries(encounter, carrierId, 'Испуг'), true);

      encounter.nextTurn();
      assert.equal(carries(encounter, carrierId, 'Испуг'), false);
    });
  }

  for (const [label, sourceId, carrierId] of PAIRS) {
    it(`${label}: состояние из срабатывания «при наложении» со спасброском`, async () => {
      const encounter = createEncounter();

      encounter.advanceTo(sourceId);
      encounter.advanceTo(sourceId);

      // «Ужас дракона»: провал спасброска — «Испуганный» до конца следующего
      // хода наложившего; когда испуг кончился — отметка на 24 часа
      const carrier = encounter.entities.get(carrierId);

      // Существо бросает спасбросок на сервере — минимум кости даёт провал;
      // за персонажа отвечает владелец, и исход применяет ядро
      const result = withRandom([0], () =>
        land(
          encounter,
          carrierId,
          sourceId,
          createEffect('Ужас дракона', {
            duration: { type: 'special' },
            triggers: [
              {
                id: 'trigger_dragon_fear',
                event: 'applied',
                save: { ability: 'wisdom', dc: 13 },
                actions: [
                  {
                    on: 'failed',
                    type: 'applyCondition',
                    conditionKey: 'frightened',
                    duration: {
                      type: 'turn',
                      turnAnchor: 'source',
                      turnTiming: 'end',
                    },
                  },
                ],
              },
              {
                id: 'trigger_dragon_fear_over',
                event: 'conditionLost',
                conditionKey: 'frightened',
                actions: [
                  {
                    type: 'applyTag',
                    tag: 'dragon-fear-immune',
                    label: 'Невосприимчивость',
                    duration: { type: 'hours', value: 24 },
                  },
                  { type: 'removeSelf' },
                ],
              },
            ],
          }),
        ),
      );

      for (const deferred of result.deferred ?? []) {
        encounter.rolls.answer(answeredSave(false));
        (await deferred.resolution)(carrier);
      }

      const frightened = () =>
        (carrier.activeEffects ?? []).some(
          (effect) => effect.conditionKey === 'frightened',
        );

      assert.equal(frightened(), true, 'испуг наложен');

      encounter.nextTurn();
      assert.equal(frightened(), true, 'конец хода наложения — не следующий');

      encounter.advanceTo(sourceId);
      assert.equal(frightened(), true);

      encounter.nextTurn();
      assert.equal(frightened(), false, 'конец следующего хода снимает');

      assert.equal(
        (carrier.activeEffects ?? []).some(
          (effect) => effect.tag === 'dragon-fear-immune',
        ),
        true,
        'после испуга — отметка на 24 часа',
      );
    });
  }

  it('носитель вне боя: границей хода служит новый раунд', () => {
    const encounter = createEncounter();

    encounter.advanceTo(HERO_ID);
    encounter.advanceTo(HERO_ID);

    // Герой в свой ход пугает зрителя, которого в инициативе нет: границы
    // ходов ядро разносит только участникам боя
    land(
      encounter,
      OUTSIDER_ID,
      HERO_ID,
      createEffect('Испуг', {
        conditionKey: 'frightened',
        duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'end' },
      }),
    );

    land(
      encounter,
      OUTSIDER_ID,
      HERO_ID,
      createEffect('Отвлечение', {
        flags: ['attack.disadvantage'],
        duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'start' },
      }),
    );

    const [fear] = encounter.outsider.activeEffects;

    assert.equal(
      fear.duration.turnSkipFirst,
      true,
      'наложен в ход наложившего',
    );

    // Первый новый раунд: «начало хода» истекло, пропуск «хода наложения» снят
    encounter.advanceTo(HERO_ID);
    assert.equal(carries(encounter, OUTSIDER_ID, 'Отвлечение'), false);
    assert.equal(carries(encounter, OUTSIDER_ID, 'Испуг'), true);

    // Второй новый раунд снимает «до конца следующего хода»
    encounter.advanceTo(HERO_ID);
    assert.equal(carries(encounter, OUTSIDER_ID, 'Испуг'), false);
  });

  it('ядро само разносит границы всем — раунд срок второй раз не двигает', () => {
    const encounter = createEncounter({ boundariesForAll: true });

    encounter.advanceTo(HERO_ID);
    encounter.advanceTo(HERO_ID);

    land(
      encounter,
      OUTSIDER_ID,
      HERO_ID,
      createEffect('Испуг', {
        conditionKey: 'frightened',
        duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'end' },
      }),
    );

    // Конец хода наложения снял пропуск; новый раунд эффект не трогает
    encounter.advanceTo(HERO_ID);
    assert.equal(carries(encounter, OUTSIDER_ID, 'Испуг'), true);

    // Точная граница: конец следующего хода наложившего
    encounter.nextTurn();
    assert.equal(carries(encounter, OUTSIDER_ID, 'Испуг'), false);
  });
});
