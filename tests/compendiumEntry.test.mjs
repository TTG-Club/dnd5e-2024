import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Запись своего компендиума мира из сущности мира — обратное преобразование к
 * кнопке «Копировать» в компендиуме. Ошибка здесь тихая: запись сохранится, но
 * список раздела покажет её пустой строкой либо она не откроется.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
`);

/** Поля записи «Мастерской», общие для всех типов */
const WORLD_ITEM_BASE = {
  id: 'item_1',
  name: 'Огненный меч',
  nameEn: 'Flame Blade',
  description: '<p>Горит</p>',
  quantity: 1,
  weight: 3,
  cost: '50 зм',
  rarity: 'rare',
  equipped: true,
  isReadOnly: false,
  sourceKey: 'hb',
  srcSection: 'items',
  srcUrl: 'flame-blade-phb',
};

describe('запись «Мастерской» в запись компендиума', () => {
  it('оружие переносится как есть, без мировых полей', () => {
    const entry = engine.worldItemToCompendiumEntry('weapon', {
      ...WORLD_ITEM_BASE,
      type: 'weapon',
      damageParts: [{ formula: '1d8' }],
    });

    assert.deepEqual(entry, {
      name: 'Огненный меч',
      nameEn: 'Flame Blade',
      description: '<p>Горит</p>',
      quantity: 1,
      weight: 3,
      cost: '50 зм',
      rarity: 'rare',
      sourceKey: 'hb',
      type: 'weapon',
      damageParts: [{ formula: '1d8' }],
    });
  });

  it('запись другого типа разделу не подходит', () => {
    assert.equal(
      engine.worldItemToCompendiumEntry('equipment', {
        ...WORLD_ITEM_BASE,
        type: 'weapon',
      }),
      null,
    );
  });

  it('заклинание разворачивается из обёртки, название берётся у обёртки', () => {
    const entry = engine.worldItemToCompendiumEntry('spell', {
      ...WORLD_ITEM_BASE,
      name: 'Огненный шар (свой)',
      type: 'spell',
      spellData: {
        id: 'spell_old',
        name: 'Огненный шар',
        level: 3,
        school: 'evocation',
        classKeys: ['wizard'],
      },
    });

    assert.deepEqual(entry, {
      level: 3,
      school: 'evocation',
      classKeys: ['wizard'],
      type: 'spell',
      name: 'Огненный шар (свой)',
      nameEn: 'Flame Blade',
      description: '<p>Горит</p>',
      sourceKey: 'hb',
      source: undefined,
      isSRD: undefined,
    });
  });

  it('класс и вид сохраняют свой ключ определения', () => {
    const classEntry = engine.worldItemToCompendiumEntry('class', {
      ...WORLD_ITEM_BASE,
      type: 'class',
      classData: { key: 'witch-ab12', name: 'Ведьма', hitDie: 8 },
    });

    assert.equal(classEntry.key, 'witch-ab12');
    assert.equal(classEntry.type, 'class');
    assert.equal(classEntry.hitDie, 8);
    assert.equal('id' in classEntry, false);

    const speciesEntry = engine.worldItemToCompendiumEntry('species', {
      ...WORLD_ITEM_BASE,
      type: 'species',
      speciesData: { key: 'catfolk-cd34', name: 'Табакси' },
    });

    assert.equal(speciesEntry.key, 'catfolk-cd34');
    assert.equal(speciesEntry.type, 'species');
  });

  it('обёртка без вложенного определения разделу не подходит', () => {
    assert.equal(
      engine.worldItemToCompendiumEntry('spell', {
        ...WORLD_ITEM_BASE,
        type: 'spell',
      }),
      null,
    );
  });

  it('состояние мира записью компендиума не становится', () => {
    assert.equal(
      engine.worldItemToCompendiumEntry('condition', {
        ...WORLD_ITEM_BASE,
        type: 'condition',
      }),
      null,
    );
  });
});

describe('существо мира в запись компендиума', () => {
  it('переносит статблок, фишку, заклинания и снаряжение, а состояние мира оставляет', () => {
    const entry = engine.worldCreatureToCompendiumEntry({
      id: 'creature_1',
      entityType: 'creature',
      ownerId: 'user_1',
      ownerIds: ['user_1'],
      isPublic: true,
      autoSaves: true,
      activeEffects: [{ id: 'effect_1' }],
      name: 'Волк',
      nameEn: 'Wolf',
      description: 'Серый',
      token: { imageUrl: '/assets/wolf.webp' },
      system: { challengeRating: 0.25, type: 'beast' },
      spells: [{ id: 'spell_1', name: 'Вой', level: 0 }],
      equipment: [{ id: 'item_9', name: 'Ошейник', type: 'equipment' }],
    });

    assert.deepEqual(entry, {
      type: 'creature',
      name: 'Волк',
      nameEn: 'Wolf',
      description: 'Серый',
      header: undefined,
      token: { imageUrl: '/assets/wolf.webp' },
      system: { challengeRating: 0.25, type: 'beast' },
      spells: [{ id: 'spell_1', name: 'Вой', level: 0 }],
      equipment: [{ id: 'item_9', name: 'Ошейник', type: 'equipment' }],
    });
  });
});

describe('запись компендиума в предмет для формы правки', () => {
  it('оружие возвращается предметом с ключом записи вместо мирового id', () => {
    const item = engine.compendiumEntryToWorldItem('weapon', {
      id: 'flame-blade-compendium-pack',
      type: 'weapon',
      name: 'Огненный меч',
      description: '',
      quantity: 1,
      weight: 3,
      cost: '',
      rarity: 'rare',
      originId: 'item_1',
    });

    assert.equal(item.id, 'flame-blade-compendium-pack');
    assert.equal(item.equipped, false);
    assert.equal(item.isReadOnly, false);
    assert.equal(item.name, 'Огненный меч');
  });

  it('правка формой и обратно даёт ту же запись', () => {
    const entry = {
      type: 'weapon',
      name: 'Огненный меч',
      nameEn: 'Flame Blade',
      description: '<p>Горит</p>',
      quantity: 1,
      weight: 3,
      cost: '50 зм',
      rarity: 'rare',
      sourceKey: 'hb',
    };

    const item = engine.compendiumEntryToWorldItem('weapon', {
      ...entry,
      id: 'flame-blade-compendium-pack',
    });

    assert.deepEqual(engine.worldItemToCompendiumEntry('weapon', item), entry);
  });

  it('заклинание оборачивается в предмет с вложенным определением', () => {
    const item = engine.compendiumEntryToWorldItem('spell', {
      id: 'fireball-compendium-pack',
      type: 'spell',
      name: 'Огненный шар',
      description: 'Взрыв',
      level: 3,
      school: 'evocation',
      sourceKey: 'hb',
    });

    assert.equal(item.type, 'spell');
    assert.equal(item.id, 'fireball-compendium-pack');
    assert.equal(item.name, 'Огненный шар');
    assert.equal(item.spellData.level, 3);
    assert.equal(item.spellData.id, 'fireball-compendium-pack');
  });

  it('класс и вид оборачиваются, ключ определения остаётся', () => {
    const classItem = engine.compendiumEntryToWorldItem('class', {
      type: 'class',
      key: 'witch-ab12',
      name: 'Ведьма',
      hitDie: 8,
    });

    assert.equal(classItem.id, 'witch-ab12');
    assert.equal(classItem.classData.key, 'witch-ab12');

    const speciesItem = engine.compendiumEntryToWorldItem('species', {
      type: 'species',
      key: 'catfolk-cd34',
      name: 'Табакси',
      creatureType: 'humanoid',
    });

    assert.equal(speciesItem.speciesData.key, 'catfolk-cd34');
  });

  it('запись чужого типа и запись незнакомой формы не открываются', () => {
    assert.equal(
      engine.compendiumEntryToWorldItem('weapon', {
        id: 'x',
        type: 'equipment',
        name: 'Щит',
      }),
      null,
    );

    assert.equal(
      engine.compendiumEntryToWorldItem('spell', {
        type: 'spell',
        name: 'Без круга',
      }),
      null,
    );

    assert.equal(
      engine.compendiumEntryToWorldItem('class', {
        key: 'no-type',
        name: 'Без типа',
      }),
      null,
    );
  });
});
