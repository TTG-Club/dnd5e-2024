import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const {
  splitSubclassRecords,
  subclassFitsPack,
  toSubclassRecord,
  withSubclassRecords,
} = await loadEngineBundle(`
  export {
    splitSubclassRecords,
    subclassFitsPack,
    toSubclassRecord,
    withSubclassRecords,
  } from './src/engine/classLineage.ts';
`);

/** Воин компендиума с одним подклассом и ресурсом подкласса в общем списке. */
const fighter = {
  type: 'class',
  key: 'fighter',
  name: 'Воин',
  hitDie: 10,
  armorProficiencies: ['light'],
  weaponProficiencies: ['simple'],
  savingThrowProficiencies: ['strength'],
  skillChoices: { count: 2, from: ['athletics'] },
  subclassLevel: 3,
  subclassLabel: 'Воинский архетип',
  features: [],
  levelTable: [],
  counters: [
    { key: 'second-wind', name: 'Второе дыхание' },
    { key: 'psi-dice', name: 'Кости пси', subclassKey: 'psi-warrior' },
  ],
  subclasses: [
    {
      key: 'psi-warrior',
      name: 'Пси-воин',
      nameEn: 'Psi Warrior',
      description: 'Описание',
      unlockLevel: 3,
      sourceKey: 'phb',
      features: [
        {
          key: 'psionic-power',
          name: 'Псионическая сила',
          level: 3,
          description: '',
          subclassKey: 'psi-warrior',
        },
      ],
    },
  ],
};

it('подкласс становится записью со ссылкой на класс и своими ресурсами', () => {
  const record = toSubclassRecord(
    fighter,
    fighter.subclasses[0],
    'psi-warrior-copy',
  );

  assert.equal(record.key, 'psi-warrior-copy');
  assert.equal(record.parentClassKey, 'fighter');
  assert.equal(record.name, 'Пси-воин');
  assert.equal(record.sourceKey, 'phb');
  assert.deepEqual(record.subclasses, []);
  assert.equal(record.features[0].subclassKey, undefined);
  assert.deepEqual(record.counters, [{ key: 'psi-dice', name: 'Кости пси' }]);
});

it('копия встаёт рядом с подклассом компендиума, не заменяя его', () => {
  const record = toSubclassRecord(
    fighter,
    fighter.subclasses[0],
    'psi-warrior-copy',
  );

  const merged = withSubclassRecords(fighter, [record]);

  assert.deepEqual(
    merged.subclasses.map((subclass) => subclass.key),
    ['psi-warrior', 'psi-warrior-copy'],
  );

  const copy = merged.subclasses[1];

  assert.equal(copy.features[0].subclassKey, 'psi-warrior-copy');
  assert.deepEqual(copy.counters, [{ key: 'psi-dice', name: 'Кости пси' }]);
});

it('копия класса раскладывается на класс и отдельные подклассы', () => {
  const { classRecord, subclassRecords } = splitSubclassRecords(
    fighter,
    'fighter-copy',
    (key) => `${key}-copy`,
  );

  assert.equal(classRecord.key, 'fighter-copy');
  assert.deepEqual(classRecord.subclasses, []);

  assert.deepEqual(classRecord.counters, [
    { key: 'second-wind', name: 'Второе дыхание' },
  ]);

  assert.deepEqual(
    subclassRecords.map((record) => [record.key, record.parentClassKey]),
    [['psi-warrior-copy', 'fighter-copy']],
  );

  const merged = withSubclassRecords(classRecord, subclassRecords);

  assert.deepEqual(
    merged.subclasses.map((subclass) => subclass.key),
    ['psi-warrior-copy'],
  );
});

it('копия подкласса помнит пак класса и не липнет к классу чужого пака', () => {
  const record = toSubclassRecord(
    fighter,
    fighter.subclasses[0],
    'psi-warrior-copy',
    'srd-prod',
  );

  assert.equal(record.parentClassPackId, 'srd-prod');
  assert.equal(subclassFitsPack(record, 'srd-prod'), true);
  assert.equal(subclassFitsPack(record, 'srd-dev'), false);
  assert.equal(subclassFitsPack(record, undefined), true);

  const legacy = toSubclassRecord(fighter, fighter.subclasses[0], 'old');

  assert.equal(legacy.parentClassPackId, undefined);
  assert.equal(subclassFitsPack(legacy, 'srd-dev'), true);
});

it('подкласс находит класс в другом паке, если его пак отключён', () => {
  const record = toSubclassRecord(
    fighter,
    fighter.subclasses[0],
    'psi-warrior-copy',
    'srd-prod',
  );

  assert.equal(subclassFitsPack(record, 'srd-dev', new Set(['srd-dev'])), true);

  assert.equal(
    subclassFitsPack(record, 'srd-dev', new Set(['srd-dev', 'srd-prod'])),
    false,
  );
});
