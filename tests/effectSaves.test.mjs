import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(`export * from './src/engine/index.ts';`);

/** Управляющий персонажем игрок */
const PLAYER_ID = 'player';

/** Сложность спасброска эффектов в тестах */
const SAVE_DC = 13;

/** Приоритет модификатора по умолчанию */
const DEFAULT_PRIORITY = 20;

/** Приоритет, набранный в поле строкой */
const TYPED_PRIORITY = 15;

/** Итог проваленного спасброска */
const FAILED_TOTAL = 4;

/** Итог успешного спасброска */
const PASSED_TOTAL = 18;

/** Натуральная d20 нейтрального броска ядра */
const NEUTRAL_NATURAL = 13;

/** Итог нейтрального броска ядра — выше Сл */
const NEUTRAL_TOTAL = 15;

/** Идентификатор зоны */
const ZONE_ID = 'zone_poison';

/** Имя зоны — уходит в подпись запроса */
const ZONE_NAME = 'Ядовитое облако';

/**
 * Эффект в форме редактора.
 *
 * @param {string} id - идентификатор эффекта
 * @param {object} overrides - поля, отличные от умолчания
 * @returns {object} эффект
 */
function createEffect(id, overrides = {}) {
  return {
    id,
    name: id,
    description: '',
    disabled: false,
    origin: 'manual',
    transfer: false,
    duration: { type: 'permanent' },
    changes: [],
    flags: [],
    ...overrides,
  };
}

/**
 * Персонаж игрока без авто-спасбросков.
 *
 * @param {object} overrides - поля, отличные от умолчания
 * @returns {object} персонаж
 */
function createActor(overrides = {}) {
  return {
    ...structuredClone(engine.DEFAULT_ACTOR),
    id: 'actor_hero',
    name: 'Гримли',
    ownerIds: [PLAYER_ID],
    autoSaves: false,
    activeEffects: [],
    ...overrides,
  };
}

/**
 * Существо мастера (по умолчанию бросает само).
 *
 * @param {object} overrides - поля, отличные от умолчания
 * @returns {object} существо
 */
function createCreature(overrides = {}) {
  return {
    ...structuredClone(engine.DEFAULT_CREATURE),
    id: 'creature_wolf',
    name: 'Волк',
    activeEffects: [],
    ...overrides,
  };
}

/**
 * Зона с эффектами.
 *
 * @param {object[]} effects - эффекты зоны
 * @returns {object} зона
 */
function createZone(effects) {
  return {
    id: ZONE_ID,
    name: ZONE_NAME,
    shape: 'polygon',
    points: [],
    color: '',
    opacity: 1,
    aboveTokens: false,
    blocksVision: false,
    blocksLight: false,
    createdBy: 'gm',
    effects,
  };
}

/**
 * Исход спасброска эффекта.
 *
 * @param {boolean} passed - пройден ли спасбросок
 * @returns {object} исход
 */
function saveOutcome(passed) {
  return {
    effectName: 'effect',
    ability: 'constitution',
    dc: SAVE_DC,
    roll: passed ? PASSED_TOTAL : FAILED_TOTAL,
    total: passed ? PASSED_TOTAL : FAILED_TOTAL,
    passed,
  };
}

/** Спасбросок Телосложения эффекта */
const CONSTITUTION_SAVE = {
  ability: 'constitution',
  dc: SAVE_DC,
  onSuccess: 'negate',
};

/** Ответ окна системы на запрос */
function savingThrowAnswer(passed) {
  const total = passed ? PASSED_TOTAL : FAILED_TOTAL;

  return { roll: total, modifier: 0, total, passed };
}

/**
 * Запрос броска ядра, который тест завершает руками.
 *
 * @returns {{ requestRoll: Function, requests: object[], answer: Function }} двойник
 */
function createRequestRoll() {
  const requests = [];
  const resolvers = [];

  return {
    requests,
    requestRoll: (options) => {
      requests.push(options);

      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    },
    answer: (outcome) => {
      const resolve = resolvers.shift();

      assert.ok(resolve, 'Нет висящего запроса');
      resolve(outcome);
    },
  };
}

