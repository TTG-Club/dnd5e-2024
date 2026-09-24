import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(
  `export * from './src/engine/spellSlotTable.ts';`,
);

const wizard = { classKey: 'wizard', level: 3, casterType: 'full' };
const fighter = { classKey: 'fighter', level: 5 };

/** Числа листа: Мудрость +3, бонус мастерства +2. */
const context = {
  abilityMods: {
    strength: 0,
    dexterity: 0,
    constitution: 0,
    intelligence: 0,
    wisdom: 3,
    charisma: 0,
  },
  proficiencyBonus: 2,
};

/**
 * Свой бонус числом.
 *
 * @param {number} value - число бонуса
 * @returns {object} бонус
 */
function flat(value) {
  return {
    id: `flat-${value}`,
    kind: 'flat',
    ability: 'strength',
    value,
    label: '',
  };
}

it('без бонусов ячейки идут только от класса', () => {
  const slots = engine.computeActorSpellSlots(
    { system: { classes: [wizard] } },
    context,
  );

  assert.deepEqual(slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
});

it('бонус ложится поверх таблицы и переживает рост уровня', () => {
  const spellSlotSettings = { levels: [[flat(1)], [], [flat(1)]] };

  assert.deepEqual(
    engine.computeActorSpellSlots(
      { system: { classes: [wizard], spellSlotSettings } },
      context,
    ),
    [5, 2, 1, 0, 0, 0, 0, 0, 0],
  );

  assert.deepEqual(
    engine.computeActorSpellSlots(
      { system: { classes: [{ ...wizard, level: 5 }], spellSlotSettings } },
      context,
    ),
    [5, 3, 3, 0, 0, 0, 0, 0, 0],
  );
});

it('бонус от характеристики и мастерства считается от чисел листа', () => {
  const spellSlotSettings = {
    levels: [
      [{ ...flat(0), kind: 'ability', ability: 'wisdom' }],
      [{ ...flat(0), kind: 'proficiency' }],
    ],
  };

  assert.deepEqual(
    engine.computeActorSpellSlots(
      { system: { classes: [fighter], spellSlotSettings } },
      context,
    ),
    [3, 2, 0, 0, 0, 0, 0, 0, 0],
  );
});

it('без переданных чисел бонусы считаются по записи листа', () => {
  const actor = {
    system: {
      classes: [fighter],
      abilities: { wisdom: 16 },
      spellSlotSettings: {
        levels: [[{ ...flat(0), kind: 'ability', ability: 'wisdom' }]],
      },
    },
  };

  assert.deepEqual(
    engine.computeActorSpellSlots(actor),
    [3, 0, 0, 0, 0, 0, 0, 0, 0],
  );
});

it('воин получает свои ячейки и тратит их при касте', () => {
  const actor = {
    system: {
      classes: [fighter],
      spellSlotSettings: { levels: [[flat(2)]] },
      spellSlotsUsed: [1],
    },
  };

  assert.equal(engine.hasAvailableSpellSlot(actor, 1, false, context), true);
  assert.equal(engine.getMaxSpellSlotLevel(actor, context), 1);
  assert.deepEqual(engine.getAvailableSpellLevels(actor, 1, 9, context), [1]);

  actor.system.spellSlotsUsed = [2];
  assert.equal(engine.hasAvailableSpellSlot(actor, 1, false, context), false);
});

it('отрицательный бонус не опускает круг ниже нуля', () => {
  assert.deepEqual(
    engine.computeActorSpellSlots(
      {
        system: {
          classes: [wizard],
          spellSlotSettings: { levels: [[flat(-9)], [flat(-1)]] },
        },
      },
      context,
    ),
    [0, 1, 0, 0, 0, 0, 0, 0, 0],
  );
});

it('разбор отбрасывает мусор из записи и держит девять кругов', () => {
  const parsed = engine.parseSpellSlotSettings({
    levels: [[flat(2), { id: 'broken' }], 'x'],
  });

  assert.equal(parsed.levels.length, 9);
  assert.deepEqual(parsed.levels[0], [flat(2)]);
  assert.deepEqual(parsed.levels[1], []);
  assert.equal(engine.parseSpellSlotSettings(undefined).levels.length, 9);
});
