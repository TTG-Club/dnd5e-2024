import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Фиксация поведения срабатываний эффекта перед переводом на общий диспетчер:
 * урон и лечение каждый ход, повторный спасбросок, отложенные спасброски, исходы
 * «при успехе» и строки чата. Эти числа и строки обязаны пережить рефакторинг.
 */

const engine = await loadEngineBundle(`export * from './src/engine/index.ts';`);

/** Сл, которую проходит любой бросок */
const TRIVIAL_DC = 1;

/** Сл, которую не пройти */
const IMPOSSIBLE_DC = 99;

/** Хиты героя перед срабатыванием */
const START_HP = 10;

/** Максимум хитов героя */
const MAX_HP = 20;

/** Доля генератора, дающая 12 на d20 */
const ROLL_TWELVE = 0.55;

/**
 * Эффект в форме редактора.
 *
 * @param {string} id - идентификатор и имя
 * @param {object} overrides - поля
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
 * Раненый герой.
 *
 * @param {object} overrides - поля
 * @returns {object} персонаж
 */
function createHero(overrides = {}) {
  return {
    ...structuredClone(engine.DEFAULT_ACTOR),
    id: 'actor_hero',
    name: 'Гримли',
    ownerIds: ['player'],
    autoSaves: true,
    activeEffects: [],
    ...overrides,
    system: {
      ...structuredClone(engine.DEFAULT_ACTOR.system),
      hitPoints: { current: START_HP, max: MAX_HP, temp: 0 },
    },
  };
}

/**
 * Выполняет действие с подменённым генератором.
 *
 * @param {number} value - значение `Math.random`
 * @param {Function} action - что выполнить
 * @returns {*} результат
 */
function withRandom(value, action) {
  const originalRandom = Math.random;

  Math.random = () => value;

  try {
    return action();
  } finally {
    Math.random = originalRandom;
  }
}

/**
 * Уже известный исход спасброска.
 *
 * @param {boolean} passed - пройден ли
 * @returns {object} исход
 */
function saveOutcome(passed) {
  const total = passed ? 20 : 1;

  return {
    effectName: 'venom',
    ability: 'constitution',
    dc: 13,
    roll: total,
    total,
    passed,
  };
}

describe('фиксация: срабатывания на ходу', () => {
  it('урон, лечение и снимающий спасбросок одного хода — хиты, итоги и строка чата', () => {
    const hero = createHero({
      activeEffects: [
        createEffect('burn', {
          recurringDamage: {
            damageParts: [
              { formula: '5', type: 'fire' },
              { formula: '3@heal' },
            ],
            timing: 'startOfTurn',
          },
        }),
        createEffect('hold', {
          flags: ['attack.disadvantage'],
          recurringSave: {
            ability: 'wisdom',
            dc: TRIVIAL_DC,
            timing: 'startOfTurn',
          },
        }),
      ],
    });

    const result = withRandom(ROLL_TWELVE, () =>
      engine.processTurnEffects(hero, 'startOfTurn'),
    );

    assert.equal(engine.resolveEntityCurrentHp(hero), START_HP - 5 + 3);
    assert.equal(result.damageTotal, 5);

    assert.deepEqual(result.healingOutcomes, [
      { effectName: 'burn', healed: 3, tempHp: 0, values: [] },
    ]);

    assert.deepEqual(
      hero.activeEffects.map((effect) => effect.id),
      ['burn'],
      'пройденный повторный спасбросок снял эффект',
    );

    assert.equal(
      engine.formatTurnEffectsMessage(hero.name, 'startOfTurn', result),
      'Эффекты (начало хода): Гримли\n'
        + 'burn: −5 HP (Огненный урон)\n'
        + 'burn: +3 HP\n'
        + 'hold: спас Мудрость [12] = 12 vs 1 — ✓ снят',
    );
  });

  it('лечение тикает, пока спасбросок против урона отложен', () => {
    const hero = createHero({
      autoSaves: false,
      activeEffects: [
        createEffect('cloud', {
          recurringDamage: {
            damageParts: [
              { formula: '5', type: 'poison' },
              { formula: '3@heal' },
            ],
            timing: 'startOfTurn',
            save: { ability: 'constitution', dc: 13, onSuccess: 'negate' },
          },
        }),
      ],
    });

    const result = engine.processTurnEffects(hero, 'startOfTurn', {
      deferRecurringDamageSave: () => true,
    });

    assert.equal(engine.resolveEntityCurrentHp(hero), START_HP + 3);
    assert.equal(result.changed, true);
    assert.equal(result.damageTotal, 0);
    assert.equal(result.healingOutcomes.length, 1);
    assert.equal(result.deferredDamageSaveEffects.length, 1);
  });

  it('три отложенных списка: снимающий спасбросок, урон своего эффекта, урон ауры', () => {
    const save = { ability: 'constitution', dc: 13, onSuccess: 'negate' };

    const hero = createHero({
      autoSaves: false,
      activeEffects: [
        createEffect('hold', {
          flags: ['attack.disadvantage'],
          recurringSave: { ability: 'wisdom', dc: 13, timing: 'endOfTurn' },
        }),
        createEffect('burn', {
          recurringDamage: {
            damageParts: [{ formula: '5', type: 'fire' }],
            timing: 'endOfTurn',
            save,
          },
        }),
      ],
    });

    const aura = createEffect('guardians', {
      aura: {
        radius: 15,
        target: 'enemies',
        applyToSelf: false,
        visible: true,
      },
      recurringDamage: {
        damageParts: [{ formula: '7', type: 'radiant' }],
        timing: 'endOfTurn',
        save,
      },
    });

    const result = engine.processTurnEffects(hero, 'endOfTurn', {
      deferRecurringSave: () => true,
      deferRecurringDamageSave: () => true,
      ambientEffects: [aura],
    });

    assert.deepEqual(
      result.deferredSaveEffects.map((effect) => effect.id),
      ['hold'],
    );

    assert.deepEqual(
      result.deferredDamageSaveEffects.map((effect) => effect.id),
      ['burn'],
    );

    assert.deepEqual(
      result.deferredAmbientDamageSaveEffects.map((effect) => effect.id),
      ['guardians'],
    );

    assert.equal(engine.resolveEntityCurrentHp(hero), START_HP);
  });
});

