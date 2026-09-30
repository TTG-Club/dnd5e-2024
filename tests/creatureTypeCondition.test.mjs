import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Условие по типу существа списком и «не из списка»
 * (`creatureTypeCondition.ts`): разбор, запись, подпись и работа в
 * модификаторах, броске, защите и срабатываниях.
 */

describe('условие по типу существа: разбор', () => {
  it('список и отрицание разбираются и пишутся обратно', () => {
    const parsed = engine.parseCreatureTypeCondition(
      'target.creatureType !== "undead, fiend"',
      'target.creatureType',
    );

    assert.deepEqual(parsed, { types: ['undead', 'fiend'], negate: true });

    assert.equal(
      engine.writeCreatureTypeCondition('target.creatureType', parsed),
      'target.creatureType !== "undead, fiend"',
    );

    assert.deepEqual(
      engine.parseCreatureTypeCondition(
        'self.creatureType === "undead"',
        'self.creatureType',
      ),
      { types: ['undead'], negate: false },
      'одиночный тип — список из одного',
    );

    assert.equal(
      engine.parseCreatureTypeCondition(
        'target.creatureType === "undead, dragonkin"',
        'target.creatureType',
      ),
      undefined,
      'незнакомый тип — условие не понято целиком',
    );
  });

  it('тип без данных не отвечает ни «да», ни «нет»', () => {
    const negated = { types: ['undead'], negate: true };

    assert.equal(engine.creatureTypeConditionHolds(negated, 'fiend'), true);
    assert.equal(engine.creatureTypeConditionHolds(negated, 'undead'), false);
    assert.equal(engine.creatureTypeConditionHolds(negated, undefined), false);
  });

  it('подпись называет типы словами', () => {
    assert.equal(
      engine.describeEffectChangeCondition(
        'target.creatureType !== "undead, fiend"',
      ),
      'Цель — не Нежить и не Исчадие',
    );
  });
});

describe('условие по типу существа: где работает', () => {
  /** «Избранные враги»: +2 к урону против нежити и исчадий */
  const favored = createEffect('Избранные враги', {
    changes: [
      {
        key: 'damage.all',
        mode: 'add',
        value: '1d4',
        priority: 20,
        condition: 'target.creatureType === "undead, fiend"',
      },
    ],
  });

  it('бонус урона по цели из списка; без единой цели — ветка на тип', () => {
    const roll = (creatureType) =>
      engine.collectBonusDamageFormulas([favored], 'damage.melee', {
        hasAdvantage: false,
        hasDisadvantage: false,
        target: { currentHp: 10, maxHp: 10, creatureType },
      });

    assert.equal(roll('fiend').length, 1);
    assert.equal(roll('beast').length, 0);

    const deferred = engine.collectBonusDamageFormulas(
      [favored],
      'damage.melee',
      {
        hasAdvantage: false,
        hasDisadvantage: false,
      },
    );

    assert.deepEqual(
      deferred.map((formula) => formula.conditionTypeGate),
      ['undead', 'fiend'],
    );
  });

  it('модификатор носителя «не из списка» считается на листе', () => {
    const effect = createEffect('Не для конструктов', {
      changes: [
        {
          key: 'armorClass',
          mode: 'add',
          value: '2',
          priority: 20,
          condition: 'self.creatureType !== "construct, undead"',
        },
      ],
    });

    const acOf = (type) => {
      const creature = createCreature({ activeEffects: [effect] });
      const bare = createCreature();

      creature.system.type = type;
      bare.system.type = type;

      return (
        engine.resolveActorStats(creature).armorClass
        - engine.resolveActorStats(bare).armorClass
      );
    };

    assert.equal(acOf('beast'), 2);
    assert.equal(acOf('undead'), 0);
  });

  it('срабатывание: другая сторона не из списка', () => {
    const part = engine.parseTriggerConditionPart(
      'target.creatureType !== "undead, fiend"',
    );

    assert.deepEqual(part, {
      kind: 'otherCreatureTypeNot',
      value: 'undead, fiend',
    });

    const holder = createActor();
    const fiend = createCreature({ id: 'creature_fiend' });
    const wolf = createCreature({ id: 'creature_wolf' });

    fiend.system.type = 'fiend';
    wolf.system.type = 'beast';

    const trigger = { condition: 'target.creatureType !== "undead, fiend"' };

    assert.equal(
      engine.isTriggerConditionMet(holder, trigger, { other: fiend }),
      false,
    );

    assert.equal(
      engine.isTriggerConditionMet(holder, trigger, { other: wolf }),
      true,
    );

    assert.equal(
      engine.describeTriggerCondition(trigger.condition),
      'другая сторона — не Нежить и не Исчадие',
    );
  });
});
