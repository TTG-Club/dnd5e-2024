import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createActor, createEffect, engine } from './scenarios/_fixtures.mjs';

/**
 * Шаблон «при применении» лежит на листе со сроком копии, которую наложит
 * («Защищающая вспышка»: помеха атакующему до конца хода жреца). Граница хода
 * и раунд снимают только наложенную копию — шаблон с листа не уходит.
 */

const TEMPLATE_ID = 'effect-warding-flare';

const TURN_DURATION = {
  type: 'turn',
  turnAnchor: 'carrier',
  turnTiming: 'end',
};

/**
 * Шаблон применения на листе — как его кладёт умение.
 *
 * @returns {object} эффект
 */
function wardingFlareTemplate() {
  return createEffect(TEMPLATE_ID, {
    disabled: true,
    origin: 'feature',
    duration: TURN_DURATION,
    flags: ['attack.disadvantage'],
    effectTarget: 'target',
    activation: { mode: 'use', counter: 'protective-flash', range: 30 },
  });
}

/**
 * Эффекты сущности по id.
 *
 * @param {object} entity - сущность
 * @returns {string[]} id эффектов
 */
function effectIds(entity) {
  return entity.activeEffects.map((effect) => effect.id);
}

describe('шаблон «при применении» и срок по ходам', () => {
  it('конец хода носителя в бою не снимает шаблон', () => {
    const actor = createActor({ activeEffects: [wardingFlareTemplate()] });

    const changed = engine.expireTurnEffects(
      actor,
      actor.id,
      'end',
      new Set([actor.id]),
    );

    assert.equal(changed, false);
    assert.deepEqual(effectIds(actor), [TEMPLATE_ID]);
  });

  it('новый раунд у носителя вне боя не снимает шаблон', () => {
    const actor = createActor({ activeEffects: [wardingFlareTemplate()] });

    assert.equal(engine.expireOutsiderTurnEffects(actor), false);
    assert.deepEqual(effectIds(actor), [TEMPLATE_ID]);
  });

  it('наложенная копия по-прежнему истекает в конце хода', () => {
    const applied = createEffect('applied-flare', { duration: TURN_DURATION });

    const actor = createActor({
      activeEffects: [wardingFlareTemplate(), applied],
    });

    engine.expireTurnEffects(actor, actor.id, 'end', new Set([actor.id]));

    assert.deepEqual(effectIds(actor), [TEMPLATE_ID]);
  });
});