describe('фиксация: расход эффекта на броске атаки', () => {
  it('снимаются только эффекты своей роли, одним снимком; без них — ничего', async () => {
    const emitted = [];
    const storeUpdates = [];
    const world = new Map();

    const settle = await loadHandler(
      'src/client/composables/useEffectTriggerEvents.ts',
      'settleAttackRollSide',
      {
        useWorldEntities: () => ({
          findCurrentWorldEntity: (id) => world.get(id),
        }),
        isDndSceneEntity: engine.isDndSceneEntity,
        runAttackRollTriggers: engine.runAttackRollTriggers,
        isEntityInCombat: () => false,
        isActorEntity: (entity) => entity.entityType === 'actor',
        isCreatureEntity: (entity) => entity.entityType === 'creature',
        useWorldStore: () => ({
          connectionState: { currentWorldId: 'world' },
          updateActor: (_worldId, id, patch) => storeUpdates.push([id, patch]),
          updateCreature: (_worldId, id, patch) =>
            storeUpdates.push([id, patch]),
        }),
        useChatStore: () => ({ getSocket: () => ({}) }),
        emitEntityCombatState: (_socket, entity) => emitted.push(entity),
        JSON,
      },
    );

    const sap = createEffect('sap', {
      flags: ['attack.disadvantage'],
      consumeOn: 'carrierAttack',
    });

    const vex = createEffect('vex', {
      flags: ['attacksAgainst.advantage'],
      consumeOn: 'attackOnCarrier',
    });

    const hero = createHero({ activeEffects: [sap, vex] });

    world.set(hero.id, hero);
    settle(hero.id, 'attacker');

    assert.equal(emitted.length, 1);

    // Данные собраны в другом realm (VM) — сравниваются по содержимому
    assert.equal(
      JSON.stringify(emitted[0].activeEffects.map((effect) => effect.id)),
      JSON.stringify(['vex']),
    );

    assert.equal(
      JSON.stringify(storeUpdates),
      JSON.stringify([[hero.id, { activeEffects: [vex] }]]),
    );

    assert.equal(
      hero.activeEffects.length,
      2,
      'сущность мира меняет стор, не бросок',
    );

    world.set(hero.id, createHero({ activeEffects: [vex] }));
    settle(hero.id, 'attacker');
    assert.equal(emitted.length, 1, 'без эффектов роли ничего не шлёт');

    settle(hero.id, 'target');
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1].activeEffects.length, 0);
  });
});

