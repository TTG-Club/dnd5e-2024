import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { it } from 'vitest';

import { loadEngineBundle, systemRoot } from './helpers/engineBundle.mjs';

const require = createRequire(join(systemRoot, 'package.json'));
const { build } = require('esbuild');

const engine = await loadEngineBundle(
  `
      export * from './src/engine/grantedSpells.ts';
      export { collectFeatGrantedSpellSources } from './src/engine/featGrants.ts';
      export { collectSpeciesGrantedSpellSources } from './src/engine/speciesGrants.ts';
      export * from './src/engine/preparedSpells.ts';
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

it('known cantrips remain ready without preparation flags', () => {
  assert.equal(engine.isSpellReady(createSpell('light', 0)), true);
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
          triggerSaveIfNotEdit, useToast, ACTOR_SPELLS_TAB_LABELS } = context;
        const { getClassPreparedValue, getPreparedLimitBreakdown } = engine;
        ${[
          'classDefinitionOf',
          'preparedSpellsLimit',
          'maxPreparedSpells',
          'currentPreparedSpellsCount',
          'currentCantripsCount',
          'updatePrepared',
          'toggleSpellPrepared',
        ]
          .map((name) => componentDeclaration(spellsTab, name))
          .join('\n')}
        return { toggleSpellPrepared, currentPreparedSpellsCount, currentCantripsCount, maxPreparedSpells };
      }
      export function createRowHarness(context) {
        const { props, computed, isSpellReady, emit } = context;
        ${['CANTRIP_LEVEL', 'canPrepare', 'isPrepared', 'handlePreparedToggle']
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
    useToast: () => ({
      add: (notification) => notifications.push(notification),
    }),
    ACTOR_SPELLS_TAB_LABELS: {
      limitTitle: 'limit',
      limitTextPrefix: 'limit ',
      limitTextSuffix: '',
    },
  });

  /** Берёт строку из актуального списка после обновления родителем. */
  function rowFor(name) {
    const spell = props.actor.spells.find((entry) => entry.name === name);

    assert.ok(spell);

    return preparationHandlers.createRowHarness({
      props: { spell },
      computed,
      isSpellReady: engine.isSpellReady,
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

it('the spell filter and row use the shared readiness rule and the template keeps the preparation event chain', () => {
  assert.equal(importsSpellReady(spellsTab), true);
  assert.equal(importsSpellReady(spellRow), true);

  assert.ok(
    componentDeclaration(spellsTab, 'filteredSpells').includes(
      '!isSpellReady(spell)',
    ),
  );

  assert.ok(
    componentDeclaration(spellRow, 'isPrepared').includes(
      'isSpellReady(props.spell)',
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