describe('effect parsing keeps the data an editor field could break', () => {
  it('drops only the unreadable modifier row and keeps the rest', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('armor', {
        changes: [
          { key: 'armorClass', mode: 'add', value: '2', priority: 20 },
          { key: '', mode: 'add', value: '', priority: 20 },
        ],
      }),
    );

    assert.deepEqual(
      parsed.changes.map((change) => change.key),
      ['armorClass'],
    );
  });

  it('reads a cleared or typed priority instead of wiping the row', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('armor', {
        changes: [
          { key: 'armorClass', mode: 'add', value: '1', priority: '' },
          {
            key: 'speed',
            mode: 'add',
            value: '5',
            priority: `${TYPED_PRIORITY}`,
          },
        ],
      }),
    );

    assert.deepEqual(
      parsed.changes.map((change) => change.priority),
      [DEFAULT_PRIORITY, TYPED_PRIORITY],
    );
  });

  it('keeps the duration type when its amount is cleared', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('slow', { duration: { type: 'rounds', value: '' } }),
    );

    assert.equal(parsed.duration.type, 'rounds');
    assert.equal(parsed.duration.value, undefined);
  });

  it('reads a saving throw DC typed as a string', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('poison', {
        applySave: { ...CONSTITUTION_SAVE, dc: `${SAVE_DC}` },
      }),
    );

    assert.equal(parsed.applySave.dc, SAVE_DC);
  });
});

describe('zone entry follows the same success rules as an attack', () => {
  it('half damage on success does not apply the status without "effect anyway"', () => {
    const entity = createActor();

    const effect = createEffect('burning', {
      flags: ['attack.disadvantage'],
      applySave: { ...CONSTITUTION_SAVE, onSuccess: 'half' },
    });

    assert.equal(
      engine.applyEntryEffect(entity, effect, saveOutcome(true)).statusApplied,
      false,
    );

    assert.equal(
      engine.applyEntryEffect(
        entity,
        { ...effect, applyOnSuccess: true },
        saveOutcome(true),
      ).statusApplied,
      true,
    );
  });

  it('an "only on success" effect skips a failed save and applies on a passed one', () => {
    const effect = createEffect('weakened', {
      flags: ['attack.disadvantage'],
      applySave: CONSTITUTION_SAVE,
      applyOnSuccessOnly: true,
    });

    assert.equal(
      engine.applyEntryEffect(createActor(), effect, saveOutcome(false))
        .statusApplied,
      false,
    );

    assert.equal(
      engine.applyEntryEffect(createActor(), effect, saveOutcome(true))
        .statusApplied,
      true,
    );
  });

  it('a condition immunity granted by a creature trait blocks the status', () => {
    const creature = createCreature();

    creature.system.traits = [
      {
        name: 'Неподвластный яду',
        description: [],
        activeEffects: [
          createEffect('immunity', { conditionImmunities: ['poisoned'] }),
        ],
      },
    ];

    const effect = createEffect('poisoned', {
      conditionKey: 'poisoned',
      flags: ['attack.disadvantage'],
    });

    assert.equal(
      engine.applyEntryEffect(creature, effect, null).statusApplied,
      false,
    );
  });

  it('dC 0 stands for the source DC', () => {
    assert.equal(engine.resolveEffectSaveDc(0, SAVE_DC), SAVE_DC);
    assert.equal(engine.resolveEffectSaveDc(SAVE_DC + 1, SAVE_DC), SAVE_DC + 1);
  });
});

