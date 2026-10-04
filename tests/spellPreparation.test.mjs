import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEngineBundle, systemRoot } from './helpers/engineBundle.mjs';

const require = createRequire(join(systemRoot, 'package.json'));
const { build } = require('esbuild');

const engine = await loadEngineBundle(
  `
      export * from './src/engine/grantedSpells.ts';
      export { collectFeatGrantedSpellSources } from './src/engine/featGrants.ts';
      export { collectSpeciesGrantedSpellSources } from './src/engine/speciesGrants.ts';
      export { scopeClassOptionFeatData } from './src/engine/classFeatureOptions.ts';
      export { CANTRIP_SPELL_LEVEL } from './src/engine/spellTypes.ts';
      export * from './src/engine/preparedSpells.ts';
      export * from './src/engine/preparedLimit.ts';
    `,
);

/** Создаёт запись книги с полями, необходимыми выдаче и подготовке. */
function createSpell(name, level = 1) {
  return { id: name, name, level };
}

/** Сопоставляет источники с тестовым компендиумом, как клиентский резолвер. */
function resolveSources(sources, spells) {
  return sources.map((source) => ({
    spell: spells.find((spell) => spell.id === source.spellId),
    featureName: source.featureName,
    alwaysPrepared: source.alwaysPrepared,
    castingAbility: source.castingAbility,
    grantKind: source.grantKind,
    chosenByPlayer: source.chosenByPlayer,
  }));
}

it('wizard level 1 receives six unprepared spells and three usable cantrips', () => {
  // PROD /classes/wizard-phb/raw: choices count 3/6, spells.alwaysPrepared false.
  // Экспорт VTTG и редактор опускают выключенный флаг подготовки.
  const cantrips = ['light', 'mage-hand', 'ray-of-frost'].map((name) =>
    createSpell(name, 0),
  );

  const spells = [
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'magic-missile',
    'sleep',
    'thunderwave',
  ].map((name) => createSpell(name));

  const sources = engine.collectFeatGrantedSpellSources({
    name: 'Использование заклинаний',
    featData: {
      type: 'general',
      choices: [
        { key: 'cantrip', type: 'cantrip', count: 3, options: [] },
        { key: 'cantrip-4', type: 'spell', count: 6, options: [] },
      ],
    },
    choices: {
      'cantrip': cantrips.map((spell) => spell.id),
      'cantrip-4': spells.map((spell) => spell.id),
    },
  });

  const spellbook = engine.appendGrantedSpells(
    [],
    resolveSources(sources, [...cantrips, ...spells]),
  );

  assert.equal(spellbook.length, 9);

  assert.equal(
    spellbook.filter((spell) => spell.level > 0 && spell.prepared).length,
    0,
  );

  assert.equal(
    spellbook.filter((spell) => spell.level > 0 && spell.alwaysPrepared).length,
    0,
  );

  assert.equal(spellbook.filter(engine.isSpellReady).length, 3);

  assert.equal(
    engine.getClassPreparedValue(
      [{ level: 1, casterType: 'full', spellcastingAbility: 'intelligence' }],
      () => ({
        tableColumns: [{ key: 'preparedSpells', label: 'Подг. Закл.' }],
        levelTable: [{ level: 1, preparedSpells: '4' }],
      }),
      'spells',
    ),
    4,
  );
});

/** «Чудотворец» жреца: дополнительный заговор сверх колонки «Заговоры». */
function thaumaturgeFeatData(alwaysPrepared) {
  return {
    type: 'feat',
    choices: [
      {
        key: 'thaumaturge-cantrip',
        type: 'cantrip',
        count: 1,
        spellFilter: { level: 0, classKeys: ['cleric'] },
        ...(alwaysPrepared ? { alwaysPrepared: true } : {}),
      },
    ],
  };
}

it('a spell choice marked always prepared grants its picks without preparation', () => {
  const sources = engine.collectFeatGrantedSpellSources({
    name: 'Чудотворец',
    featData: thaumaturgeFeatData(true),
    choices: { 'thaumaturge-cantrip': ['guidance'] },
  });

  assert.deepEqual(
    sources.map((source) => source.alwaysPrepared),
    [true],
  );

  const spellbook = engine.appendGrantedSpells(
    [],
    resolveSources(sources, [createSpell('guidance', 0)]),
  );

  assert.deepEqual(
    spellbook.map((spell) => [spell.prepared, spell.alwaysPrepared]),
    [[true, true]],
  );
});

it('an unmarked spell choice keeps falling back to the record exception', () => {
  const plain = engine.collectFeatGrantedSpellSources({
    name: 'Чудотворец',
    featData: thaumaturgeFeatData(false),
    choices: { 'thaumaturge-cantrip': ['guidance'] },
  });

  assert.deepEqual(
    plain.map((source) => source.alwaysPrepared),
    [undefined],
  );

  const inherited = engine.collectFeatGrantedSpellSources({
    name: 'Чудотворец',
    featData: {
      ...thaumaturgeFeatData(false),
      grantedSpellsAlwaysPrepared: true,
    },
    choices: { 'thaumaturge-cantrip': ['guidance'] },
  });

  assert.deepEqual(
    inherited.map((source) => source.alwaysPrepared),
    [true],
  );
});

