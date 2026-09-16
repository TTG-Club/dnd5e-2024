import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  answeredSave,
  createActor,
  createEffect,
  createRequestRoll,
  engine,
  strikeEntity,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * События урона: удары едут в боевом снимке, Сл считается от урона, действия
 * достаются другой стороне, «0 хитов» ждёт ответа того, кто возвращает хиты.
 */

/** Атакующий — другая сторона событий урона */
const ATTACKER_ID = 'actor_attacker';

/** Максимум хитов персонажа игрока */
const HERO_MAX_HP = 40;

/** Спасбросок Телосложения против урона концентрации */
const CONCENTRATION_SAVE = {
  ability: 'constitution',
  dc: 10,
  dcFormula: engine.CONCENTRATION_SAVE_DC_FORMULA,
};

/**
 * Метка концентрации: провал спасброска от урона или 0 хитов снимают её.
 *
 * @returns {object} эффект
 */
function concentrationMark() {
  return createEffect('concentration', {
    triggers: [
      {
        id: 'trigger_concentration_damage',
        event: 'damageTaken',
        save: CONCENTRATION_SAVE,
        actions: [{ type: 'removeSelf', on: 'failed' }],
      },
      {
        id: 'trigger_concentration_zero',
        event: 'hpZero',
        actions: [{ type: 'removeSelf' }],
      },
    ],
  });
}

describe('удары в боевом снимке', () => {
  it('урон клиента едет ударом; лечение ударом не едет', () => {
    const target = withHp(createActor, 20, {}, HERO_MAX_HP);

    engine.applyTargetDamage(target, 7, false, 'fire', {
      critical: true,
      sourceId: ATTACKER_ID,
    });

    assert.deepEqual(engine.pickCombatState(target).damage, [
      {
        amount: 7,
        dealt: 7,
        types: ['fire'],
        critical: true,
        sourceId: ATTACKER_ID,
      },
    ]);

    const healed = withHp(createActor, 20, {}, HERO_MAX_HP);

    engine.applyTargetDamage(healed, 5, true);
    assert.equal(engine.pickCombatState(healed).damage, undefined);
  });

  it('удары снимка урезаются до потери хитов, негодные выбрасываются', () => {
    const hits = engine.parseDamageHits([
      { amount: 30, types: ['fire'], critical: false },
      { amount: 'много' },
      { amount: 10, types: ['cold'], critical: 'да' },
    ]);

    assert.deepEqual(hits, [
      { amount: 30, types: ['fire'], critical: false },
      { amount: 10, types: ['cold'], critical: false },
    ]);

    assert.deepEqual(
      engine.clampDamageHits(hits, 32).map((hit) => hit.amount),
      [30, 2],
    );

    assert.deepEqual(engine.clampDamageHits(hits, 0), []);
  });
});

