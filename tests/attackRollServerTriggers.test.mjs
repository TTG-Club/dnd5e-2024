import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  answeredSave,
  castEndingContext,
  concentratingCaster,
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
 * Бросок атаки на сервере: срабатывания со спасброском, уроном, концом каста и
 * действиями другой стороне выполняет сервер по событию клиента; простые
 * расходуются на клиенте до броска, как раньше.
 */

/** Атакующее существо */
const ATTACKER_ID = 'creature_ogre';

/** Цель атаки */
const TARGET_ID = 'actor_warlock';

/** Спасбросок Ловкости Сл 15 */
const DEXTERITY_SAVE = { ability: 'dexterity', dc: 15 };

/**
 * «Адское возмездие» на цели: атакующий бросает Ловкость или получает 10 огнём.
 *
 * @returns {object} эффект
 */
function rebukeEffect() {
  return createEffect('rebuke', {
    triggers: [
      {
        id: 'trigger_rebuke',
        event: 'attackRoll',
        role: 'target',
        recipient: 'other',
        save: DEXTERITY_SAVE,
        actions: [
          {
            type: 'damage',
            parts: [{ formula: '10', type: 'fire' }],
            halfOnSave: true,
          },
        ],
      },
    ],
  });
}

/**
 * Атакующий и цель с хитами.
 *
 * @param {object} options - эффекты сторон
 * @param {object[]} options.attackerEffects - эффекты атакующего
 * @param {object[]} options.targetEffects - эффекты цели
 * @returns {{ attacker: object, target: object, getEntity: Function }} стороны
 */
function createSides({ attackerEffects = [], targetEffects = [] } = {}) {
  const attacker = withHp(createCreature, 40, {
    id: ATTACKER_ID,
    activeEffects: attackerEffects,
  });

  const target = withHp(createActor, 30, {
    id: TARGET_ID,
    activeEffects: targetEffects,
  });

  const entities = new Map([
    [attacker.id, attacker],
    [target.id, target],
  ]);

  return {
    attacker,
    target,
    getEntity: (entityId) => entities.get(entityId),
  };
}

/** Событие атаки существа по цели */
const ATTACK_EVENT = engine.buildAttackRollEvent(
  ATTACKER_ID,
  [TARGET_ID],
  'normal',
);

describe('бросок атаки: кто выполняет срабатывание', () => {
  it('клиент — только снятие и наложения на субъекте; спасбросок, урон и «другой стороне» — сервер', () => {
    const { target } = createSides({ targetEffects: [rebukeEffect()] });

    assert.equal(
      engine.isClientAttackRollTrigger(target.activeEffects[0].triggers[0]),
      false,
    );

    assert.equal(engine.hasServerAttackRollTriggers(target, 'target'), true);
    assert.equal(engine.hasServerAttackRollTriggers(target, 'attacker'), false);

    const result = engine.runAttackRollTriggers(target, 'target');

    assert.equal(result.changed, false, 'клиент такое срабатывание не трогает');
  });
});

describe('бросок атаки на сервере', () => {
  it('«другой стороне»: атакующий бросает спасбросок и получает урон', () => {
    const system = new engine.Dnd5eVttSystem();

    const { attacker, getEntity } = createSides({
      targetEffects: [rebukeEffect()],
    });

    const results = withRandom([MIN_ROLL], () =>
      system.handleClientEvent(ATTACK_EVENT, {
        getEntity,
        canControl: () => true,
      }),
    );

    assert.equal(engine.resolveEntityCurrentHp(attacker), 30);

    assert.deepEqual(
      results.map((result) => [result.entity.id, result.changed]),
      [[ATTACKER_ID, true]],
    );

    assert.match(results[0].chatSummary, /атака/);
  });

  it('событие шлёт только тот, кто управляет атакующим', () => {
    const system = new engine.Dnd5eVttSystem();

    const { attacker, getEntity } = createSides({
      targetEffects: [rebukeEffect()],
    });

    const results = system.handleClientEvent(ATTACK_EVENT, {
      getEntity,
      canControl: () => false,
    });

    assert.deepEqual(results, []);
    assert.equal(engine.resolveEntityCurrentHp(attacker), 40);
  });

  it('спасбросок игрока — запросом; урон по ответу будит события урона атакующего', async () => {
    const system = new engine.Dnd5eVttSystem();
    const double = createRequestRoll();

    // Атакует персонаж игрока с концентрацией, отвечает цель-существо
    const caster = concentratingCaster(30);
    const rebukingTarget = createCreature({ activeEffects: [rebukeEffect()] });

    const entities = new Map([
      [caster.id, caster],
      [rebukingTarget.id, rebukingTarget],
    ]);

    const { context } = castEndingContext({
      getEntity: (entityId) => entities.get(entityId),
      canControl: () => true,
      requestRoll: double.requestRoll,
    });

    const results = system.handleClientEvent(
      engine.buildAttackRollEvent(caster.id, [rebukingTarget.id], 'advantage'),
      context,
    );

    // Запрос висит на исходе цели, а применяется к заклинателю: ядро найдёт его по id
    const [deferred] = results.flatMap((result) => result.deferred ?? []);

    assert.equal(deferred.entityId, caster.id);

    double.answer(answeredSave(false));

    const applied = (await deferred.resolution)(caster);

    assert.equal(engine.resolveEntityCurrentHp(caster), 20);
    assert.equal(applied.changed, true);

    assert.equal(
      applied.deferred.length,
      1,
      'урон по ответу спрашивает спасбросок концентрации',
    );
  });
});
