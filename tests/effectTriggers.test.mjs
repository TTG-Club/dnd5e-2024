import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createEffect, engine } from './scenarios/_fixtures.mjs';

/**
 * Модель срабатываний: чтение старых полей, запись «сначала старые поля»,
 * терпимый разбор и фразы сводки.
 */

/** Эффект, на котором проверяется модель срабатываний */
const EFFECT_ID = 'effect';

/** Спасбросок Телосложения Сл 13 */
const CONSTITUTION_SAVE = { ability: 'constitution', dc: 13 };

/** Урон ядом 2к6 */
const POISON_PARTS = [{ formula: '2d6', type: 'poison' }];

/**
 * Эффект как данные: без ключей со значением `undefined`.
 *
 * @param {object} effect - эффект
 * @returns {string} JSON
 */
function asData(effect) {
  return JSON.stringify(effect);
}

describe('чтение старых полей как срабатываний', () => {
  it('урон каждый ход: без спасброска, «без урона» и «половина урона»', () => {
    const plain = createEffect(EFFECT_ID, {
      recurringDamage: { damageParts: POISON_PARTS, timing: 'startOfTurn' },
    });

    assert.deepEqual(engine.listEffectListTriggers(plain), [
      {
        id: 'legacy.recurringDamage',
        event: 'turnStart',
        actions: [{ type: 'damage', parts: POISON_PARTS, on: 'always' }],
      },
    ]);

    const [negate] = engine.listEffectListTriggers(
      createEffect(EFFECT_ID, {
        recurringDamage: {
          damageParts: POISON_PARTS,
          timing: 'endOfTurn',
          save: { ...CONSTITUTION_SAVE, onSuccess: 'negate' },
        },
      }),
    );

    assert.equal(negate.event, 'turnEnd');
    assert.deepEqual(negate.save, CONSTITUTION_SAVE);
    assert.equal(negate.actions[0].on, 'failed');
    assert.equal(negate.actions[0].halfOnSave, undefined);

    const [half] = engine.listEffectListTriggers(
      createEffect(EFFECT_ID, {
        recurringDamage: {
          damageParts: POISON_PARTS,
          timing: 'endOfTurn',
          save: { ...CONSTITUTION_SAVE, onSuccess: 'half' },
        },
      }),
    );

    assert.equal(half.actions[0].on, 'always');
    assert.equal(half.actions[0].halfOnSave, true);
  });

  it('повторный спасбросок снимает эффект при успехе, снятие после атаки — по роли', () => {
    const effect = createEffect(EFFECT_ID, {
      recurringSave: { ability: 'wisdom', dc: 15, timing: 'endOfTurn' },
      consumeOn: 'attackOnCarrier',
    });

    assert.deepEqual(engine.listEffectListTriggers(effect), [
      {
        id: 'legacy.recurringSave',
        event: 'turnEnd',
        save: { ability: 'wisdom', dc: 15 },
        actions: [{ type: 'removeSelf', on: 'saved' }],
      },
      {
        id: 'legacy.consumeOn',
        event: 'attackRoll',
        role: 'target',
        actions: [{ type: 'removeSelf', on: 'always' }],
      },
    ]);
  });

  it('разовое срабатывание: событие по доставке, гейты по исходу «при успехе»', () => {
    const cases = [
      ['nothing', 'failed', 'failed', undefined],
      ['halfDamage', 'always', 'failed', true],
      ['halfDamageWithEffect', 'always', 'always', true],
      ['effectWithoutDamage', 'failed', 'always', undefined],
      ['onlyOnSuccess', 'saved', 'saved', undefined],
    ];

    for (const [outcome, damageGate, effectGate, half] of cases) {
      const effect = engine.writeEffectSuccessOutcome(
        createEffect(EFFECT_ID, {
          effectTarget: 'target',
          conditionKey: 'poisoned',
          applySave: { ...CONSTITUTION_SAVE, onSuccess: 'negate' },
          damageParts: POISON_PARTS,
        }),
        outcome,
      );

      const [landing] = engine.collectEffectTriggers(effect);

      assert.equal(landing.id, 'legacy.landing', outcome);
      assert.equal(landing.event, 'applied', outcome);
      assert.deepEqual(landing.save, CONSTITUTION_SAVE, outcome);

      assert.deepEqual(
        landing.actions.map((action) => [
          action.type,
          action.on,
          action.halfOnSave,
        ]),
        [
          ['damage', damageGate, half],
          ['applySelf', effectGate, undefined],
        ],
        outcome,
      );
    }

    const [entry] = engine.collectEffectTriggers(
      createEffect(EFFECT_ID, {
        areaTrigger: 'exit',
        damageParts: POISON_PARTS,
      }),
    );

    assert.equal(entry.event, 'exit');

    assert.deepEqual(
      engine.collectEffectTriggers(
        createEffect(EFFECT_ID, {
          applySave: { ...CONSTITUTION_SAVE, onSuccess: 'negate' },
        }),
      ),
      [],
      'у эффекта «на носителе» разового срабатывания нет',
    );
  });

  it('явные срабатывания идут после старых полей', () => {
    const stench = {
      id: 'trigger_stench',
      event: 'turnStart',
      save: CONSTITUTION_SAVE,
      actions: [{ type: 'applyCondition', conditionKey: 'poisoned' }],
    };

    const effect = createEffect(EFFECT_ID, {
      consumeOn: 'carrierAttack',
      triggers: [stench],
    });

    assert.deepEqual(
      engine.listEffectListTriggers(effect).map((trigger) => trigger.id),
      ['legacy.consumeOn', 'trigger_stench'],
    );
  });

  it('гейт по умолчанию: при спасброске — провал, но «половина при успехе» бьёт всегда', () => {
    const damage = { type: 'damage', parts: POISON_PARTS };
    const withSave = { save: CONSTITUTION_SAVE };

    assert.equal(engine.resolveTriggerActionGate(withSave, damage), 'failed');
    assert.equal(engine.resolveTriggerActionGate({}, damage), 'always');

    assert.equal(
      engine.resolveTriggerActionGate(withSave, {
        ...damage,
        halfOnSave: true,
      }),
      'always',
    );

    assert.equal(
      engine.resolveTriggerActionGate(withSave, {
        ...damage,
        halfOnSave: true,
        on: 'saved',
      }),
      'saved',
    );
  });
});