it('class option scoping keeps the always prepared mark of a spell choice', () => {
  const scoped = engine.scopeClassOptionFeatData(
    thaumaturgeFeatData(true),
    'option:divine-order:thaumaturge:',
    'Чудотворец',
  );

  assert.equal(scoped.choices[0].alwaysPrepared, true);

  const sources = engine.collectFeatGrantedSpellSources({
    name: 'Чудотворец',
    featData: scoped,
    choices: { [scoped.choices[0].key]: ['guidance'] },
  });

  assert.deepEqual(
    sources.map((source) => source.alwaysPrepared),
    [true],
  );
});

it('explicit preparation exceptions remain ready and do not prepare ordinary spellbook grants', () => {
  const spellbook = engine.appendGrantedSpells(
    [],
    [
      { spell: createSpell('ordinary'), featureName: 'Spellcasting' },
      {
        spell: createSpell('explicit-false'),
        featureName: 'Spellcasting',
        alwaysPrepared: false,
      },
      {
        spell: createSpell('domain-spell'),
        featureName: 'Domain',
        alwaysPrepared: true,
      },
    ],
  );

  assert.deepEqual(
    spellbook.map((spell) => [spell.prepared, spell.alwaysPrepared]),
    [
      [false, false],
      [false, false],
      [true, true],
    ],
  );
});

it('class grants inherit the feature exception and respect an explicit group override', () => {
  const sources = engine.collectGrantedSpellSourcesForClassLevel(
    [
      {
        name: 'Domain spells',
        level: 1,
        grantedSpells: ['inherited', 'ordinary'],
        featData: {
          grantedSpellsAlwaysPrepared: true,
          grantedSpells: [{ spellId: 'ordinary', alwaysPrepared: false }],
        },
      },
    ],
    1,
  );

  assert.deepEqual(
    sources.map((source) => source.alwaysPrepared),
    [true, false],
  );
});

it('innate species spells keep their preparation exception at the source', () => {
  const sources = engine.collectSpeciesGrantedSpellSources({
    features: [
      {
        name: 'Innate magic',
        grantedSpells: [
          { spellId: 'innate' },
          { spellId: 'ordinary', alwaysPrepared: false },
        ],
      },
    ],
  });

  assert.deepEqual(
    sources.map((source) => source.alwaysPrepared),
    [true, false],
  );

  const spellbook = engine.appendGrantedSpells(
    [],
    resolveSources(sources, [createSpell('innate'), createSpell('ordinary')]),
  );

  assert.deepEqual(
    spellbook.map((spell) => spell.alwaysPrepared),
    [true, false],
  );
});

it('species editor keeps the innate preparation mark and writes only its removal', async () => {
  const { loadHandler } = await import('./helpers/sourceHandler.mjs');
  const editorPath = 'src/client/ui/actor/species/speciesEditorTypes.ts';

  const read = await loadHandler(
    editorPath,
    'readGrantedSpellsAlwaysPrepared',
    {},
  );

  const write = await loadHandler(
    editorPath,
    'writeGrantedSpellPreparation',
    {},
  );

  assert.equal(read([]), true, 'new feature: innate magic by default');

  assert.equal(
    read([{ name: 'a' }, { name: 'b', alwaysPrepared: true }]),
    true,
  );

  assert.equal(
    read([{ name: 'a' }, { name: 'b', alwaysPrepared: false }]),
    false,
  );

  assert.deepEqual(
    Object.keys(write(true)),
    [],
    'checked mark is the species default',
  );

  assert.equal(write(false).alwaysPrepared, false);

  // Снятая отметка доходит до выдачи: заклинание занимает подготовку
  const sources = engine.collectSpeciesGrantedSpellSources({
    features: [
      {
        name: 'Magic',
        grantedSpells: [{ spellId: 'ordinary', ...write(false) }],
      },
    ],
  });

  assert.deepEqual(
    sources.map((source) => source.alwaysPrepared),
    [false],
  );
});

it('granted cantrips stay ready while book cantrips follow their mark once the sheet tracks them', () => {
  const granted = { ...createSpell('light', 0), grantedByFeature: 'Вид' };
  const book = createSpell('mage-hand', 0);

  assert.equal(engine.isSpellReady(granted), true);
  assert.equal(engine.isSpellReady(book), false);
  assert.equal(engine.isSpellReady({ ...book, prepared: true }), true);
  // Старый лист: прежняя отметка `false` у заговора ничего не значила
  assert.equal(engine.isSpellReady({ ...book, prepared: false }, false), true);
  assert.equal(engine.canTogglePrepared(book), true);
  assert.equal(engine.canTogglePrepared(granted), false);
  assert.equal(engine.isSpellReady(createSpell('magic-missile')), false);

  assert.equal(
    engine.isSpellReady({ ...createSpell('magic-missile'), prepared: true }),
    true,
  );
});