describe('who rolls an effect saving throw', () => {
  it('actors roll themselves only with auto saves on, creatures by default', () => {
    assert.equal(engine.resolveAutoSaves(createActor()), false);

    assert.equal(
      engine.resolveAutoSaves(createActor({ autoSaves: true })),
      true,
    );

    assert.equal(engine.resolveAutoSaves(createCreature()), true);

    assert.equal(
      engine.resolveAutoSaves(createCreature({ autoSaves: false })),
      false,
    );
  });

  it('the request payload is the one the player window reads', () => {
    const request = engine.buildEffectSaveRollRequest(
      createActor(),
      {
        effectName: ZONE_NAME,
        ability: 'constitution',
        dc: SAVE_DC,
        againstMagic: false,
        againstCondition: 'poisoned',
      },
      engine.formatZoneRequesterLabel(ZONE_NAME),
    );

    assert.deepEqual(engine.parseSavingThrowRequestPayload(request.payload), {
      kind: engine.SAVING_THROW_REQUEST_KIND,
      ability: 'constitution',
      dc: SAVE_DC,
      againstMagic: false,
      againstCondition: 'poisoned',
      sourceName: ZONE_NAME,
    });

    assert.equal(request.requesterLabel, `Зона «${ZONE_NAME}»`);
  });

  it('settles every request outcome', () => {
    const entity = createActor();

    const spec = {
      effectName: ZONE_NAME,
      ability: 'constitution',
      dc: SAVE_DC,
      againstMagic: false,
    };

    const answered = engine.settleEffectSaveOutcome(entity, spec, {
      status: 'answered',
      result: savingThrowAnswer(false),
      respondedByUserId: PLAYER_ID,
    });

    assert.equal(answered.status, 'rolled');
    assert.equal(answered.save.passed, false);
    assert.equal(answered.note, null);

    const neutral = engine.settleEffectSaveOutcome(entity, spec, {
      status: 'takenOver',
      result: {
        neutral: true,
        formula: '1к20+2',
        total: NEUTRAL_TOTAL,
        rollData: {
          dice: [{ sides: 20, values: [NEUTRAL_NATURAL], dropped: [] }],
        },
      },
      respondedByUserId: 'gm',
    });

    assert.equal(neutral.status, 'rolled');
    assert.equal(neutral.save.roll, NEUTRAL_NATURAL);
    assert.equal(neutral.save.passed, true);

    for (const outcome of [
      { status: 'declined' },
      { status: 'timeout' },
      {
        status: 'answered',
        result: { unexpected: true },
        respondedByUserId: PLAYER_ID,
      },
    ]) {
      assert.equal(
        engine.settleEffectSaveOutcome(entity, spec, outcome).status,
        'cancelled',
      );
    }

    for (const outcome of [
      { status: 'noRecipient' },
      { status: 'rejected', reason: 'нет модуля' },
    ]) {
      const settled = engine.settleEffectSaveOutcome(entity, spec, outcome);

      assert.equal(settled.status, 'rolled');
      assert.ok(settled.note);
    }
  });

  it('the server roll honours advantage against the condition', () => {
    const entity = createActor({
      activeEffects: [
        createEffect('brave', { flags: ['save.advantage.vsPoisoned'] }),
      ],
    });

    const originalRandom = Math.random;

    let rolls = 0;

    Math.random = () => {
      rolls += 1;

      return 0;
    };

    try {
      engine.rollEffectSaveOutcome(entity, {
        effectName: ZONE_NAME,
        ability: 'constitution',
        dc: SAVE_DC,
        againstMagic: false,
        againstCondition: 'poisoned',
      });
    } finally {
      Math.random = originalRandom;
    }

    // Преимущество — две кости d20 вместо одной
    assert.equal(rolls, 2);
  });
});

