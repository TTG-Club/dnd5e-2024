import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createZone,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Условия срабатываний: словарь с данными события, отрицания явными частями,
 * незнакомая часть не выполняется, невыполненное условие не тратит лимит.
 */

/** Урон огнём без крита */
const FIRE_DAMAGE = { amount: 7, types: ['fire'], critical: false };

/** Урон излучением критом */
const RADIANT_CRIT = { amount: 12, types: ['radiant'], critical: true };

/**
 * Срабатывание с условием.
 *
 * @param condition - условие
 * @returns срабатывание
 */
function withCondition(condition) {
  return { condition };
}

describe('словарь условий срабатываний', () => {
  it('разбор и сборка частей: значения из словаря, незнакомое остаётся строкой', () => {
    const condition =
      'damage.type === "fire" && damage.isCritical === false && мутная строка';

    const parts = engine.readTriggerConditionParts(condition);

    assert.deepEqual(parts, [
      { kind: 'damageType', value: 'fire' },
      { kind: 'damageNotCritical' },
      'мутная строка',
    ]);

    assert.equal(engine.writeTriggerCondition(parts), condition);
    assert.equal(engine.writeTriggerCondition([]), undefined);

    assert.equal(
      engine.parseTriggerConditionPart('damage.type === "мана"'),
      null,
    );

    assert.deepEqual(engine.parseTriggerConditionPart('self.tag !== "огонь"'), {
      kind: 'selfTagNot',
      value: 'огонь',
    });

    assert.equal(
      engine.parseTriggerConditionPart('self.tag === "a b"'),
      null,
      'ключ отметки без пробелов и кавычек',
    );
  });

  it('части по событию: урон — только у событий урона, режим броска — у атаки', () => {
    const turnKinds = engine.listTriggerConditionKinds('turnStart');
    const damageKinds = engine.listTriggerConditionKinds('damageTaken');
    const attackKinds = engine.listTriggerConditionKinds('attackRoll');

    assert.equal(turnKinds.includes('damageType'), false);
    assert.equal(turnKinds.includes('selfBloodied'), true);
    assert.equal(damageKinds.includes('damageTypeNot'), true);
    assert.equal(damageKinds.includes('rollAdvantage'), false);
    assert.equal(attackKinds.includes('otherMarkedBySelf'), true);
  });
});

describe('выполнение условий', () => {
  it('урон: тип, «кроме типа», крит; без данных урона — не выполняется', () => {
    const zombie = createCreature();

    const unlessRadiantOrCrit = withCondition(
      'damage.type !== "radiant" && damage.isCritical === false',
    );

    assert.equal(
      engine.isTriggerConditionMet(zombie, unlessRadiantOrCrit, {
        damage: FIRE_DAMAGE,
      }),
      true,
    );

    assert.equal(
      engine.isTriggerConditionMet(zombie, unlessRadiantOrCrit, {
        damage: RADIANT_CRIT,
      }),
      false,
    );

    assert.equal(
      engine.isTriggerConditionMet(zombie, unlessRadiantOrCrit),
      false,
    );

    assert.equal(
      engine.isTriggerConditionMet(
        zombie,
        withCondition('damage.type === "fire"'),
        {
          damage: FIRE_DAMAGE,
        },
      ),
      true,
    );
  });

  it('носитель: окровавлен по хитам, тип существа; нет условия — выполняется', () => {
    const troll = createCreature();

    troll.system.hitPoints = { ...troll.system.hitPoints, current: 5, max: 40 };

    assert.equal(
      engine.isTriggerConditionMet(
        troll,
        withCondition('self.hp.value <= (self.hp.max / 2)'),
      ),
      true,
    );

    assert.equal(
      engine.isTriggerConditionMet(
        troll,
        withCondition('self.creatureType === "undead"'),
      ),
      false,
    );

    assert.equal(engine.isTriggerConditionMet(troll, {}), true);

    assert.equal(
      engine.isTriggerConditionMet(troll, withCondition('нечто')),
      false,
    );
  });

  it('атака: режим броска и другая сторона, помеченная носителем', () => {
    const ranger = createActor({ id: 'actor_ranger' });

    const prey = createCreature({
      activeEffects: [
        createEffect('Метка охотника', {
          flags: ['mark.bySource'],
          sourceActorId: ranger.id,
        }),
      ],
    });

    const markedWithAdvantage = withCondition(
      'target.markedBySelf && roll.hasAdvantage === true',
    );

    assert.equal(
      engine.isTriggerConditionMet(ranger, markedWithAdvantage, {
        other: prey,
        roll: { hasAdvantage: true, hasDisadvantage: false },
      }),
      true,
    );

    assert.equal(
      engine.isTriggerConditionMet(ranger, markedWithAdvantage, {
        other: createCreature(),
        roll: { hasAdvantage: true, hasDisadvantage: false },
      }),
      false,
    );
  });
});

describe('условие в срабатываниях', () => {
  it('ход: невыполненное условие не бьёт и не тратит «раз в ход»', () => {
    const burning = (condition) =>
      createEffect('burning', {
        triggers: [
          {
            id: 'trigger_burn',
            event: 'turnStart',
            condition,
            actions: [
              { type: 'damage', parts: [{ formula: '5', type: 'fire' }] },
            ],
            limit: { max: 1, per: 'turn' },
          },
        ],
      });

    const healthy = createCreature({
      activeEffects: [burning('self.hp.value <= (self.hp.max / 2)')],
    });

    healthy.system.hitPoints = {
      ...healthy.system.hitPoints,
      current: 40,
      max: 40,
    };

    assert.equal(
      engine.processTurnEffects(healthy, 'startOfTurn').damageTotal,
      0,
    );

    assert.equal(healthy.system.effectUsage, undefined);
  });

  it('вход в зону: условие по носителю', () => {
    const sanctum = createEffect('Святилище', {
      triggers: [
        {
          id: 'trigger_undead',
          event: 'enter',
          condition: 'self.creatureType === "undead"',
          actions: [
            { type: 'damage', parts: [{ formula: '6', type: 'radiant' }] },
          ],
        },
      ],
    });

    const zones = [createZone('ca_sanctum', [sanctum])];

    const enter = (entity) =>
      engine.syncActorAreaEffects(
        entity,
        new Set(),
        new Set(['ca_sanctum']),
        zones,
      );

    assert.equal(enter(createActor()).damageOutcomes.length, 0);

    const ghoul = createCreature();

    ghoul.system.type = 'undead';
    assert.equal(enter(ghoul).damageOutcomes.length, 1);
  });

  it('бросок атаки: срабатывает только по помеченной цели', () => {
    const ranger = createActor({ id: 'actor_ranger' });

    ranger.activeEffects = [
      createEffect('Сосредоточение', {
        triggers: [
          {
            id: 'trigger_focus',
            event: 'attackRoll',
            condition: 'target.markedBySelf',
            actions: [{ type: 'removeSelf' }],
          },
        ],
      }),
    ];

    engine.runAttackRollTriggers(ranger, 'attacker', {
      other: createCreature(),
    });

    assert.equal(ranger.activeEffects.length, 1);

    const prey = createCreature({
      activeEffects: [
        createEffect('Метка', {
          flags: ['mark.bySource'],
          sourceActorId: ranger.id,
        }),
      ],
    });

    engine.runAttackRollTriggers(ranger, 'attacker', { other: prey });
    assert.equal(ranger.activeEffects.length, 0);
  });
});
