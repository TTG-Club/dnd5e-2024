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

const completionPath = 'src/client/composables/spellCastCompletion.ts';

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
 * Настоящее наложение эффектов заклинателя общим путём каста — одним для
 * листа, горячей панели, существа и применения умения.
 *
 * @param {object[]} prepared - готовые эффекты на заклинателя
 * @param {boolean} delivered - ушёл ли снимок
 * @returns {Promise<object>} обработчик и журналы
 */
async function loadApply(prepared, delivered = true) {
  const snapshots = [];
  const order = [];

  const apply = await loadHandler(
    completionPath,
    'applyCasterSpellEffectsToEntity',
    {
      prepareCasterSpellEffects: () => prepared,
      landCasterEventEffects: (caster, effects) => {
        order.push('snapshot');
        snapshots.push({ caster, effects });

        return delivered;
      },
      postSpellEffectsMessage: () => order.push('chat'),
    },
  );

  return { apply, snapshots, order };
}

describe('эффект «на себя» со срабатыванием «при наложении»', () => {
  it('все эффекты заклинателя уходят одним боевым снимком, затем чат', async () => {
    const actor = withHp(createActor, 60);
    const { apply, snapshots, order } = await loadApply([SHIELD, CONTACT]);

    apply({ name: 'Связь с иным планом' }, actor, { saveDc: 15 });

    // Самобафф без событий наложения идёт тем же снимком: сохранение листа
    // после конца концентрации стирало бы метку и возвращало прежний каст
    assert.equal(snapshots.length, 1);

    assert.deepEqual(
      snapshots[0].effects.map((effect) => effect.name),
      ['Щит', 'Связь с иным планом'],
    );

    assert.deepEqual(order, ['snapshot', 'chat']);
  });

  it('снимок не ушёл — в чат о наложении не пишется', async () => {
    const actor = withHp(createActor, 60);
    const { apply, order } = await loadApply([SHIELD], false);

    apply({ name: 'Щит' }, actor, { saveDc: 15 });

    assert.deepEqual(order, ['snapshot']);
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
