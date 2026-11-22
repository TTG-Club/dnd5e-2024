import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { loadEngineBundle, systemRoot } from './helpers/engineBundle.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Замена выбранного варианта умения при повышении уровня: колдун 2024 на
 * каждом уровне колдуна может поменять одно воззвание на другое. Режим задаёт
 * настройка выбора (`choiceConfig.replacement`, так же выгружает компендиум
 * TTG Club), а итоговый набор выбранного — взятое плюс замены не выше уровня
 * класса.
 */

// Как в самих тестах: модули собираются один раз на файл

const client = await loadEngineBundle(`
  export { removeReplacedClassOption } from './src/client/ui/actor/class/wizard/classOptionReplacement.ts';
  export { buildFeature, toEditableFeature } from './src/client/ui/actor/class/classEditorTypes.ts';
`);

/** Включаемый эффект варианта */
function optionEffect(id, name) {
  return {
    id,
    name,
    disabled: true,
    duration: { type: 'permanent' },
    changes: [],
    flags: [],
  };
}

/** «Таинственные воззвания»: замена на каждом уровне, рост по уровням */
const INVOCATIONS = {
  key: 'eldritch-invocations',
  name: 'Таинственные воззвания',
  description: '',
  level: 1,
  choiceConfig: {
    count: 1,
    progression: { 2: 3, 5: 5 },
    replacement: 'every-level',
  },
  choices: [
    {
      key: 'armor-of-shadows',
      name: 'Доспех теней',
      description: '',
      activeEffects: [optionEffect('shadow-armor', 'Доспех теней')],
      featData: {
        type: 'feat',
        skillProficiencies: ['stealth'],
        choices: [{ key: 'skill', type: 'skill', count: 1 }],
      },
    },
    { key: 'devils-sight', name: 'Дьявольское зрение', description: '' },
    { key: 'mask', name: 'Маска многих лиц', description: '' },
    {
      key: 'thirsting-blade',
      name: 'Жаждущий клинок',
      description: '',
      requiredLevel: 5,
    },
  ],
};

/** Манёвры: замена только на уровнях новой ступени */
const MANEUVERS = {
  key: 'combat-superiority',
  name: 'Боевое превосходство',
  description: '',
  level: 3,
  choiceConfig: {
    count: 3,
    progression: { 7: 5, 10: 7 },
    replacement: 'choice-levels',
  },
  choices: [{ key: 'trip', name: 'Подсечка', description: '' }],
};

describe('когда замена разрешена', () => {
  it('every-level — на любом уровне класса с уровня умения', () => {
    for (const level of [1, 2, 3, 4, 20]) {
      assert.equal(
        engine.canReplaceClassFeatureChoiceAt(INVOCATIONS, level),
        true,
      );
    }

    assert.equal(
      engine.canReplaceClassFeatureChoiceAt({ ...INVOCATIONS, level: 3 }, 2),
      false,
      'умения ещё нет',
    );
  });

  it('choice-levels — на уровне умения и на ступенях роста', () => {
    const allowed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((level) =>
      engine.canReplaceClassFeatureChoiceAt(MANEUVERS, level),
    );

    assert.deepEqual(allowed, [3, 7, 10]);
  });

  it('без поля и с незнакомым значением замены нет', () => {
    const { replacement: _omitted, ...withoutReplacement } =
      INVOCATIONS.choiceConfig;

    assert.equal(
      engine.canReplaceClassFeatureChoiceAt(
        { ...INVOCATIONS, choiceConfig: withoutReplacement },
        4,
      ),
      false,
    );

    assert.equal(
      engine.canReplaceClassFeatureChoiceAt(
        {
          ...INVOCATIONS,
          choiceConfig: { ...withoutReplacement, replacement: 'always' },
        },
        4,
      ),
      false,
    );

    assert.equal(
      engine.canReplaceClassFeatureChoiceAt(
        { ...INVOCATIONS, choiceConfig: undefined },
        4,
      ),
      false,
      'справочный список не меняют',
    );
  });
});

