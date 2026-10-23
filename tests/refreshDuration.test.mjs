import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Действие срабатывания «Продлить срок» (`refreshDuration`): «Ярость» 2024
 * продлевается атакой — срок снова «до конца следующего хода носителя».
 */

/** Варвар */
const BARBARIAN_ID = 'actor_barbarian';

/** Противник варвара */
const OGRE_ID = 'creature_ogre';

/** Срабатывание «Ярости»: своя атака продлевает срок */
const RAGE_REFRESH_TRIGGER = {
  id: 'trigger_rage_refresh',
  event: 'attackRoll',
  role: 'attacker',
  actions: [{ type: 'refreshDuration' }],
};

/**
 * «Ярость» на листе: переключатель до конца следующего хода носителя.
 *
 * @param {object[]} triggers - срабатывания
 * @returns {object} эффект
 */
function rageEffect(triggers = [RAGE_REFRESH_TRIGGER]) {
  return engine.withActivationDefaults(
    createEffect(engine.buildClassEffectId('barbarian', 'rage'), {
      name: 'Ярость',
      activation: { mode: 'toggle' },
      duration: { type: 'turn', turnAnchor: 'carrier', turnTiming: 'end' },
      triggers,
    }),
  );
}

/**
 * Варвар с «Яростью» на листе (выключенной).
 *
 * @param {object[]} [triggers] - срабатывания «Ярости»
 * @returns {object} персонаж
 */
function barbarianWithRage(triggers) {
  return withHp(createActor, 30, {
    id: BARBARIAN_ID,
    activeEffects: [rageEffect(triggers)],
  });
}

/**
 * Включает «Ярость» на своём ходу — как кнопка листа.
 *
 * @param {object} barbarian - варвар
 * @returns {object} варвар с горящей «Яростью»
 */
function enrageOnOwnTurn(barbarian) {
  const [rage] = barbarian.activeEffects;

  return engine.activateEffectOnEntity(barbarian, rage.id, (switched) =>
    engine.stampAppliedEffect(switched, {
      carrierId: barbarian.id,
      sourceId: barbarian.id,
      activeTurnActorId: barbarian.id,
    }),
  );
}

/**
 * Ярость варвара.
 *
 * @param {object} barbarian - варвар
 * @returns {object | undefined} эффект
 */
function rageOf(barbarian) {
  return barbarian.activeEffects.find((effect) => effect.name === 'Ярость');
}

/**
 * Конец хода варвара.
 *
 * @param {object} barbarian - варвар (меняется)
 */
function endBarbarianTurn(barbarian) {
  engine.expireTurnEffects(barbarian, barbarian.id, 'end');
}

/**
 * Атака варвара на своём ходу — клиентский путь до броска.
 *
 * @param {object} barbarian - варвар (меняется)
 * @param {string} [activeTurnActorId] - чей сейчас ход
 * @returns {object} итог срабатываний
 */
function attackAsBarbarian(barbarian, activeTurnActorId = BARBARIAN_ID) {
  return engine.runAttackRollTriggers(barbarian, 'attacker', {
    inCombat: true,
    activeTurnActorId,
  });
}

