import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const { applyGrantRemovalSelection, collectGrantRemovalOptions } =
  await loadEngineBundle(`
    export {
      applyGrantRemovalSelection,
      collectGrantRemovalOptions,
    } from './src/client/ui/actor/removal/grantRemovalPlan.ts';
  `);

/** Заклинание, выданное умением колдуна: откат класса его снимает. */
const hex = {
  id: 'spell-hex',
  name: 'Сглаз',
  grantedByFeature: 'Магия договора',
  classKeys: ['warlock'],
};

/** Заклинание, набранное игроком из списка колдуна. */
const eldritchBlast = {
  id: 'spell-blast',
  name: 'Мистический заряд',
  classKeys: ['warlock'],
};

/** Заклинание, доступное и колдуну, и остающемуся волшебнику. */
const mageHand = {
  id: 'spell-hand',
  name: 'Волшебная рука',
  classKeys: ['warlock', 'wizard'],
};

/** Заклинание, выданное чертой: к снимаемому классу не относится. */
const featSpell = {
  id: 'spell-feat',
  name: 'Туманный шаг',
  grantedByFeature: 'Тронутый феями',
  classKeys: ['warlock'],
};

const warlockDagger = {
  id: 'item-dagger',
  name: 'Кинжал',
  grantedBy: { kind: 'class', key: 'warlock' },
};

const soldierSpear = {
  id: 'item-spear',
  name: 'Копьё',
  grantedBy: { kind: 'background', key: 'soldier' },
};

const foundSword = { id: 'item-sword', name: 'Найденный меч' };

const actor = {
  spells: [hex, eldritchBlast, mageHand, featSpell],
  equipment: [warlockDagger, soldierSpear, foundSword],
};

/** Лист после отката колдуна: выданное им заклинание ушло. */
const spellsAfterRollback = [eldritchBlast, mageHand, featSpell];

const warlock = { kind: 'class', key: 'warlock' };

it('удаление класса предлагает его заклинания и стартовые предметы', () => {
  const options = collectGrantRemovalOptions(
    actor,
    warlock,
    spellsAfterRollback,
    ['wizard'],
  );

  assert.deepEqual(
    options.map((option) => [option.group, option.entityId]),
    [
      ['grantedSpell', 'spell-hex'],
      ['classSpell', 'spell-blast'],
      ['item', 'item-dagger'],
    ],
  );
});

it('удаление предыстории предлагает только её предметы', () => {
  const options = collectGrantRemovalOptions(
    actor,
    { kind: 'background', key: 'soldier' },
    actor.spells,
    ['warlock'],
  );

  assert.deepEqual(
    options.map((option) => option.id),
    ['item:item-spear'],
  );
});

it('у вида предметов нет: спрашивать не о чем', () => {
  const options = collectGrantRemovalOptions(
    actor,
    { kind: 'species', key: 'elf' },
    actor.spells,
    ['warlock'],
  );

  assert.deepEqual(options, []);
});

it('отмеченное снимается, неотмеченное остаётся на листе', () => {
  const options = collectGrantRemovalOptions(
    actor,
    warlock,
    spellsAfterRollback,
    [],
  );

  const result = applyGrantRemovalSelection(
    actor.spells,
    { spells: spellsAfterRollback, equipment: actor.equipment },
    options,
    new Set(['classSpell:spell-blast']),
  );

  // Выданное заклинание не отмечено — возвращается; набранное отмечено — уходит
  assert.deepEqual(
    result.spells.map((spell) => spell.id),
    ['spell-hand', 'spell-feat', 'spell-hex'],
  );

  // Кинжал не отмечен — остаётся
  assert.deepEqual(
    result.equipment.map((item) => item.id),
    ['item-dagger', 'item-spear', 'item-sword'],
  );
});

it('с полным выбором уходит всё предложенное и ничего сверх него', () => {
  const options = collectGrantRemovalOptions(
    actor,
    warlock,
    spellsAfterRollback,
    ['wizard'],
  );

  const result = applyGrantRemovalSelection(
    actor.spells,
    { spells: spellsAfterRollback, equipment: actor.equipment },
    options,
    new Set(options.map((option) => option.id)),
  );

  assert.deepEqual(
    result.spells.map((spell) => spell.id),
    ['spell-hand', 'spell-feat'],
  );

  assert.deepEqual(
    result.equipment.map((item) => item.id),
    ['item-spear', 'item-sword'],
  );
});