describe('zone entry saves are asked of the owner', () => {
  it('defers the trigger for an actor without auto saves and applies it on the answer', async () => {
    const entity = createActor();
    const double = createRequestRoll();

    const effect = createEffect('poisoned-cloud', {
      areaTrigger: 'enter',
      flags: ['attack.disadvantage'],
      applySave: CONSTITUTION_SAVE,
    });

    const result = engine.syncActorAreaEffects(
      entity,
      new Set(),
      new Set([ZONE_ID]),
      [createZone([effect])],
      { requestRoll: double.requestRoll },
    );

    assert.equal(result.changed, false);
    assert.equal(result.deferred.length, 1);
    assert.equal(result.deferred[0].blocksMovement, false);
    assert.equal(double.requests[0].requesterLabel, `Зона «${ZONE_NAME}»`);
    assert.deepEqual(entity.activeEffects, []);

    double.answer({
      status: 'answered',
      result: savingThrowAnswer(false),
      respondedByUserId: PLAYER_ID,
    });

    const apply = await result.deferred[0].resolution;
    const outcome = apply(entity);

    assert.equal(outcome.changed, true);
    assert.equal(outcome.saveOutcomes[0].passed, false);
    assert.equal(entity.activeEffects.length, 1);
  });

  it('a declined save cancels the trigger with a chat note', async () => {
    const entity = createActor();
    const double = createRequestRoll();

    const result = engine.syncActorAreaEffects(
      entity,
      new Set(),
      new Set([ZONE_ID]),
      [
        createZone([
          createEffect('poisoned-cloud', {
            areaTrigger: 'enter',
            flags: ['attack.disadvantage'],
            applySave: CONSTITUTION_SAVE,
          }),
        ]),
      ],
      { requestRoll: double.requestRoll },
    );

    double.answer({ status: 'declined' });

    const outcome = (await result.deferred[0].resolution)(entity);

    assert.equal(outcome.changed, false);
    assert.equal(outcome.notes.length, 1);
    assert.deepEqual(entity.activeEffects, []);
  });

  it('a creature with auto saves rolls on the server at once', () => {
    const entity = createCreature();
    const double = createRequestRoll();

    const result = engine.syncActorAreaEffects(
      entity,
      new Set(),
      new Set([ZONE_ID]),
      [
        createZone([
          createEffect('poisoned-cloud', {
            areaTrigger: 'enter',
            flags: ['attack.disadvantage'],
            applySave: CONSTITUTION_SAVE,
          }),
        ]),
      ],
      { requestRoll: double.requestRoll },
    );

    assert.equal(result.deferred.length, 0);
    assert.equal(result.saveOutcomes.length, 1);
    assert.equal(double.requests.length, 0);
  });

  it('blocks movement while a save that would take the speed away is pending', () => {
    const double = createRequestRoll();

    const result = engine.syncActorAreaEffects(
      createActor(),
      new Set(),
      new Set([ZONE_ID]),
      [
        createZone([
          createEffect('web', {
            areaTrigger: 'enter',
            flags: ['speed.zero'],
            applySave: CONSTITUTION_SAVE,
          }),
        ]),
      ],
      { requestRoll: double.requestRoll },
    );

    assert.equal(result.deferred[0].blocksMovement, true);
  });
});

describe('recurring turn saves are asked of the owner', () => {
  /** Эффект с повторным спасброском в конце хода */
  function createHeldEffect() {
    return createEffect('held', {
      flags: ['attack.disadvantage'],
      recurringSave: { ability: 'wisdom', dc: SAVE_DC, timing: 'endOfTurn' },
    });
  }

  it('a passed answer removes the effect, a failed one keeps it', async () => {
    const system = new engine.Dnd5eVttSystem();

    for (const [passed, expectedEffects] of [
      [true, 0],
      [false, 1],
    ]) {
      const entity = createActor({ activeEffects: [createHeldEffect()] });
      const double = createRequestRoll();

      const result = system.runTurnEffects(entity, 'endOfTurn', {
        requestRoll: double.requestRoll,
      });

      assert.equal(result.changed, false);
      assert.equal(result.deferred.length, 1);
      assert.equal(entity.activeEffects.length, 1);

      double.answer({
        status: 'answered',
        result: savingThrowAnswer(passed),
        respondedByUserId: PLAYER_ID,
      });

      const apply = await result.deferred[0].resolution;
      const applied = apply(entity);

      assert.equal(entity.activeEffects.length, expectedEffects);
      assert.equal(applied.changed, passed);
      assert.ok(applied.chatSummary);
    }
  });

  it('does not ask twice while the first answer is pending, and ignores a removed effect', async () => {
    const system = new engine.Dnd5eVttSystem();
    const entity = createActor({ activeEffects: [createHeldEffect()] });
    const double = createRequestRoll();
    const context = { requestRoll: double.requestRoll };

    const first = system.runTurnEffects(entity, 'endOfTurn', context);
    const second = system.runTurnEffects(entity, 'endOfTurn', context);

    assert.equal(first.deferred.length, 1);
    assert.equal(second.deferred, undefined);
    assert.equal(double.requests.length, 1);

    entity.activeEffects = [];

    double.answer({
      status: 'answered',
      result: savingThrowAnswer(true),
      respondedByUserId: PLAYER_ID,
    });

    const applied = (await first.deferred[0].resolution)(entity);

    assert.equal(applied.changed, false);
    assert.equal(applied.chatSummary, null);
  });
});