describe('запись «сначала старые поля»', () => {
  it('круг чтение → запись не меняет эффект со всеми старыми полями', () => {
    const saves = [
      undefined,
      { ...CONSTITUTION_SAVE, onSuccess: 'negate' },
      { ...CONSTITUTION_SAVE, onSuccess: 'half' },
    ];

    for (const save of saves) {
      for (const consumeOn of [undefined, 'carrierAttack', 'attackOnCarrier']) {
        for (const recurringSave of [
          undefined,
          { ability: 'wisdom', dc: 0, timing: 'startOfTurn' },
        ]) {
          const effect = createEffect(EFFECT_ID, {
            recurringDamage: {
              damageParts: POISON_PARTS,
              timing: 'startOfTurn',
              ...(save ? { save } : {}),
            },
            ...(recurringSave ? { recurringSave } : {}),
            ...(consumeOn ? { consumeOn } : {}),
          });

          assert.equal(
            asData(
              engine.writeEffectTriggers(
                effect,
                engine.listEffectListTriggers(effect),
              ),
            ),
            asData(effect),
          );
        }
      }
    }
  });

  it('невыразимое старым полем уходит в triggers: лимит, условие, ход источника, второй урон', () => {
    const damage = {
      id: 'legacy.recurringDamage',
      event: 'turnStart',
      actions: [{ type: 'damage', parts: POISON_PARTS, on: 'always' }],
    };

    const written = engine.writeEffectTriggers(createEffect(EFFECT_ID), [
      damage,
      { ...damage, id: 'second' },
      { ...damage, id: 'limited', limit: { max: 1, per: 'turn' } },
      { ...damage, id: 'source', turnOf: 'source' },
      { ...damage, id: 'conditional', condition: 'roll.hasAdvantage === true' },
    ]);

    assert.deepEqual(written.recurringDamage, {
      damageParts: POISON_PARTS,
      timing: 'startOfTurn',
    });

    assert.deepEqual(
      written.triggers.map((trigger) => trigger.id),
      ['second', 'limited', 'source', 'conditional'],
    );
  });

  it('старые поля, которых нет в списке, снимаются; разовое срабатывание не трогается', () => {
    const effect = createEffect(EFFECT_ID, {
      effectTarget: 'target',
      applySave: { ...CONSTITUTION_SAVE, onSuccess: 'negate' },
      recurringSave: { ability: 'wisdom', dc: 13, timing: 'endOfTurn' },
      consumeOn: 'carrierAttack',
    });

    const written = engine.writeEffectTriggers(
      effect,
      engine
        .collectEffectTriggers(effect)
        .filter((trigger) => trigger.id !== 'legacy.consumeOn'),
    );

    assert.equal(written.consumeOn, undefined);
    assert.deepEqual(written.recurringSave, effect.recurringSave);
    assert.deepEqual(written.applySave, effect.applySave);
    assert.equal(written.triggers, undefined);
  });

  it('невыразимая строка с id legacy.* получает новый id', () => {
    const written = engine.writeEffectTriggers(createEffect(EFFECT_ID), [
      {
        id: 'legacy.recurringSave',
        event: 'turnEnd',
        save: CONSTITUTION_SAVE,
        actions: [{ type: 'removeSelf', on: 'saved' }],
        limit: { max: 1, per: 'round' },
      },
    ]);

    assert.equal(written.recurringSave, undefined);
    assert.equal(written.triggers.length, 1);
    assert.equal(engine.isLegacyTrigger(written.triggers[0]), false);
  });
});

