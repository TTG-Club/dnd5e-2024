import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(`
  export { collectClassOptionGrants } from './src/engine/classFeatureOptions.ts';
  export { applyFeatDataProficiencies } from './src/engine/featDataApply.ts';
  export {
    filterKnownProficiencyKeys,
    isProficiencyCategorySelected,
    isProficiencyItemSelected,
    toggleProficiencyCategory,
    toggleProficiencyItem,
  } from './src/client/ui/actor/utils/proficiencySelection.ts';
`);

const MARTIAL_WEAPONS = [
  { key: 'longsword', category: 'martial' },
  { key: 'longbow', category: 'martial' },
];

const HEAVY_ARMOR = [
  { key: 'chain-mail', category: 'heavy' },
  { key: 'plate', category: 'heavy' },
];

const DIVINE_ORDER = {
  key: 'divine-order',
  choices: [
    {
      key: 'protector',
      name: 'Защитник',
      description: '',
      featData: {
        type: 'feat',
        weaponProficiencies: ['martial'],
        armorProficiencies: ['heavy'],
      },
    },
    {
      key: 'thaumaturge',
      name: 'Чудотворец',
      description: '',
    },
  ],
};

function emptyProficiencies() {
  return {
    armor: [],
    weapons: [],
    weaponMasteries: [],
    tools: [],
    languages: [],
    savingThrows: [],
    skills: {},
  };
}

describe('владения категориями снаряжения', () => {
  it('«Божественный порядок: Защитник» виден как владение воинским оружием и тяжёлыми доспехами', () => {
    const [protector] = engine.collectClassOptionGrants(DIVINE_ORDER, [
      'protector',
    ]);

    const proficiencies = emptyProficiencies();

    engine.applyFeatDataProficiencies(proficiencies, protector.featData);

    const weapons = new Set(proficiencies.weapons);
    const armor = new Set(proficiencies.armor);

    assert.equal(
      engine.isProficiencyCategorySelected(weapons, 'martial', MARTIAL_WEAPONS),
      true,
    );

    assert.equal(
      engine.isProficiencyItemSelected(weapons, MARTIAL_WEAPONS[0]),
      true,
    );

    assert.equal(
      engine.isProficiencyCategorySelected(armor, 'heavy', HEAVY_ARMOR),
      true,
    );

    assert.equal(engine.isProficiencyItemSelected(armor, HEAVY_ARMOR[1]), true);
  });

  it('владение всеми конкретными видами тоже считается владением категорией', () => {
    const selected = new Set(MARTIAL_WEAPONS.map((weapon) => weapon.key));

    assert.equal(
      engine.isProficiencyCategorySelected(
        selected,
        'martial',
        MARTIAL_WEAPONS,
      ),
      true,
    );
  });

  it('снятие одного оружия из категории сохраняет остальные виды и соседние дары', () => {
    const selected = new Set(['martial', 'heavy']);

    const next = engine.toggleProficiencyItem(
      selected,
      MARTIAL_WEAPONS[0],
      MARTIAL_WEAPONS,
    );

    assert.deepEqual([...next].sort(), ['heavy', 'longbow']);
    assert.deepEqual([...selected].sort(), ['heavy', 'martial']);

    assert.equal(
      engine.isProficiencyItemSelected(next, MARTIAL_WEAPONS[0]),
      false,
    );

    assert.equal(
      engine.isProficiencyItemSelected(next, MARTIAL_WEAPONS[1]),
      true,
    );
  });

  it('снятие всей категории удаляет и её ключ, и конкретные виды, не задевая доспехи', () => {
    const next = engine.toggleProficiencyCategory(
      new Set(['martial', 'longbow', 'heavy']),
      'martial',
      MARTIAL_WEAPONS,
    );

    assert.deepEqual([...next], ['heavy']);
  });

  it('выбор всей категории вручную сохраняет прежний формат конкретных ключей', () => {
    const next = engine.toggleProficiencyCategory(
      new Set(['heavy']),
      'martial',
      MARTIAL_WEAPONS,
    );

    assert.deepEqual([...next].sort(), ['heavy', 'longbow', 'longsword']);
    assert.equal(next.has('martial'), false);
  });

  it('конкретный вид можно вернуть после частичного снятия владения категорией', () => {
    const withoutLongsword = engine.toggleProficiencyItem(
      new Set(['martial']),
      MARTIAL_WEAPONS[0],
      MARTIAL_WEAPONS,
    );

    const restored = engine.toggleProficiencyItem(
      withoutLongsword,
      MARTIAL_WEAPONS[0],
      MARTIAL_WEAPONS,
    );

    assert.equal(
      engine.isProficiencyCategorySelected(
        restored,
        'martial',
        MARTIAL_WEAPONS,
      ),
      true,
    );
  });

  it('фильтр редактора сохраняет категории из даров и отсеивает только неизвестные ключи', () => {
    const filtered = engine.filterKnownProficiencyKeys(
      ['martial', 'longsword', 'Длинный меч'],
      MARTIAL_WEAPONS,
      ['simple', 'martial'],
    );

    assert.deepEqual(filtered, ['martial', 'longsword']);
  });
});
