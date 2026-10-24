import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/** Надетая кольчуга: тяжёлый доспех, КД 16 без Ловкости. */
const chainMail = {
  id: 'chain-mail',
  name: 'Кольчуга',
  type: 'equipment',
  equipmentCategory: 'heavy',
  baseType: 'chain-mail',
  baseArmorAC: 16,
  maxDexBonus: 0,
  equipped: true,
  quantity: 1,
};

/** Надетая кольчужная рубаха: средний доспех, Ловкость до +2. */
const chainShirt = {
  id: 'chain-shirt',
  name: 'Кольчужная рубаха',
  type: 'equipment',
  equipmentCategory: 'medium',
  baseType: 'chain-shirt',
  baseArmorAC: 13,
  maxDexBonus: 2,
  equipped: true,
  quantity: 1,
};

/** КД персонажа с заданной Ловкостью во владеемом доспехе. */
function armorClassWith(armorItem, dexterity) {
  const actor = structuredClone(engine.DEFAULT_ACTOR);

  actor.system.abilities.dexterity = dexterity;
  actor.system.proficiencies.armor = ['light', 'medium', 'heavy'];
  actor.equipment = [armorItem];

  return engine.resolveActorStats(actor).armorClass;
}

it('тяжёлый доспех не берёт штраф отрицательной Ловкости', () => {
  assert.equal(armorClassWith(chainMail, 6), 16);
});

it('тяжёлый доспех не берёт и бонус Ловкости', () => {
  assert.equal(armorClassWith(chainMail, 18), 16);
});

it('тяжёлый доспех без поля предела всё равно статичен', () => {
  const { maxDexBonus: _maxDexBonus, ...withoutCap } = chainMail;

  assert.equal(armorClassWith(withoutCap, 6), 16);
});

it('средний доспех учитывает отрицательную Ловкость и режет положительную', () => {
  assert.equal(armorClassWith(chainShirt, 6), 11);
  assert.equal(armorClassWith(chainShirt, 18), 15);
});