describe('разбор срабатываний', () => {
  it('незнакомое событие или действие выбрасывает одно срабатывание, не эффект', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect(EFFECT_ID, {
        triggers: [
          { id: 'ok', event: 'turnEnd', actions: [{ type: 'removeSelf' }] },
          {
            id: 'future',
            event: 'onMoonrise',
            actions: [{ type: 'removeSelf' }],
          },
          {
            id: 'bad-action',
            event: 'turnEnd',
            actions: [{ type: 'teleport' }],
          },
          {
            id: 'reserved',
            event: 'hpZero',
            actions: [{ type: 'removeSelf' }],
          },
          'мусор',
        ],
      }),
    );

    assert.deepEqual(
      parsed.triggers.map((trigger) => trigger.id),
      ['ok', 'reserved'],
    );
  });

  it('числа из полей формы и негодные необязательные поля', () => {
    const [trigger] = engine.ActiveEffectSchema.parse(
      createEffect(EFFECT_ID, {
        triggers: [
          {
            id: 'form',
            event: 'turnStart',
            turnOf: 'someone',
            save: { ability: 'wisdom', dc: '14' },
            limit: { max: '2', per: 'turn' },
            actions: [{ type: 'damage', parts: POISON_PARTS, on: 'sometimes' }],
          },
        ],
      }),
    ).triggers;

    assert.equal(trigger.turnOf, undefined);
    assert.equal(trigger.save.dc, 14);
    assert.deepEqual(trigger.limit, { max: 2, per: 'turn' });
    assert.equal(trigger.actions[0].on, undefined);
  });

  it('эффект без срабатываний разбирается как раньше — ключ не появляется', () => {
    assert.equal(
      'triggers' in engine.ActiveEffectSchema.parse(createEffect(EFFECT_ID)),
      false,
    );
  });
});

describe('фразы срабатываний', () => {
  const formatDc = (dc) => (dc === 0 ? 'Сл заклинателя' : `Сл ${dc}`);

  it('новые срабатывания: момент, спасбросок, исходы, лимит, ход источника, условие', () => {
    assert.equal(
      engine.describeEffectTrigger(
        {
          id: 'stench',
          event: 'turnStart',
          save: { ability: 'constitution', dc: 12 },
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'poisoned',
              duration: { type: 'rounds', value: 1 },
            },
          ],
          limit: { max: 1, per: 'turn' },
        },
        { formatDc },
      ),
      'в начале хода: спасбросок Телосложения, Сл 12; провал — «Отравленный» на 1 раунд; '
        + 'успех — ничего, не чаще одного раза за ход',
    );

    assert.equal(
      engine.describeEffectTrigger(
        {
          id: 'burn',
          event: 'turnEnd',
          turnOf: 'source',
          save: { ability: 'dexterity', dc: 0 },
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '2d6', type: 'fire' }],
              on: 'always',
              halfOnSave: true,
            },
            { type: 'removeSelf', on: 'saved' },
          ],
          limit: { max: 3, per: 'longRest' },
        },
        { formatDc },
      ),
      'в конце хода источника: спасбросок Ловкости, Сл заклинателя; провал — 2d6 огненный; '
        + 'успех — половина урона, эффект снимается, не чаще 3 раз за долгий отдых',
    );
  });

  it('старые поля описываются прежними фразами сводки', () => {
    const effect = createEffect(EFFECT_ID, {
      conditionKey: 'poisoned',
      recurringDamage: {
        damageParts: POISON_PARTS,
        timing: 'startOfTurn',
        save: { ...CONSTITUTION_SAVE, onSuccess: 'half' },
      },
      recurringSave: { ability: 'wisdom', dc: 15, timing: 'endOfTurn' },
      consumeOn: 'carrierAttack',
    });

    assert.deepEqual(
      engine
        .listEffectListTriggers(effect)
        .map((trigger) => engine.describeEffectTrigger(trigger, { formatDc })),
      [
        'каждый ход 2d6 ядом в начале хода (спасбросок Телосложения, Сл 13: успех — половина урона)',
        'повторный спасбросок Мудрости Сл 15 в конце хода снимает эффект',
        'снимается после своей атаки',
      ],
    );
  });
});
