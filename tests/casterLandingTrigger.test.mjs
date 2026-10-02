import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  answeredSave,
  createActor,
  createEffect,
  createRequestRoll,
  engine,
  MAX_ROLL,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Эффект заклинания «на себя» со срабатыванием «при наложении»: «Связь с иным
 * планом» — спасбросок Интеллекта Сл 15, провал — 6к6 психической энергией и
 * «Недееспособный». Срабатывание будит только боевой снимок: простое
 * сохранение листа сервер событием наложения не считает.
 */

const tabPath = 'src/client/ui/actor/tabs/ActorSpellsTab.vue';

/** Эффект заклинания, как он записан в компендиуме */
const CONTACT = createEffect('Связь с иным планом', {
  effectTarget: 'self',
  duration: { type: 'special' },
  triggers: [
    {
      id: 'trigger_contact_other_plane',
      event: 'applied',
      save: { ability: 'intelligence', dc: 15 },
      actions: [
        {
          on: 'failed',
          type: 'damage',
          parts: [{ target: 'selected', formula: '6d6@dmg.psychic' }],
        },
        { on: 'failed', type: 'applyCondition', conditionKey: 'incapacitated' },
        { on: 'always', type: 'removeSelf' },
      ],
    },
  ],
});

/** Обычный самобафф без событий наложения */
const SHIELD = createEffect('Щит', {
  effectTarget: 'self',
  changes: [{ key: 'ac.bonus', mode: 'add', value: '5', priority: 20 }],
});

/**
 * Настоящее наложение эффектов заклинателя с листа персонажа.
 *
 * @param {object} actor - заклинатель (черновик листа)
 * @param {object[]} prepared - эффекты заклинания «на себя»
 * @returns {Promise<object>} обработчик и журналы
 */
async function loadApply(actor, prepared) {
  const emitted = [];
  const snapshots = [];
  const order = [];
  const timers = [];

  const ports = {
    props: { actor, isEditMode: false },
    prepareCasterSpellEffects: () => prepared,
    spellCasterSource: () => ({ saveDc: 15, spellMod: 3 }),
    hasLandingTrigger: engine.hasLandingTrigger,
    mergeAppliedEffects: engine.mergeAppliedEffects,
    emit: (event, payload) => {
      order.push(event);
      emitted.push([event, payload]);
    },
    triggerSaveIfNotEdit: () => order.push('save'),
    landCasterEventEffects: (caster, effects) => {
      order.push('snapshot');
      snapshots.push({ caster, effects });
    },
    postSpellEffectsMessage: () => order.push('chat'),
    setTimeout: (callback) => timers.push(callback),
  };

  const apply = await loadHandler(tabPath, 'applyCasterSpellEffects', ports);

  return { apply, emitted, snapshots, order, timers };
}

describe('эффект «на себя» со срабатыванием «при наложении»', () => {
  it('с листа уходит боевым снимком — после сохранений листа', async () => {
    const actor = withHp(createActor, 60);

    const { apply, emitted, snapshots, order, timers } = await loadApply(
      actor,
      [SHIELD, CONTACT],
    );

    apply({ name: 'Связь с иным планом' });

    // Обычный самобафф — прежним путём, черновиком листа
    assert.equal(emitted.length, 1);

    assert.deepEqual(
      emitted[0][1].activeEffects.map((effect) => effect.name),
      ['Щит'],
    );

    // Снимок отложен: сохранение листа этого каста уходит первым и не затрёт
    // исход срабатывания
    assert.equal(snapshots.length, 0);
    assert.equal(timers.length, 1);

    timers[0]();

    assert.deepEqual(order, ['update:actor', 'save', 'chat', 'snapshot']);

    assert.deepEqual(
      snapshots[0].effects.map((effect) => effect.name),
      ['Связь с иным планом'],
    );
  });

  it('заклинание без событий наложения идёт как раньше — без снимка', async () => {
    const actor = withHp(createActor, 60);

    const { apply, snapshots, timers, order } = await loadApply(actor, [
      SHIELD,
    ]);

    apply({ name: 'Щит' });

    assert.equal(timers.length, 0);
    assert.equal(snapshots.length, 0);
    assert.deepEqual(order, ['update:actor', 'save', 'chat']);
  });

  it('признак события наложения', () => {
    assert.equal(engine.hasLandingTrigger(CONTACT), true);
    assert.equal(engine.hasLandingTrigger(SHIELD), false);
  });

  it('снимок на сервере: спасбросок, урон по себе, состояние и снятие', async () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = withHp(createActor, 60);
    const rolls = createRequestRoll();

    const copy = structuredClone(caster);

    copy.activeEffects = engine.mergeAppliedEffects(copy.activeEffects ?? [], [
      engine.stampAppliedEffect(CONTACT, {
        carrierId: caster.id,
        sourceId: caster.id,
      }),
    ]);

    const result = system.settleCombatState(
      caster,
      engine.pickCombatState(copy),
      { requestRoll: rolls.requestRoll, getEntity: () => caster },
    );

    assert.equal(rolls.requests.length, 1, 'спасбросок спрошен у владельца');

    rolls.answer(answeredSave(false));

    // Исход применяет ядро, когда владелец ответил
    const apply = await result.deferred[0].resolution;

    withRandom([MAX_ROLL], () => apply(caster));

    assert.equal(
      caster.system.hitPoints.current,
      60 - 36,
      'урон «выбранной цели» у срабатывания на себе — по носителю',
    );

    assert.deepEqual(
      caster.activeEffects.map((effect) => effect.conditionKey),
      ['incapacitated'],
      '«Недееспособный» лёг, сам эффект снялся',
    );
  });
});