describe('итоговый набор выбранного', () => {
  const entry = {
    level: 4,
    featureChoices: {
      'eldritch-invocations': ['armor-of-shadows', 'devils-sight', 'mask'],
    },
    featureChoiceReplacements: [
      {
        featureKey: 'eldritch-invocations',
        level: 3,
        removedKey: 'armor-of-shadows',
        addedKey: 'thirsting-blade',
      },
    ],
  };

  it('замена ставит новый вариант на место убранного', () => {
    assert.deepEqual(
      engine.resolveFeatureChoiceKeys(entry, 'eldritch-invocations'),
      ['thirsting-blade', 'devils-sight', 'mask'],
    );
  });

  it('замена выше уровня класса не действует — откат вместе с уровнем', () => {
    assert.deepEqual(
      engine.resolveFeatureChoiceKeys(
        { ...entry, level: 2 },
        'eldritch-invocations',
      ),
      ['armor-of-shadows', 'devils-sight', 'mask'],
    );

    assert.deepEqual(
      engine
        .featureChoiceReplacementsUpTo(entry.featureChoiceReplacements, 2)
        .map((replacement) => replacement.level),
      [],
    );
  });

  it('убранный и взятый снова вариант встаёт в конец и не теряется', () => {
    // Хранимый список держит убранный ключ: взятый снова, он дописан ещё раз,
    // и замена прошлого уровня меняет только первое его вхождение
    assert.deepEqual(
      engine.resolveFeatureChoiceKeys(
        {
          ...entry,
          level: 5,
          featureChoices: {
            'eldritch-invocations': [
              'armor-of-shadows',
              'devils-sight',
              'mask',
              'armor-of-shadows',
            ],
          },
        },
        'eldritch-invocations',
      ),
      ['thirsting-blade', 'devils-sight', 'mask', 'armor-of-shadows'],
    );
  });

  it('цепочка замен и замена без убранного варианта', () => {
    assert.deepEqual(
      engine.resolveFeatureChoiceKeys(
        {
          ...entry,
          level: 6,
          featureChoiceReplacements: [
            ...entry.featureChoiceReplacements,
            {
              featureKey: 'eldritch-invocations',
              level: 6,
              removedKey: 'thirsting-blade',
              addedKey: 'armor-of-shadows',
            },
            {
              featureKey: 'eldritch-invocations',
              level: 6,
              removedKey: 'not-taken',
              addedKey: 'devils-sight',
            },
          ],
        },
        'eldritch-invocations',
      ),
      ['armor-of-shadows', 'devils-sight', 'mask'],
    );
  });

  it('старые записи: без поля замен, ключ строкой', () => {
    assert.deepEqual(
      engine.resolveFeatureChoiceKeys(
        { level: 3, featureChoices: { 'fighting-style': 'defense' } },
        'fighting-style',
      ),
      ['defense'],
    );

    assert.deepEqual(engine.resolveFeatureChoiceKeys(null, 'any'), []);
  });

  it('битые записи замен отбрасываются', () => {
    assert.deepEqual(
      engine.readFeatureChoiceReplacements([
        { featureKey: 'a', level: 2, removedKey: 'x', addedKey: 'y' },
        { featureKey: 'a', level: '2', removedKey: 'x', addedKey: 'y' },
        { featureKey: 'a', level: 2, removedKey: 'x' },
        'garbage',
      ]),
      [{ featureKey: 'a', level: 2, removedKey: 'x', addedKey: 'y' }],
    );

    assert.deepEqual(engine.readFeatureChoiceReplacements(undefined), []);
  });

  it('дары — у итогового набора: убранный вариант их больше не даёт', () => {
    const grants = engine.collectClassOptionGrants(
      INVOCATIONS,
      engine.resolveFeatureChoiceKeys(
        {
          level: 2,
          featureChoices: {
            'eldritch-invocations': ['armor-of-shadows', 'devils-sight'],
          },
          featureChoiceReplacements: [
            {
              featureKey: 'eldritch-invocations',
              level: 2,
              removedKey: 'armor-of-shadows',
              addedKey: 'mask',
            },
          ],
        },
        'eldritch-invocations',
      ),
    );

    // Механика есть только у «Доспеха теней» — после замены даров нет вовсе
    assert.deepEqual(grants, []);
  });
});