it('new level grants preserve existing preparation and removal preserves unrelated spells', () => {
  const existing = [
    { ...createSpell('prepared'), prepared: true, alwaysPrepared: false },
  ];

  const original = structuredClone(existing);

  const spellbook = engine.appendGrantedSpells(existing, [
    { spell: createSpell('new-level'), featureName: 'Spellcasting' },
    {
      spell: createSpell('prepared'),
      featureName: 'Spellcasting',
      alwaysPrepared: true,
    },
  ]);

  assert.equal(spellbook.length, 2);
  assert.deepEqual(existing, original);
  assert.equal(spellbook[0], existing[0]);
  assert.equal(spellbook[1].prepared, false);

  assert.deepEqual(
    engine.removeGrantedSpellsByFeatureNames(spellbook, ['Spellcasting']),
    existing,
  );
});

/** Заклинание, которое игрок назвал сам на шаге «Выбрать самому» мастера. */
function chosenClassSpell(name, level = 1) {
  return {
    spell: createSpell(name, level),
    featureName: 'Использование заклинаний',
    grantKind: 'class',
    chosenByPlayer: true,
  };
}

/** Заклинание того же умения, выданное всем списком класса. */
function listedClassSpell(name, level = 1) {
  return {
    spell: createSpell(name, level),
    featureName: 'Использование заклинаний',
    grantKind: 'class',
  };
}

/** Отметки подготовки книги по порядку. */
function preparedMarks(spellbook) {
  return spellbook.map((spell) => spell.prepared);
}

it('spells the player picked in the wizard land prepared while the limit has room', () => {
  // Бард 1 уровня: «Подг. закл.» — 4, игрок выбрал четыре заклинания и два заговора
  const spellbook = engine.appendGrantedSpells(
    [],
    [
      chosenClassSpell('vicious-mockery', 0),
      chosenClassSpell('mage-hand', 0),
      chosenClassSpell('thunderwave'),
      chosenClassSpell('heroism'),
      chosenClassSpell('dissonant-whispers'),
      chosenClassSpell('healing-word'),
    ],
    undefined,
    { limit: 4 },
  );

  assert.deepEqual(preparedMarks(spellbook), [
    false,
    false,
    true,
    true,
    true,
    true,
  ]);

  assert.equal(spellbook.filter(engine.countsTowardPreparedSpells).length, 4);

  // Выданные заговоры доступны и без отметки — их правило не трогает
  assert.equal(
    spellbook.filter((spell) => engine.isSpellReady(spell)).length,
    6,
  );

  assert.equal(spellbook.filter((spell) => spell.alwaysPrepared).length, 0);
});