describe('фиксация: разовое срабатывание при входе и попадании', () => {
  /** Эффект с двумя частями урона по 3 — видно округление половины */
  const venom = createEffect('venom', {
    flags: ['attack.disadvantage'],
    applySave: { ability: 'constitution', dc: 13, onSuccess: 'negate' },
    damageParts: [
      { formula: '3', type: 'fire' },
      { formula: '3', type: 'fire' },
    ],
  });

  it('пять исходов «при успехе»: урон и статус при провале и успехе', () => {
    const expected = {
      nothing: [
        [6, true],
        [0, false],
      ],
      halfDamage: [
        [6, true],
        [3, false],
      ],
      halfDamageWithEffect: [
        [6, true],
        [3, true],
      ],
      effectWithoutDamage: [
        [6, true],
        [0, true],
      ],
      onlyOnSuccess: [
        [0, false],
        [6, true],
      ],
    };

    for (const [outcome, [failed, passed]] of Object.entries(expected)) {
      const effect = engine.writeEffectSuccessOutcome(venom, outcome);

      for (const [isPassed, [damage, status]] of [
        [false, failed],
        [true, passed],
      ]) {
        const hero = createHero();

        const result = engine.applyEntryEffect(
          hero,
          effect,
          saveOutcome(isPassed),
        );

        assert.equal(
          START_HP - engine.resolveEntityCurrentHp(hero),
          damage,
          `${outcome}, ${isPassed ? 'успех' : 'провал'}: урон`,
        );

        assert.equal(
          result.statusApplied,
          status,
          `${outcome}, ${isPassed ? 'успех' : 'провал'}: статус`,
        );
      }
    }
  });

  it('строка чата входа в зону', () => {
    const system = new engine.Dnd5eVttSystem();

    const wolf = {
      ...structuredClone(engine.DEFAULT_CREATURE),
      id: 'creature_wolf',
      name: 'Волк',
      activeEffects: [],
    };

    const zone = {
      id: 'zone_poison',
      name: 'Ядовитое облако',
      shape: 'polygon',
      points: [],
      color: '',
      opacity: 1,
      aboveTokens: false,
      blocksVision: false,
      blocksLight: false,
      createdBy: 'gm',
      effects: [
        createEffect('venom', {
          areaTrigger: 'enter',
          flags: ['attack.disadvantage'],
          applySave: {
            ability: 'constitution',
            dc: IMPOSSIBLE_DC,
            onSuccess: 'half',
          },
          damageParts: [{ formula: '4', type: 'poison' }],
        }),
      ],
    };

    const result = withRandom(0, () =>
      system.syncAreaEffects(wolf, new Set(), new Set([zone.id]), [zone]),
    );

    assert.equal(
      result.chatSummary,
      'Эффекты (область): Волк\n'
        + 'venom: −4 HP (Урон ядом)\n'
        + 'venom: спас Телосложение [1] = 1 vs 99 — ✗ провал',
    );
  });

  it('половина урона: движок и клиентский путь округляют сумму частей', async () => {
    const hero = createHero();

    engine.applyEntryEffect(
      hero,
      engine.writeEffectSuccessOutcome(venom, 'halfDamage'),
      saveOutcome(true),
    );

    assert.equal(START_HP - engine.resolveEntityCurrentHp(hero), 3);

    const rollClientEffectDamage = await loadHandler(
      'src/client/composables/useTargetEffectResolution.ts',
      'rollEffectDamage',
      {
        isDndSceneEntity: () => true,
        resolveActorStats: engine.resolveActorStats,
        rollEffectDamageParts: engine.rollEffectDamageParts,
        getPartKindLabel: () => '',
        diceRollerStore: {
          parseAndRoll: (formula) => ({ total: Number(formula), dice: [] }),
        },
      },
    );

    const clientRoll = rollClientEffectDamage(
      createHero(),
      venom.damageParts,
      0.5,
    );

    assert.equal(clientRoll.damage, 3);

    assert.equal(
      JSON.stringify(clientRoll.lines.map((line) => line.applied)),
      JSON.stringify([2, 1]),
      'строки чата складываются в итог',
    );
  });
});