describe('события урона', () => {
  it('сл формулой от урона: спасбросок спрашивают у игрока, провал снимает эффект', async () => {
    const system = new engine.Dnd5eVttSystem();
    const double = createRequestRoll();

    const hero = withHp(createActor, HERO_MAX_HP, {
      activeEffects: [concentrationMark()],
    });

    const result = strikeEntity(system, hero, 30, 'slashing', {
      context: { requestRoll: double.requestRoll },
    });

    assert.equal(result.accepted, true);
    assert.equal(result.deferred.length, 1);
    assert.equal(double.requests[0].payload.dc, 15, 'Сл — половина урона');

    double.answer(answeredSave(false));

    const applied = (await result.deferred[0].resolution)(hero);

    assert.equal(applied.changed, true);
    assert.equal(hero.activeEffects.length, 0);
  });

  it('урон на ходу, нанесённый сервером, тоже будит «получил урон»', () => {
    const system = new engine.Dnd5eVttSystem();

    const hero = withHp(createActor, HERO_MAX_HP, {
      activeEffects: [
        createEffect('burn', {
          triggers: [
            {
              id: 'trigger_burn',
              event: 'turnStart',
              actions: [
                { type: 'damage', parts: [{ formula: '8', type: 'fire' }] },
              ],
            },
          ],
        }),
        createEffect('scorched', {
          triggers: [
            {
              id: 'trigger_scorched',
              event: 'damageTaken',
              condition: 'damage.type === "fire"',
              actions: [{ type: 'applyTag', tag: 'scorched' }],
            },
          ],
        }),
      ],
    });

    const result = system.runTurnEffects(hero, 'startOfTurn', {});

    assert.equal(result.changed, true);
    assert.equal(engine.hasEffectTag(hero, 'scorched'), true);
    assert.equal(result.chatRolls, undefined, 'урон числом — кубиков нет');
  });

  it('кости урона и лечения хода уходят кубиками в чат', () => {
    const system = new engine.Dnd5eVttSystem();

    const burning = createEffect('Огонь', {
      triggers: [
        {
          id: 'trigger_fire',
          event: 'turnStart',
          actions: [
            {
              type: 'damage',
              parts: [
                { formula: '1d6', type: 'fire' },
                { formula: '1d4@heal' },
              ],
            },
          ],
        },
      ],
    });

    const hero = withHp(
      createActor,
      HERO_MAX_HP / 2,
      { activeEffects: [burning] },
      HERO_MAX_HP,
    );

    const result = system.runTurnEffects(hero, 'startOfTurn', {});

    // Итог подписан у броска: числа случайные — сверяем форму
    assert.deepEqual(
      result.chatRolls.map((roll) => [
        roll.formula,
        roll.label.replace(/\d+/g, 'N'),
        roll.dice.map((group) => group.sides),
      ]),
      [
        ['1к6', `Огонь → ${hero.name}: −N HP (Огненный урон)`, [6]],
        ['1к4', `Огонь → ${hero.name}: +N HP`, [4]],
      ],
    );

    assert.equal(result.chatSummary, null, 'сводка итог не повторяет');
  });

  it('действия другой стороне: урон тому, кто ударил, — без новых событий у него', () => {
    const system = new engine.Dnd5eVttSystem();

    const fireShield = () =>
      createEffect('fire-shield', {
        triggers: [
          {
            id: 'trigger_fire_shield',
            event: 'damageTaken',
            recipient: 'other',
            actions: [
              { type: 'damage', parts: [{ formula: '5', type: 'fire' }] },
            ],
          },
        ],
      });

    const attacker = withHp(createActor, HERO_MAX_HP, {
      id: ATTACKER_ID,
      activeEffects: [fireShield()],
    });

    const hero = withHp(createActor, HERO_MAX_HP, {
      activeEffects: [fireShield()],
    });

    const result = strikeEntity(system, hero, 6, 'slashing', {
      details: { sourceId: ATTACKER_ID },
      context: {
        getEntity: (entityId) =>
          entityId === ATTACKER_ID ? attacker : undefined,
      },
    });

    assert.equal(engine.resolveEntityCurrentHp(hero), 34);
    assert.equal(engine.resolveEntityCurrentHp(attacker), 35);
    assert.equal(result.related.length, 1);
    assert.equal(result.related[0].entity, attacker);
    assert.equal(result.related[0].changed, true);

    const withoutAttacker = withHp(createActor, HERO_MAX_HP, {
      activeEffects: [fireShield()],
    });

    assert.equal(
      strikeEntity(system, withoutAttacker, 6, 'slashing').related,
      undefined,
      'неизвестно, кто бил, — действия «другой стороне» молчат',
    );
  });

  it('«0 хитов»: возвращающее хиты идёт первым и держит остальные до ответа игрока', async () => {
    const fortitude = () =>
      createEffect('fortitude', {
        triggers: [
          {
            id: 'trigger_fortitude',
            event: 'hpZero',
            save: { ability: 'constitution', dc: 10 },
            actions: [{ type: 'setHp', value: 1, on: 'saved' }],
          },
        ],
      });

    /**
     * Удар до 0 хитов по персонажу с концентрацией и стойкостью.
     *
     * @param {boolean} passed - прошёл ли спасбросок стойкости
     * @returns {Promise<object>} персонаж после ответа
     */
    const dropToZero = async (passed) => {
      const system = new engine.Dnd5eVttSystem();
      const double = createRequestRoll();

      const hero = withHp(
        createActor,
        5,
        { activeEffects: [concentrationMark(), fortitude()] },
        HERO_MAX_HP,
      );

      const result = strikeEntity(system, hero, 9, 'slashing', {
        context: { requestRoll: double.requestRoll },
      });

      assert.equal(
        hero.activeEffects.length,
        2,
        'пока игрок не ответил, концентрация держится',
      );

      double.answer(answeredSave(passed));

      await (
        await result.deferred[0].resolution
      )(hero);

      return hero;
    };

    const saved = await dropToZero(true);

    assert.equal(engine.resolveEntityCurrentHp(saved), 1);
    assert.equal(saved.activeEffects.length, 2);

    const fallen = await dropToZero(false);

    assert.equal(engine.resolveEntityCurrentHp(fallen), 0);

    assert.deepEqual(
      fallen.activeEffects.map((effect) => effect.id),
      ['fortitude'],
    );
  });
});
