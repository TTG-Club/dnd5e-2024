import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  createZone,
  engine,
  MIN_ROLL,
  saveOutcome,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Фиксация поведения срабатываний эффекта перед переводом на общий диспетчер:
 * урон и лечение каждый ход, повторный спасбросок, отложенные спасброски, исходы
 * «при успехе» и строки чата. Эти числа и строки обязаны пережить рефакторинг.
 */

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
 * Раненый герой, спасброски которого бросаются сами.
 *
 * @param {object} overrides - поля персонажа
 * @returns {object} персонаж
 */
function woundedHero(overrides = {}) {
  return withHp(
    createActor,
    START_HP,
    { autoSaves: true, ...overrides },
    MAX_HP,
  );
}

describe('фиксация: срабатывания на ходу', () => {
  it('урон, лечение и снимающий спасбросок одного хода — хиты, итоги и строка чата', () => {
    const hero = woundedHero({
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

    const result = withRandom([ROLL_TWELVE], () =>
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
    const hero = woundedHero({
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

    const hero = woundedHero({
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
        findDndWorldEntity: (id) => world.get(id),
        isDndSceneEntity: engine.isDndSceneEntity,
        runAttackRollTriggers: engine.runAttackRollTriggers,
        isEntityInCombat: () => false,
        resolveActiveTurnActorId: () => null,
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

    const hero = woundedHero({ activeEffects: [sap, vex] });

    world.set(hero.id, hero);
    settle({ entityId: hero.id, role: 'attacker' }, 'normal');

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

    world.set(hero.id, woundedHero({ activeEffects: [vex] }));
    settle({ entityId: hero.id, role: 'attacker' }, 'normal');
    assert.equal(emitted.length, 1, 'без эффектов роли ничего не шлёт');

    settle({ entityId: hero.id, role: 'target' }, 'normal');
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

  /** Известный исход спасброска против яда */
  const venomSave = { effectName: venom.name, dc: venom.applySave.dc };

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
        const hero = woundedHero();

        const result = engine.applyEntryEffect(
          hero,
          effect,
          saveOutcome(isPassed, venomSave),
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

    const wolf = createCreature();

    const zone = createZone(
      'zone_poison',
      [
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
      { name: 'Ядовитое облако' },
    );

    const result = withRandom([MIN_ROLL], () =>
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
    const hero = woundedHero();

    engine.applyEntryEffect(
      hero,
      engine.writeEffectSuccessOutcome(venom, 'halfDamage'),
      saveOutcome(true, venomSave),
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
      woundedHero(),
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