describe('damage every turn can be gated by a saving throw', () => {
  /** Урон тика: плоское число, чтобы итог не зависел от кубиков */
  const TICK_DAMAGE = 5;

  /** Сложность, которую не пройти (кость максимум 20, модификатор 0) */
  const IMPOSSIBLE_DC = 99;

  /** Сложность, которую проходит любой бросок */
  const TRIVIAL_DC = 1;

  /**
   * Эффект облака: урон в начале хода со спасброском Телосложения.
   *
   * @param {object} save - поля спасброска, отличные от умолчания
   * @param {object} overrides - поля эффекта
   * @returns {object} эффект
   */
  function createCloudEffect(save = {}, overrides = {}) {
    return createEffect('cloud', {
      recurringDamage: {
        damageParts: [{ formula: `${TICK_DAMAGE}`, type: 'poison' }],
        timing: 'startOfTurn',
        save: { ...CONSTITUTION_SAVE, ...save },
      },
      ...overrides,
    });
  }

  it('a failed server roll deals full damage, a passed one follows "on success"', () => {
    for (const [dc, onSuccess, expectedDamage, status] of [
      [IMPOSSIBLE_DC, 'negate', TICK_DAMAGE, '✗ полный урон'],
      [TRIVIAL_DC, 'negate', 0, '✓ без урона'],
      [TRIVIAL_DC, 'half', Math.floor(TICK_DAMAGE / 2), '✓ половина урона'],
    ]) {
      const entity = createActor({
        autoSaves: true,
        activeEffects: [createCloudEffect({ dc, onSuccess })],
      });

      const hpBefore = engine.resolveEntityCurrentHp(entity);
      const result = engine.processTurnEffects(entity, 'startOfTurn');

      assert.equal(
        engine.resolveEntityCurrentHp(entity),
        hpBefore - expectedDamage,
      );

      assert.equal(result.damageTotal, expectedDamage);
      assert.equal(result.saveOutcomes.length, 1);
      assert.equal(result.saveOutcomes[0].damageOnSuccess, onSuccess);
      assert.equal(entity.activeEffects.length, 1, 'эффект остаётся');

      assert.ok(
        engine
          .formatTurnEffectsMessage(entity.name, 'startOfTurn', result)
          .includes(status),
      );
    }
  });

  it('the other moment of the turn neither rolls nor deals damage', () => {
    const entity = createActor({
      autoSaves: true,
      activeEffects: [createCloudEffect({ dc: IMPOSSIBLE_DC })],
    });

    const hpBefore = engine.resolveEntityCurrentHp(entity);
    const result = engine.processTurnEffects(entity, 'endOfTurn');

    assert.equal(engine.resolveEntityCurrentHp(entity), hpBefore);
    assert.equal(result.saveOutcomes.length, 0);
  });

  it('a deferred save holds the damage until the answer', () => {
    const entity = createActor({
      activeEffects: [createCloudEffect({ dc: IMPOSSIBLE_DC })],
    });

    const hpBefore = engine.resolveEntityCurrentHp(entity);

    const result = engine.processTurnEffects(entity, 'startOfTurn', {
      deferRecurringDamageSave: () => true,
    });

    assert.equal(engine.resolveEntityCurrentHp(entity), hpBefore);
    assert.equal(result.changed, false);
    assert.equal(result.deferredDamageSaveEffects.length, 1);
    assert.equal(result.saveOutcomes.length, 0);
  });

  it('the owner is asked; the answer deals damage by its outcome', async () => {
    const system = new engine.Dnd5eVttSystem();

    for (const [passed, onSuccess, expectedDamage] of [
      [false, 'negate', TICK_DAMAGE],
      [true, 'negate', 0],
      [true, 'half', Math.floor(TICK_DAMAGE / 2)],
    ]) {
      const entity = createActor({
        activeEffects: [createCloudEffect({ onSuccess })],
      });

      const hpBefore = engine.resolveEntityCurrentHp(entity);
      const double = createRequestRoll();

      const result = system.runTurnEffects(entity, 'startOfTurn', {
        requestRoll: double.requestRoll,
      });

      assert.equal(result.deferred.length, 1);
      assert.equal(engine.resolveEntityCurrentHp(entity), hpBefore);
      assert.equal(double.requests[0].payload.ability, 'constitution');
      assert.equal(double.requests[0].payload.dc, SAVE_DC);

      double.answer({
        status: 'answered',
        result: savingThrowAnswer(passed),
        respondedByUserId: PLAYER_ID,
      });

      const applied = (await result.deferred[0].resolution)(entity);

      assert.equal(
        engine.resolveEntityCurrentHp(entity),
        hpBefore - expectedDamage,
      );

      assert.equal(applied.changed, expectedDamage > 0);
      assert.ok(applied.chatSummary);
    }
  });

  it('a declined save deals no damage and leaves a chat note', async () => {
    const system = new engine.Dnd5eVttSystem();
    const entity = createActor({ activeEffects: [createCloudEffect()] });
    const hpBefore = engine.resolveEntityCurrentHp(entity);
    const double = createRequestRoll();

    const result = system.runTurnEffects(entity, 'startOfTurn', {
      requestRoll: double.requestRoll,
    });

    double.answer({ status: 'declined' });

    const applied = (await result.deferred[0].resolution)(entity);

    assert.equal(engine.resolveEntityCurrentHp(entity), hpBefore);
    assert.equal(applied.changed, false);
    assert.ok(applied.chatSummary);
  });

  it('damage and the removal save of one effect are asked separately and once', () => {
    const system = new engine.Dnd5eVttSystem();

    const entity = createActor({
      activeEffects: [
        createCloudEffect(
          {},
          {
            recurringSave: {
              ability: 'wisdom',
              dc: SAVE_DC,
              timing: 'startOfTurn',
            },
          },
        ),
      ],
    });

    const double = createRequestRoll();
    const context = { requestRoll: double.requestRoll };

    const first = system.runTurnEffects(entity, 'startOfTurn', context);
    const second = system.runTurnEffects(entity, 'startOfTurn', context);

    assert.equal(first.deferred.length, 2);
    assert.equal(second.deferred, undefined);
    assert.equal(double.requests.length, 2);
  });

  it('parsing keeps the save, and DC 0 takes the source DC on application', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createCloudEffect({ dc: `${SAVE_DC}` }),
    );

    assert.deepEqual(parsed.recurringDamage.save, CONSTITUTION_SAVE);

    const stamped = engine.stampSourceTurnSaveDc(
      createCloudEffect({ dc: 0 }),
      SAVE_DC,
    );

    assert.equal(stamped.recurringDamage.save.dc, SAVE_DC);
    assert.equal(engine.hasSourceTurnSaveDc(stamped), false);
  });

  it('the effect card names the save', () => {
    assert.ok(
      engine
        .describeActiveEffect(createCloudEffect())
        .includes('спасбросок (Телосложение, Сл 13), при успехе без урона'),
    );
  });
});