it('picks beyond the limit stay unprepared and a missing limit prepares every pick', () => {
  const picks = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
    chosenClassSpell(name),
  );

  assert.deepEqual(
    preparedMarks(
      engine.appendGrantedSpells([], picks, undefined, { limit: 4 }),
    ),
    [true, true, true, true, false, false],
  );

  assert.deepEqual(
    preparedMarks(
      engine.appendGrantedSpells([], picks, undefined, { limit: 0 }),
    ),
    [false, false, false, false, false, false],
  );

  // Таблица класса предела не даёт — выбранное готово всё
  assert.deepEqual(
    preparedMarks(
      engine.appendGrantedSpells([], picks, undefined, { limit: null }),
    ),
    [true, true, true, true, true, true],
  );

  // Вызывающий предела не передал (черта, вид, предыстория) — как прежде
  assert.deepEqual(preparedMarks(engine.appendGrantedSpells([], picks)), [
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
});

it('the whole class list lands unprepared even when the limit has room', () => {
  const spellbook = engine.appendGrantedSpells(
    [],
    ['a', 'b', 'c'].map((name) => listedClassSpell(name)),
    undefined,
    { limit: 4 },
  );

  assert.deepEqual(preparedMarks(spellbook), [false, false, false]);
});

it('always prepared grants take no place and picks of a feat stay as they were', () => {
  const spellbook = engine.appendGrantedSpells(
    [],
    [
      {
        spell: createSpell('domain-spell'),
        featureName: 'Domain',
        grantKind: 'class',
        alwaysPrepared: true,
      },
      // Отметка «не готовить» у самого выбора: место не занимает и готова всегда
      { ...chosenClassSpell('free-pick'), alwaysPrepared: true },
      chosenClassSpell('first'),
      chosenClassSpell('second'),
      // Черта, взятая уровнем: в счёт подготовки класса не идёт
      { ...chosenClassSpell('feat-spell'), grantKind: 'feat' },
      chosenClassSpell('third'),
    ],
    undefined,
    { limit: 2 },
  );

  assert.deepEqual(
    spellbook.map((spell) => [spell.name, spell.prepared]),
    [
      ['domain-spell', true],
      ['free-pick', true],
      ['first', true],
      ['second', true],
      ['feat-spell', false],
      ['third', false],
    ],
  );

  assert.equal(spellbook.filter(engine.countsTowardPreparedSpells).length, 2);
});

it('a level up keeps earlier marks and prepares new picks into the grown limit', () => {
  // Бард 2 → 3: предел 5 → 6, на листе четыре подготовленных и одно без отметки
  const existing = [
    ...['a', 'b', 'c', 'd'].map((name) => ({
      ...createSpell(name),
      prepared: true,
      alwaysPrepared: false,
      grantedByFeature: 'Использование заклинаний',
      grantKind: 'class',
    })),
    {
      ...createSpell('unmarked'),
      prepared: false,
      alwaysPrepared: false,
      grantedByFeature: 'Использование заклинаний',
      grantKind: 'class',
    },
  ];

  const original = structuredClone(existing);

  const spellbook = engine.appendGrantedSpells(
    existing,
    [
      chosenClassSpell('suggestion', 2),
      chosenClassSpell('blindness', 2),
      chosenClassSpell('silence', 2),
    ],
    undefined,
    { limit: 6 },
  );

  assert.deepEqual(existing, original);
  assert.deepEqual(spellbook.slice(0, 5), existing);
  assert.deepEqual(preparedMarks(spellbook.slice(5)), [true, true, false]);
  assert.equal(spellbook.filter(engine.countsTowardPreparedSpells).length, 6);
});

it('answers to a spell choice of a record are marked as picked and cantrip picks need no mark', () => {
  // Книга волшебника: шесть заклинаний выбором записи, готовят четыре
  const cantrips = ['light', 'mage-hand'].map((name) => createSpell(name, 0));

  const spells = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
    createSpell(name),
  );

  const sources = engine
    .collectFeatGrantedSpellSources({
      name: 'Использование заклинаний',
      featData: {
        type: 'general',
        grantedSpells: [{ spellId: 'fixed' }],
        choices: [
          { key: 'cantrip', type: 'cantrip', count: 2, options: [] },
          { key: 'book', type: 'spell', count: 6, options: [] },
        ],
      },
      choices: {
        cantrip: cantrips.map((spell) => spell.id),
        book: spells.map((spell) => spell.id),
      },
    })
    .map((source) => ({ ...source, grantKind: 'class' }));

  assert.deepEqual(
    sources.map((source) => source.chosenByPlayer === true),
    [false, true, true, true, true, true, true, true, true],
  );

  const spellbook = engine.appendGrantedSpells(
    [],
    resolveSources(sources, [createSpell('fixed'), ...cantrips, ...spells]),
    undefined,
    { limit: 4 },
  );

  // Выданное записью без выбора ложится как прежде; выбранные — в предел
  assert.deepEqual(preparedMarks(spellbook), [
    false,
    false,
    false,
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
});

const { readFileSync } = require('node:fs');

const { parse } = require('@vue/compiler-sfc');
const typescript = require('typescript');
const { computed, reactive } = require('vue');

/** Читает настоящий script setup: обработчики не копируются в тестовую реализацию. */
function readActorComponent(relativePath) {
  const filename = join(systemRoot, relativePath);
  const parsed = parse(readFileSync(filename, 'utf8'), { filename });

  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.descriptor.scriptSetup);

  const sourceFile = typescript.createSourceFile(
    filename,
    parsed.descriptor.scriptSetup.content,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );

  return { sourceFile, template: parsed.descriptor.template.content };
}

/** Извлекает объявление обработчика или computed с исходными зависимостями. */
function componentDeclaration(component, name) {
  for (const statement of component.sourceFile.statements) {
    if (
      typescript.isFunctionDeclaration(statement)
      && statement.name?.text === name
    ) {
      return statement.getText(component.sourceFile);
    }

    if (!typescript.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        typescript.isIdentifier(declaration.name)
        && declaration.name.text === name
      ) {
        assert.ok(declaration.initializer);

        return `const ${name} = ${declaration.initializer.getText(component.sourceFile)};`;
      }
    }
  }

  throw new Error(`Missing component declaration: ${name}`);
}

/** Находит реальный импорт правила подготовки из движка, включая его локальное имя. */
function importsSpellReady(component) {
  return component.sourceFile.statements.some((statement) => {
    if (!typescript.isImportDeclaration(statement)) {
      return false;
    }

    if (statement.moduleSpecifier.text !== '@vtt/shared/system/dnd.js') {
      return false;
    }

    const namedBindings = statement.importClause?.namedBindings;

    return (
      namedBindings
      && typescript.isNamedImports(namedBindings)
      && namedBindings.elements.some(
        (specifier) =>
          specifier.name.text === 'isSpellReady'
          && (!specifier.propertyName
            || specifier.propertyName.text === 'isSpellReady'),
      )
    );
  });
}

