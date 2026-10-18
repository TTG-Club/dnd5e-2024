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
function flagsWithArmorProficiencies(armor, armorItem = leatherArmor) {
  const actor = structuredClone(engine.DEFAULT_ACTOR);

  actor.system.proficiencies.armor = armor;
  actor.equipment = [armorItem];

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

/** Кожаный доспех из компендиума с базовым типом, которого нет в справочнике. */
const compendiumLeatherArmor = { ...leatherArmor, baseType: 'leather-armor' };

it('все доспехи категории в списке снимают штраф с доспеха из компендиума', () => {
  const flags = flagsWithArmorProficiencies(
    ['padded', 'leather', 'studded-leather'],
    compendiumLeatherArmor,
  );

  assert.equal(flags.has('abilityCheck.disadvantage.dexterity'), false);
  assert.equal(flags.has('attack.disadvantage'), false);
});

it('часть доспехов категории не даёт владения доспехом из компендиума', () => {
  const flags = flagsWithArmorProficiencies(
    ['padded', 'leather'],
    compendiumLeatherArmor,
  );

  assert.equal(flags.has('abilityCheck.disadvantage.dexterity'), true);
});

it('доспех без категории и известного типа не штрафуется', () => {
  const flags = flagsWithArmorProficiencies([], {
    ...leatherArmor,
    equipmentCategory: undefined,
    baseType: 'homebrew',
  });

  assert.equal(flags.has('abilityCheck.disadvantage.dexterity'), false);
});