describe('source DC and payload of trigger-only effects', () => {
  /** Срабатывание «урон снимает эффект» со спасброском Сл источника */
  const WAKE_TRIGGER = {
    id: 'trigger_wake',
    event: 'damageTaken',
    save: { ability: 'wisdom', dc: 0 },
    actions: [{ type: 'removeSelf', on: 'saved' }],
  };

  it('dC 0 of a trigger save takes the source DC on application', () => {
    const effect = createEffect('dominated', { triggers: [WAKE_TRIGGER] });

    assert.equal(engine.hasSourceTurnSaveDc(effect), true);

    const stamped = engine.stampSourceTurnSaveDc(effect, SAVE_DC);

    assert.equal(stamped.triggers[0].save.dc, SAVE_DC);
    assert.equal(engine.hasSourceTurnSaveDc(stamped), false);
  });

  it('an effect with only triggers or a tag stays on the target', () => {
    assert.equal(
      engine.hasLastingEffectPayload(
        createEffect('asleep', { triggers: [WAKE_TRIGGER] }),
      ),
      true,
    );

    assert.equal(
      engine.hasLastingEffectPayload(createEffect('mark', { tag: 'marked' })),
      true,
    );

    assert.equal(engine.hasLastingEffectPayload(createEffect('empty')), false);
  });

  it('a copy left without entry triggers is not applied', () => {
    const entity = createActor();

    const effect = createEffect('entry-only', {
      triggers: [
        {
          id: 'trigger_copy',
          event: 'enter',
          actions: [{ type: 'applySelf' }],
        },
      ],
    });

    const result = engine.applyTriggerEffectActions(
      entity,
      {
        effect,
        trigger: effect.triggers[0],
        ambient: false,
        instance: false,
        scope: effect.id,
      },
      false,
    );

    assert.equal(result.applied, false);
    assert.deepEqual(entity.activeEffects, []);
  });
});
