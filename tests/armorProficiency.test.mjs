import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/** Надетый кожаный доспех — лёгкий, помехи на Скрытность у него нет. */
const leatherArmor = {
  id: 'leather',
  name: 'Кожаный доспех',
  type: 'equipment',
  equipmentCategory: 'light',
  baseType: 'leather',
  baseArmorAC: 11,
  equipped: true,
  quantity: 1,
};

/** Флаги персонажа в кожаном доспехе при заданном списке владений. */
function flagsWithArmorProficiencies(armor) {
  const actor = structuredClone(engine.DEFAULT_ACTOR);

  actor.system.proficiencies.armor = armor;
  actor.equipment = [leatherArmor];

  return engine.resolveActorStats(actor).activeFlags;
}

it('владение категорией от черты снимает штраф за доспех', () => {
  const flags = flagsWithArmorProficiencies(['light', 'shield']);

  assert.equal(flags.has('abilityCheck.disadvantage.dexterity'), false);
  assert.equal(flags.has('attack.disadvantage'), false);
});

it('владение конкретным доспехом от мастера класса снимает штраф', () => {
  const flags = flagsWithArmorProficiencies(['padded', 'leather']);

  assert.equal(flags.has('abilityCheck.disadvantage.dexterity'), false);
});

it('без владения доспехом штраф остаётся', () => {
  const flags = flagsWithArmorProficiencies(['medium']);

  assert.equal(flags.has('abilityCheck.disadvantage.dexterity'), true);
  assert.equal(flags.has('attack.disadvantage'), true);
});