const spellsTab = readActorComponent(
  'src/client/ui/actor/tabs/ActorSpellsTab.vue',
);

const spellRow = readActorComponent('src/client/ui/actor/ActorSpellRow.vue');

const preparationHarnessBundle = await build({
  stdin: {
    contents: `
      export function createTabHarness(context) {
        const { props, computed, engine, resolveClassDefinition, emit,
          triggerSaveIfNotEdit, toast, ACTOR_SPELLS_TAB_LABELS,
          resolvedStats } = context;
        const { CANTRIP_SPELL_LEVEL, getClassPreparedValue, getPreparedLimitBreakdown,
          countsTowardCantrips, countsTowardPreparedSpells, isSpellReady } = engine;
        ${[
          'classDefinitionOf',
          'spellcastingBonusContext',
          'preparedSpellsLimit',
          'cantripsLimit',
          'maxPreparedSpells',
          'cantripsTracked',
          'currentPreparedSpellsCount',
          'currentCantripsCount',
          'preparedLimitOf',
          'isOverPreparedLimit',
          'updatePrepared',
          'toggleSpellPrepared',
        ]
          .map((name) => componentDeclaration(spellsTab, name))
          .join('\n')}
        return { toggleSpellPrepared, currentPreparedSpellsCount, currentCantripsCount, maxPreparedSpells };
      }
      export function createRowHarness(context) {
        const { props, computed, isSpellReady, canTogglePrepared, emit } = context;
        ${['canPrepare', 'isPrepared', 'handlePreparedToggle']
          .map((name) => componentDeclaration(spellRow, name))
          .join('\n')}
        return { canPrepare, isPrepared, handlePreparedToggle };
      }
    `,
    sourcefile: 'spell-preparation-ui-handlers.ts',
    loader: 'ts',
  },
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node20',
});

const preparationHandlers = await import(
  `data:text/javascript;base64,${Buffer.from(preparationHarnessBundle.outputFiles[0].text).toString('base64')}`
);

/** Числа листа волшебника для своих бонусов: Интеллект +3, мастерство +2. */
function wizardSheetStats() {
  return {
    value: {
      abilityMods: {
        strength: 0,
        dexterity: 2,
        constitution: 1,
        intelligence: 3,
        wisdom: 1,
        charisma: -1,
      },
      proficiencyBonus: 2,
    },
  };
}

/** Соединяет обработчики строки и вкладки с реактивным актором и обратным обновлением props. */
function createPreparationFixture() {
  const book = engine.appendGrantedSpells(
    [],
    [
      ...Array.from({ length: 3 }, (_, index) => ({
        spell: createSpell(`cantrip-${index}`, 0),
        featureName: 'Spellcasting',
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        spell: createSpell(`spell-${index}`),
        featureName: 'Spellcasting',
      })),
    ],
  );

  const props = reactive({
    actor: {
      spells: book,
      system: {
        classes: [
          {
            classKey: 'wizard',
            level: 1,
            casterType: 'full',
            spellcastingAbility: 'intelligence',
          },
        ],
      },
    },
  });

  const notifications = [];
  const emittedUpdates = [];

  let saveCount = 0;

  const tab = preparationHandlers.createTabHarness({
    props,
    computed,
    engine,
    resolveClassDefinition: () => ({
      tableColumns: [{ key: 'preparedSpells', label: 'Подг. Закл.' }],
      levelTable: [{ level: 1, preparedSpells: '4' }],
    }),
    emit: (eventName, updates) => {
      assert.equal(eventName, 'update:actor');
      emittedUpdates.push(updates);
      props.actor = { ...props.actor, ...updates };
    },
    triggerSaveIfNotEdit: () => {
      saveCount++;
    },
    toast: {
      add: (notification) => notifications.push(notification),
    },
    ACTOR_SPELLS_TAB_LABELS: {
      limitTitle: 'limit',
      limitTextPrefix: 'limit ',
      limitTextSuffix: '',
    },
    resolvedStats: wizardSheetStats(),
  });

  /** Берёт строку из актуального списка после обновления родителем. */
  function rowFor(name) {
    const spell = props.actor.spells.find((entry) => entry.name === name);

    assert.ok(spell);

    return preparationHandlers.createRowHarness({
      props: { spell },
      computed,
      isSpellReady: engine.isSpellReady,
      canTogglePrepared: engine.canTogglePrepared,
      emit: (eventName) => {
        assert.equal(eventName, 'toggle-prepared');
        tab.toggleSpellPrepared(spell);
      },
    });
  }

  return {
    tab,
    props,
    book,
    rowFor,
    notifications,
    emittedUpdates,
    getSaveCount: () => saveCount,
  };
}