describe('снятие заменённого варианта с листа', () => {
  const classKey = 'warlock';
  const recordName = 'Таинственные воззвания: Доспех теней';
  const featureEffectId = `class-effect:${classKey}:pact-effect`;

  const optionEffectId = `class-effect:${classKey}:eldritch-invocations:armor-of-shadows:shadow-armor`;

  const grantEffectId = `class-effect:${classKey}:grant:eldritch-invocations:armor-of-shadows`;

  const scope = 'classOption:eldritch-invocations:armor-of-shadows:';

  const actor = {
    id: 'actor',
    features: [
      {
        id: 'feature-armor',
        name: recordName,
        grantedBy: 'Колдун',
        description: '',
        featureType: 'class',
        level: 1,
        effectIds: [featureEffectId, optionEffectId],
        featData: {
          type: 'feat',
          skillProficiencies: ['stealth'],
          choices: [{ key: `${scope}skill`, type: 'skill', count: 1 }],
        },
        choices: { [`${scope}skill`]: ['arcana'] },
      },
      {
        id: 'feature-other',
        name: 'Магия договора',
        grantedBy: 'Колдун',
        description: '',
        featureType: 'class',
        level: 1,
      },
    ],
    activeEffects: [
      { id: featureEffectId, name: 'Умение', changes: [], flags: [] },
      { id: optionEffectId, name: 'Доспех теней', changes: [], flags: [] },
      { id: grantEffectId, name: 'Дары', changes: [], flags: [] },
    ],
    spells: [
      {
        id: 'spell-mage-armor',
        name: 'Доспех мага',
        grantedByFeature: 'Доспех теней',
      },
      { id: 'spell-eldritch', name: 'Мистический заряд' },
    ],
    system: {
      classes: [],
      proficiencies: {
        armor: [],
        weapons: [],
        weaponMasteries: [],
        tools: [],
        languages: [],
        savingThrows: [],
        skills: {
          stealth: 'proficient',
          arcana: 'proficient',
          history: 'proficient',
        },
      },
      classCounters: [
        {
          counterKey: 'armor-uses',
          featureId: 'feature-armor',
          current: 1,
          max: 1,
        },
        { counterKey: 'pact', classKey, current: 1, max: 1 },
      ],
    },
  };

  const removal = client.removeReplacedClassOption(actor, {
    classKey,
    featureKey: 'eldritch-invocations',
    option: INVOCATIONS.choices[0],
    recordName,
    grantedBy: 'Колдун',
  });

  it('уходит запись варианта, остальное на месте', () => {
    assert.deepEqual(
      removal.features.map((feature) => feature.id),
      ['feature-other'],
    );

    assert.equal(removal.removedRecord.id, 'feature-armor');
  });

  it('уходят эффекты варианта, эффект самого умения остаётся', () => {
    assert.deepEqual(
      removal.activeEffects.map((effect) => effect.id),
      [featureEffectId],
    );
  });

  it('уходят заклинания, владения и ответы варианта, ресурс его записи', () => {
    assert.deepEqual(
      removal.spells.map((spell) => spell.id),
      ['spell-eldritch'],
    );

    assert.deepEqual(removal.proficiencies.skills, { history: 'proficient' });

    assert.deepEqual(
      removal.classCounters.map((counter) => counter.counterKey),
      ['pact'],
    );
  });

  it('лист не меняется на месте', () => {
    assert.equal(actor.features.length, 2);
    assert.equal(actor.system.proficiencies.skills.stealth, 'proficient');
  });
});

describe('форма класса', () => {
  it('режим замены переживает разворот и сборку; «нет» не пишется', () => {
    const editable = client.toEditableFeature(INVOCATIONS);

    assert.equal(editable.choiceConfig.replacement, 'every-level');

    assert.equal(
      client.buildFeature(editable).choiceConfig.replacement,
      'every-level',
    );

    const withoutReplacement = client.buildFeature({
      ...editable,
      choiceConfig: { ...editable.choiceConfig, replacement: 'none' },
    });

    assert.equal('replacement' in withoutReplacement.choiceConfig, false);
  });
});

describe('мастер уровня', () => {
  const wizard = readFileSync(
    join(systemRoot, 'src/client/ui/actor/class/wizard/useClassWizard.ts'),
    'utf8',
  );

  it('взятое читается итоговым набором — с заменами прошлых уровней', () => {
    assert.match(
      wizard,
      /takenKeys = new Set\(\s*resolveFeatureChoiceKeys\(currentClassEntry\.value, feature\.key\),/u,
    );

    assert.equal(
      wizard.match(/featureChoices\?\.\[feature\.key\]/gu),
      null,
      'голый featureChoices держал бы убранный вариант взятым',
    );
  });

  it('вариант взамен даёт дары тем же путём, что и выбранный новым', () => {
    assert.match(
      wizard,
      /\.\.\.completedReplacements\.value\.flatMap\(\(replacement\) =>\s*collectClassOptionGrants\(/u,
    );
  });

  it('начатая замена блокирует шаг, пока не названо, на что заменить', () => {
    assert.match(wizard, /&& areReplacementsComplete\.value/u);
  });

  it('заменённый вариант снимается до того, как лист получит уровень', () => {
    const removeIndex = wizard.indexOf('removeReplacedClassOption(sheet,');
    const levelIndex = wizard.indexOf('const levelGained =');

    assert.ok(removeIndex !== -1 && removeIndex < levelIndex);
  });
});