describe('«Продлить срок»: Ярость продлевается атакой', () => {
  it('атака в свой ход — Ярость живёт до конца следующего хода', () => {
    const barbarian = enrageOnOwnTurn(barbarianWithRage());

    // Ход включения: конец его — «этот» ход, Ярость живёт
    endBarbarianTurn(barbarian);
    assert.equal(rageOf(barbarian)?.disabled, false);

    // Следующий ход: атака продлевает срок — конец хода снова «этот»
    const result = attackAsBarbarian(barbarian);

    assert.equal(result.changed, true);
    assert.equal(rageOf(barbarian)?.duration.turnSkipFirst, true);

    endBarbarianTurn(barbarian);
    assert.equal(rageOf(barbarian)?.disabled, false, 'атака продлила Ярость');

    // Ход без атаки — Ярость гаснет в его конце
    endBarbarianTurn(barbarian);
    assert.equal(rageOf(barbarian)?.disabled, true);
  });

  it('без атаки Ярость гаснет как раньше — в конце следующего хода', () => {
    const barbarian = enrageOnOwnTurn(barbarianWithRage());

    endBarbarianTurn(barbarian);
    assert.equal(rageOf(barbarian)?.disabled, false);

    endBarbarianTurn(barbarian);
    assert.equal(rageOf(barbarian)?.disabled, true);
  });

  it('атака на чужом ходу (реакция) — до конца следующего своего хода', () => {
    const barbarian = enrageOnOwnTurn(barbarianWithRage());

    endBarbarianTurn(barbarian);

    // Атака возможностью в ход огра: ближайший конец своего хода — граница
    attackAsBarbarian(barbarian, OGRE_ID);
    assert.equal(rageOf(barbarian)?.duration.turnSkipFirst, false);

    endBarbarianTurn(barbarian);
    assert.equal(rageOf(barbarian)?.disabled, true);
  });

  it('вторая атака в том же ходу сущность не меняет', () => {
    const barbarian = enrageOnOwnTurn(barbarianWithRage());

    assert.equal(attackAsBarbarian(barbarian).changed, false);
  });

  it('выключенная Ярость от атаки не включается', () => {
    const barbarian = barbarianWithRage();

    const result = attackAsBarbarian(barbarian);

    assert.equal(result.changed, false);
    assert.equal(rageOf(barbarian)?.disabled, true);
  });

  it('раунды и минуты: оставшееся снова равно полному сроку', () => {
    const blessing = createEffect('blessing', {
      duration: { type: 'minutes', value: 1, remaining: 3 },
      triggers: [RAGE_REFRESH_TRIGGER],
    });

    const hero = withHp(createActor, 30, {
      id: BARBARIAN_ID,
      activeEffects: [blessing],
    });

    attackAsBarbarian(hero);
    assert.equal(hero.activeEffects[0].duration.remaining, 10);
  });

  it('эффект без срока не трогается', () => {
    const permanent = createEffect('permanent', {
      triggers: [RAGE_REFRESH_TRIGGER],
    });

    const hero = withHp(createActor, 30, {
      id: BARBARIAN_ID,
      activeEffects: [permanent],
    });

    assert.equal(attackAsBarbarian(hero).changed, false);
    assert.deepEqual(hero.activeEffects[0].duration, { type: 'permanent' });
  });

  it('серверный путь броска атаки тоже продлевает срок', () => {
    // «Сообщить» выполняет только сервер — с ним срабатывание уходит туда
    const barbarian = enrageOnOwnTurn(
      barbarianWithRage([
        {
          ...RAGE_REFRESH_TRIGGER,
          actions: [
            { type: 'refreshDuration' },
            { type: 'notify', text: 'Ярость продлена' },
          ],
        },
      ]),
    );

    endBarbarianTurn(barbarian);

    assert.equal(
      engine.isClientAttackRollTrigger(rageOf(barbarian).triggers[0]),
      false,
    );

    const ogre = withHp(createCreature, 40, { id: OGRE_ID });

    const entities = new Map([
      [barbarian.id, barbarian],
      [ogre.id, ogre],
    ]);

    const system = new engine.Dnd5eVttSystem();

    const results = system.handleClientEvent(
      engine.buildAttackRollEvent(BARBARIAN_ID, [OGRE_ID], 'normal'),
      {
        getEntity: (entityId) => entities.get(entityId),
        canControl: () => true,
        getActiveTurnActorId: () => BARBARIAN_ID,
      },
    );

    const settled = results.find((entry) => entry.entity.id === BARBARIAN_ID);

    assert.equal(settled?.changed, true);
    assert.equal(rageOf(settled.entity)?.duration.turnSkipFirst, true);

    endBarbarianTurn(settled.entity);
    assert.equal(rageOf(settled.entity)?.disabled, false);
  });
});

describe('«Продлить срок» в данных и окне эффекта', () => {
  it('схема сохраняет действие, подпись его называет', () => {
    const parsed = engine.ActiveEffectSchema.parse(rageEffect());

    assert.deepEqual(parsed.triggers[0].actions, [{ type: 'refreshDuration' }]);

    assert.match(
      engine.describeEffectTrigger(RAGE_REFRESH_TRIGGER),
      /срок эффекта начинается заново/,
    );
  });

  it('действие есть у переключателя и у эффекта на существе, но не у постоянного умения', () => {
    const layoutOf = (context, overrides = {}) =>
      engine.resolveEffectFormLayout(context, createEffect('effect', overrides))
        .triggerActions;

    assert.ok(
      layoutOf('feature', { activation: { mode: 'toggle' } }).includes(
        'refreshDuration',
      ),
    );

    assert.ok(layoutOf('ownEffects').includes('refreshDuration'));
    assert.equal(layoutOf('feature').includes('refreshDuration'), false);
  });
});