it('real row and tab handlers prepare four wizard spells, reject a fifth and allow a replacement', () => {
  const fixture = createPreparationFixture();

  assert.equal(fixture.tab.maxPreparedSpells.value, 4);
  assert.equal(fixture.tab.currentCantripsCount.value, 3);
  assert.equal(fixture.tab.currentPreparedSpellsCount.value, 0);

  const cantrip = fixture.rowFor('cantrip-0');

  assert.equal(cantrip.isPrepared.value, true);
  assert.equal(cantrip.canPrepare.value, false);
  cantrip.handlePreparedToggle();
  assert.equal(fixture.emittedUpdates.length, 0);

  for (let index = 0; index < 4; index++) {
    fixture.rowFor(`spell-${index}`).handlePreparedToggle();
  }

  assert.equal(fixture.tab.currentPreparedSpellsCount.value, 4);
  assert.equal(fixture.getSaveCount(), 4);

  const beforeRejected = fixture.props.actor.spells;

  fixture.rowFor('spell-4').handlePreparedToggle();
  assert.equal(fixture.props.actor.spells, beforeRejected);
  assert.equal(fixture.rowFor('spell-4').isPrepared.value, false);
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.getSaveCount(), 4);

  fixture.rowFor('spell-0').handlePreparedToggle();
  assert.equal(fixture.tab.currentPreparedSpellsCount.value, 3);
  fixture.rowFor('spell-4').handlePreparedToggle();
  assert.equal(fixture.tab.currentPreparedSpellsCount.value, 4);
  assert.equal(fixture.rowFor('spell-0').isPrepared.value, false);
  assert.equal(fixture.rowFor('spell-4').isPrepared.value, true);
  assert.equal(fixture.getSaveCount(), 6);
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.book.filter((spell) => spell.prepared).length, 0);
});

it('preparation counters react to a changed actor limit without making cantrips count as prepared spells', () => {
  const fixture = createPreparationFixture();

  fixture.props.actor = {
    ...fixture.props.actor,
    system: {
      ...fixture.props.actor.system,
      preparedSpells: { custom: null, bonus: 1 },
    },
  };

  assert.equal(fixture.tab.maxPreparedSpells.value, 5);

  for (let index = 0; index < 5; index++) {
    fixture.rowFor(`spell-${index}`).handlePreparedToggle();
  }

  assert.equal(fixture.tab.currentPreparedSpellsCount.value, 5);
  assert.equal(fixture.tab.currentCantripsCount.value, 3);
  assert.equal(fixture.notifications.length, 0);
});

it('the prepared limit counts ability, proficiency and flat bonuses on top of the class number', () => {
  const fixture = createPreparationFixture();

  fixture.props.actor = {
    ...fixture.props.actor,
    system: {
      ...fixture.props.actor.system,
      preparedSpells: {
        custom: null,
        bonuses: [
          {
            id: 'int',
            kind: 'ability',
            ability: 'intelligence',
            value: 0,
            label: 'Черта',
          },
          {
            id: 'prof',
            kind: 'proficiency',
            ability: 'strength',
            value: 0,
            label: '',
          },
          {
            id: 'flat',
            kind: 'flat',
            ability: 'strength',
            value: -1,
            label: 'Проклятие',
          },
        ],
      },
    },
  };

  // 4 по таблице + Интеллект 3 + мастерство 2 − 1
  assert.equal(fixture.tab.maxPreparedSpells.value, 8);
});

it('prepared limit bonuses follow the sheet numbers and never touch a custom number', () => {
  const context = wizardSheetStats().value;

  const bonuses = [
    { id: 'wis', kind: 'ability', ability: 'wisdom', value: 0, label: '' },
    {
      id: 'prof',
      kind: 'proficiency',
      ability: 'strength',
      value: 0,
      label: '',
    },
  ];

  assert.deepEqual(
    engine.getPreparedLimitBreakdown(4, { custom: null, bonuses }, context),
    { value: 7, classValue: 4, custom: false, bonus: 3 },
  );

  // Своё число — это и есть предел: бонусы с ним не складываются
  assert.equal(
    engine.getPreparedLimitBreakdown(4, { custom: 10, bonuses }, context).value,
    10,
  );

  // Таблица числа не даёт — бонусы прибавлять не к чему
  assert.equal(
    engine.getPreparedLimitBreakdown(null, { custom: null, bonuses }, context)
      .value,
    null,
  );

  // Отрицательный итог не уходит ниже нуля
  assert.equal(
    engine.getPreparedLimitBreakdown(
      1,
      {
        custom: null,
        bonuses: [
          {
            id: 'cha',
            kind: 'ability',
            ability: 'charisma',
            value: 0,
            label: '',
          },
          { id: 'f', kind: 'flat', ability: 'strength', value: -5, label: '' },
        ],
      },
      context,
    ).value,
    0,
  );
});

