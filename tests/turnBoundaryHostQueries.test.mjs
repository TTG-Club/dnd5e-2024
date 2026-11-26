import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  allCreaturesAura,
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Границы хода и раунда ядро прогоняет у КАЖДОЙ сущности мира (модуль
 * инициативы). Сущность, у которой на этой границе ничего нет, не должна
 * спрашивать ядро ни об аурах на сцене, ни об окружении фишки: эти запросы
 * перебирают фишки сцены, и в большом мире на слабом сервере смена хода шла
 * секундами (баг-репорт: `initiative:next-turn` 7,6 с на Cortex-A55).
 */

const CASTER_ID = 'actor_caster';
const TARGET_ID = 'creature_target';
const HIT_POINTS = 30;
const AURA_DAMAGE = 4;
const AURA_RADIUS_FEET = 10;

/**
 * Контекст ядра со счётчиком дорогих запросов о сцене.
 *
 * @param {Map<string, object>} entities - сущности мира по id
 * @param {Function} resolveAmbientEffects - ответ ядра об аурах
 * @returns {object} контекст и счётчик
 */
function createCountingContext(entities, resolveAmbientEffects = () => []) {
  const queries = { ambient: 0, surroundings: 0 };

  const context = {
    getEntity: (entityId) => entities.get(entityId),
    isInCombat: () => true,
    getActiveTurnActorId: () => CASTER_ID,
    getCombatRound: () => 1,
    resolveAmbientEffects: (entity) => {
      queries.ambient++;

      return resolveAmbientEffects(entity);
    },
    getSceneSurroundings: (entity) => {
      queries.surroundings++;

      return {
        token: createToken(entity.id, 0, 0),
        gridSettings: GRID,
        neighbors: [],
        areas: [],
        floors: [],
      };
    },
    getOffSceneTokens: () => [],
    takeTokenOffScene: () => false,
    returnTokenToScene: () => null,
    setTokenMovementMode: () => false,
  };

  return { context, queries };
}

describe('граница хода у сущности без работы', () => {
  it('ход наложившего, снятие по ходу и раунд не спрашивают ядро о сцене', () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = createActor({ id: CASTER_ID });
    const bystander = withHp(createCreature, HIT_POINTS, { id: TARGET_ID });

    const { context, queries } = createCountingContext(
      new Map([
        [CASTER_ID, caster],
        [TARGET_ID, bystander],
      ]),
    );

    const participants = new Set([CASTER_ID, TARGET_ID]);

    for (const timing of ['endOfTurn', 'startOfTurn']) {
      const result = system.runSourceTurnEffects(
        bystander,
        CASTER_ID,
        timing,
        context,
      );

      assert.equal(result.changed, false);
    }

    for (const edge of ['end', 'start']) {
      system.expireTurnEffects(
        bystander,
        CASTER_ID,
        edge,
        participants,
        context,
      );
    }

    system.decrementEffectDurations(bystander, context);

    assert.deepEqual(queries, { ambient: 0, surroundings: 0 });
  });

  it('левитация кончилась на границе хода — ядро просят опустить фишку', () => {
    const system = new engine.Dnd5eVttSystem();

    const floating = withHp(createCreature, HIT_POINTS, {
      id: TARGET_ID,
      activeEffects: [
        createEffect('levitate', {
          flags: ['movement.levitate'],
          duration: { type: 'turn', turnAnchor: 'carrier', turnTiming: 'end' },
        }),
      ],
    });

    const switched = [];
    const { context } = createCountingContext(new Map([[TARGET_ID, floating]]));

    const levitatingContext = {
      ...context,
      getSceneSurroundings: (entity) => ({
        ...context.getSceneSurroundings(entity),
        token: {
          ...createToken(entity.id, 0, 0),
          activeMovementModeId: 'levitate',
        },
      }),
      setTokenMovementMode: (tokenId, modeId) => {
        switched.push(modeId);

        return true;
      },
    };

    const result = system.expireTurnEffects(
      floating,
      TARGET_ID,
      'end',
      new Set([TARGET_ID]),
      levitatingContext,
    );

    assert.equal(result.changed, true);
    assert.equal(floating.activeEffects.length, 0, 'левитация снята');
    assert.deepEqual(switched, [null], 'вид перемещения выключен');
  });

  it('аура «ход наложившего» по-прежнему срабатывает на ходу её носителя', () => {
    const system = new engine.Dnd5eVttSystem();

    const caster = createActor({
      id: CASTER_ID,
      activeEffects: [
        createEffect('guardians', {
          aura: allCreaturesAura(AURA_RADIUS_FEET),
          triggers: [
            {
              id: 'trigger_guardians',
              event: 'turnEnd',
              turnOf: 'source',
              actions: [
                {
                  type: 'damage',
                  parts: [{ formula: String(AURA_DAMAGE), type: 'radiant' }],
                },
              ],
            },
          ],
        }),
      ],
    });

    const target = withHp(createCreature, HIT_POINTS, { id: TARGET_ID });
    const casterToken = createToken(CASTER_ID, 0, 0);
    const targetToken = createToken(TARGET_ID, 1, 0);

    const { context, queries } = createCountingContext(
      new Map([
        [CASTER_ID, caster],
        [TARGET_ID, target],
      ]),
      (entity) =>
        entity.id === TARGET_ID
          ? system.calculateAmbientAuras(
              targetToken,
              [
                {
                  token: casterToken,
                  effects: system.collectAuraEffects(caster),
                },
              ],
              GRID,
            )
          : [],
    );

    const result = system.runSourceTurnEffects(
      target,
      CASTER_ID,
      'endOfTurn',
      context,
    );

    assert.equal(result.changed, true);
    assert.equal(target.system.hitPoints.current, HIT_POINTS - AURA_DAMAGE);
    assert.ok(queries.ambient > 0, 'ауры спрошены у сущности с работой');
  });
});