it('an old single bonus number becomes a flat bonus row and a saved list wins over it', () => {
  assert.deepEqual(engine.parsePreparedLimit({ custom: null, bonus: 2 }), {
    custom: null,
    bonuses: [
      {
        id: engine.LEGACY_PREPARED_BONUS_ID,
        kind: 'flat',
        ability: 'strength',
        value: 2,
        label: '',
      },
    ],
  });

  assert.deepEqual(engine.parsePreparedLimit({ custom: 5, bonus: 0 }), {
    custom: 5,
    bonuses: [],
  });

  assert.deepEqual(
    engine.parsePreparedLimit({ custom: null, bonus: 3, bonuses: [] }),
    { custom: null, bonuses: [] },
  );

  assert.deepEqual(engine.parsePreparedLimit(undefined), {
    custom: null,
    bonuses: [],
  });

  // Испорченная строка отбрасывается, остальные остаются
  assert.deepEqual(
    engine
      .parsePreparedLimit({
        custom: null,
        bonuses: [
          {
            id: 'ok',
            kind: 'proficiency',
            ability: 'strength',
            value: 0,
            label: '',
          },
          { id: 'broken', kind: 'luck' },
        ],
      })
      .bonuses.map((bonus) => bonus.id),
    ['ok'],
  );
});

it('the prepared limit is stored with clamped numbers and without the old bonus field', () => {
  assert.deepEqual(
    engine.normalizePreparedLimit({
      custom: 150,
      bonuses: [
        {
          id: 'big',
          kind: 'flat',
          ability: 'strength',
          value: 40.6,
          label: '  Кольцо  ',
        },
        {
          id: 'empty',
          kind: 'flat',
          ability: 'strength',
          value: Number.NaN,
          label: '',
        },
      ],
    }),
    {
      custom: engine.PREPARED_LIMIT_MAX,
      bonuses: [
        {
          id: 'big',
          kind: 'flat',
          ability: 'strength',
          value: 20,
          label: 'Кольцо',
        },
        { id: 'empty', kind: 'flat', ability: 'strength', value: 0, label: '' },
      ],
    },
  );
});

/** Вкладка жреца 1 уровня: три заговора класса и заговор «Чудотворца». */
function createClericCantripsTab(thaumaturgeAlwaysPrepared) {
  const classCantrips = ['light', 'sacred-flame', 'spare-the-dying'].map(
    (name) => createSpell(name, 0),
  );

  const thaumaturgeCantrip = createSpell('guidance', 0);

  const classSources = engine.collectFeatGrantedSpellSources({
    name: 'Использование заклинаний',
    featData: {
      type: 'feat',
      choices: [{ key: 'cantrip', type: 'cantrip', count: 3 }],
    },
    choices: { cantrip: classCantrips.map((spell) => spell.id) },
  });

  const thaumaturgeSources = engine.collectFeatGrantedSpellSources({
    name: 'Чудотворец',
    featData: thaumaturgeFeatData(thaumaturgeAlwaysPrepared),
    choices: { 'thaumaturge-cantrip': [thaumaturgeCantrip.id] },
  });

  const spells = engine.appendGrantedSpells(
    [],
    resolveSources(
      [...classSources, ...thaumaturgeSources],
      [...classCantrips, thaumaturgeCantrip],
    ),
  );

  const props = reactive({
    actor: {
      spells,
      system: {
        classes: [
          {
            classKey: 'cleric',
            level: 1,
            casterType: 'full',
            spellcastingAbility: 'wisdom',
          },
        ],
      },
    },
  });

  return preparationHandlers.createTabHarness({
    props,
    computed,
    engine,
    resolveClassDefinition: () => ({}),
    emit: () => {},
    triggerSaveIfNotEdit: () => {},
    toast: { add: () => {} },
    ACTOR_SPELLS_TAB_LABELS: {},
    resolvedStats: wizardSheetStats(),
  });
}

it('the cantrips tile does not count a thaumaturge cantrip marked always prepared', () => {
  // Колонка «Заговоры» таблицы жреца на 1 уровне — три
  assert.equal(
    engine.getClassPreparedValue(
      [{ level: 1, casterType: 'full', spellcastingAbility: 'wisdom' }],
      () => ({
        tableColumns: [{ key: 'cantripsKnown', label: 'Заговоры' }],
        levelTable: [{ level: 1, cantripsKnown: '3' }],
      }),
      'cantrips',
    ),
    3,
  );

  assert.equal(createClericCantripsTab(true).currentCantripsCount.value, 3);
  assert.equal(createClericCantripsTab(false).currentCantripsCount.value, 4);
});

it('the spell filter and row use the shared readiness rule and the template keeps the preparation event chain', () => {
  assert.equal(importsSpellReady(spellsTab), true);
  assert.equal(importsSpellReady(spellRow), true);

  assert.ok(
    componentDeclaration(spellsTab, 'filteredSpells').includes(
      '!isSpellReady(spell, cantripsTracked.value)',
    ),
  );

  assert.ok(
    componentDeclaration(spellRow, 'isPrepared').includes(
      'isSpellReady(props.spell, props.cantripsTracked)',
    ),
  );

  assert.ok(
    spellsTab.template.includes(
      '@toggle-prepared="toggleSpellPrepared(row.spell)"',
    ),
  );

  assert.ok(
    spellRow.template.includes(
      '@click.left.exact.prevent.stop="handlePreparedToggle"',
    ),
  );
});

/** Исходник от корня системы. */
function readSystemSource(relativePath) {
  return readFileSync(join(systemRoot, relativePath), 'utf8');
}

it('creation and level up share one wizard and one preparation rule', () => {
  const wizard = readSystemSource(
    'src/client/ui/actor/class/wizard/useClassWizard.ts',
  );

  // Мастер кладёт заклинания одним вызовом и передаёт в него предел листа
  assert.equal(wizard.match(/appendGrantedSpells\(/gu).length, 1);

  assert.match(
    wizard,
    /appendGrantedSpells\(\s*actor\.value\.spells \?\? \[\],\s*resolvedGrantedSpells,\s*undefined,\s*\{ limit: preparedSpellsLimit\.value \},\s*\)/u,
  );

  // Предел — расчёт плитки вкладки заклинаний: таблицы классов и поправки листа
  const limitStart = wizard.indexOf('const preparedSpellsLimit = computed');

  const limitBody = wizard.slice(
    limitStart,
    wizard.indexOf('\n  });', limitStart),
  );

  assert.ok(limitBody.includes('getPreparedLimitBreakdown('));
  assert.ok(limitBody.includes('getClassPreparedValue('));
  assert.ok(limitBody.includes('pending.system.preparedSpells'));

  const setup = readActorComponent(
    'src/client/ui/actor/class/ClassSetupWizard.vue',
  );

  const grants = componentDeclaration(setup, 'classSpellListGrants');

  // «Весь список» — как есть; «Выбрать самому» — с отметкой выбора игрока
  assert.match(grants, /if \(mode === 'all'\) \{\s*return offered;\s*\}/u);

  assert.match(
    grants,
    /\.filter\(\(granted\) => picked\.has\(granted\.spell\.id\)\)\s*\.map\(\(granted\) => \(\{ \.\.\.granted, chosenByPlayer: true \}\)\)/u,
  );

  assert.match(
    componentDeclaration(setup, 'handleComplete'),
    /buildUpdates\(\[\s*\.\.\.resolvedGrantedSpells\.value,\s*\.\.\.classSpellListGrants\.value,\s*\]\)/u,
  );

  // Создание, повышение уровня и мультикласс — один и тот же мастер: другого
  // входа, который клал бы заклинания класса мимо правила, нет
  const callers = listClientSources()
    .filter((path) => /\buseClassWizard\(/u.test(readFileSync(path, 'utf8')))
    .map(toSystemPath)
    .sort();

  assert.deepEqual(callers, [
    'src/client/ui/actor/class/ClassSetupWizard.vue',
    'src/client/ui/actor/class/wizard/useClassWizard.ts',
  ]);

  // Подпись шага говорит то же, что делает правило
  const labels = readSystemSource('src/client/ui/actor/constants.ts');

  assert.ok(
    labels.includes(
      'Выбранные ложатся на лист подготовленными, пока есть место в пределе подготовки',
    ),
  );

  assert.ok(!labels.includes('Выбранные ложатся на лист неподготовленными'));
});

// Сборщик формы — настоящий модуль редактора: галочка должна пережить и чтение
// записи в строки, и обратную сборку `featData`
const featEditor = await loadEngineBundle(
  `
      export { buildFeatData, featDataToGrants } from './src/client/ui/actor/feat/featEditorTypes.ts';
    `,
);

it('the spell choice editor round-trips the always prepared mark and omits it when cleared', () => {
  const grants = featEditor.featDataToGrants(thaumaturgeFeatData(true));

  assert.equal(grants.spellChoice.picks[0].alwaysPrepared, true);

  const saved = featEditor.buildFeatData(grants);

  assert.equal(saved.choices[0].alwaysPrepared, true);

  assert.equal(
    featEditor.featDataToGrants(saved).spellChoice.picks[0].alwaysPrepared,
    true,
  );

  grants.spellChoice.picks[0].alwaysPrepared = false;

  const cleared = featEditor.buildFeatData(grants);

  assert.equal('alwaysPrepared' in cleared.choices[0], false);

  const untouched = featEditor.buildFeatData(
    featEditor.featDataToGrants(thaumaturgeFeatData(false)),
  );

  assert.equal('alwaysPrepared' in untouched.choices[0], false);

  const rowsEditor = readActorComponent(
    'src/client/ui/actor/feat/SpellChoiceRowsEditor.vue',
  );

  assert.ok(rowsEditor.template.includes('v-model="row.alwaysPrepared"'));
});
