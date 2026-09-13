import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeEach, it, onTestFinished, vi } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';

const require = createRequire(join(systemRoot, 'package.json'));
const { build } = require('esbuild');

/**
 * Порты хоста, до которых дотягиваются мастер вида, откат и редактор черты.
 * Компендиум и мир этим проверкам не нужны: ресурсы считаются без них.
 */
const HOST_STUBS = {
  '@/core/entityUtils':
    'let issued = 0; export const generateEntityId = (prefix) => prefix + "-" + ++issued;',
  '@/stores/itemsStore':
    'export const useItemsStore = () => ({ itemsByType: () => [] });',
  '@/systems/dnd5e/composables/spellCompendium':
    'export const extractWorldSpells = () => []; export const loadSpellPacks = async () => ({ packs: [] });',
  '@/core/mimeTypes':
    "export const GAME_ITEM_TRANSFER_MIME = 'application/x-vttg-test';",
};

const bundle = await build({
  stdin: {
    contents: `
      export * from './src/engine/index.ts';
      export { useSpeciesWizard } from './src/client/ui/actor/species/useSpeciesWizard.ts';
      export { buildSpeciesRemovalUpdates } from './src/client/ui/actor/species/speciesRollback.ts';
      export { buildFeatData, featDataToGrants } from './src/client/ui/actor/feat/featEditorTypes.ts';
      export { createPinia, setActivePinia } from 'pinia';
      export { ref } from 'vue';
    `,
    resolveDir: systemRoot,
    sourcefile: 'species-counters-entry.ts',
    loader: 'ts',
  },
  plugins: [
    {
      name: 'host-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (request) => ({
          path: request.path,
          namespace: 'host-api',
        }));

        builder.onLoad({ filter: /.*/, namespace: 'host-api' }, (request) => {
          if (!(request.path in HOST_STUBS)) {
            throw new Error(`Неожиданный импорт хоста: ${request.path}`);
          }

          return { contents: HOST_STUBS[request.path], resolveDir: systemRoot };
        });
      },
    },
  ],
  alias: {
    '@vtt/shared/system/dnd.js': join(systemRoot, 'src/engine/index.ts'),
    '@vtt/shared': join(systemRoot, 'sdk/index.ts'),
    'vue': require.resolve('vue/dist/vue.runtime.esm-bundler.js'),
    'pinia': join(systemRoot, 'node_modules/pinia/dist/pinia.mjs'),
  },
  define: {
    'process.env.NODE_ENV': '"test"',
    '__VUE_OPTIONS_API__': 'true',
    '__VUE_PROD_DEVTOOLS__': 'false',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node20',
});

const bundlePath = join(tmpdir(), `species-counters-test-${randomUUID()}.mjs`);

await writeFile(bundlePath, bundle.outputFiles[0].text);

const runtime = await import(pathToFileURL(bundlePath).href).finally(() =>
  unlink(bundlePath),
);

beforeEach(() => {
  runtime.setActivePinia(runtime.createPinia());
});

/** Эльф из выгрузки: своих ресурсов у записи нет, они у подвида. */
const elf = {
  type: 'species',
  key: 'elf-phb',
  name: 'Эльф',
  nameEn: 'Elf',
  description: '',
  creatureType: 'humanoid',
  size: ['medium'],
  speed: { walk: 30 },
  features: [
    {
      key: 'darkvision',
      name: 'Тёмное зрение',
      description: '',
      featData: { type: 'feat', darkvision: 60 },
    },
  ],
};

/** Лесной эльф как в выгрузке core-api: ресурсы — в дарах записи-подвида. */
const woodElf = {
  type: 'species',
  key: 'wood-elf-phb',
  parentKey: 'elf-phb',
  name: 'Лесной эльф',
  nameEn: 'Wood Elf',
  description: '',
  creatureType: 'humanoid',
  size: ['medium'],
  speed: { walk: 30 },
  featData: {
    type: 'feat',
    modifiers: { speed: { walkBonus: 5 } },
    counters: [
      {
        key: 'longstrider',
        name: 'Скороход',
        max: '1',
        progression: { 3: 1 },
        recovery: 'long',
      },
      {
        key: 'pass-without-trace',
        name: 'Бесследное передвижение',
        shortName: 'Бесследно',
        max: '1',
        progression: { 5: 1 },
        recovery: 'long',
      },
    ],
  },
  features: [],
};

/**
 * Фэйри: ресурсы висят на умении «Магия фей», а не на записи. Второе умение
 * появляется только с 3 уровня и несёт ресурс без ступеней.
 */
const faerie = {
  type: 'species',
  key: 'faerie-lfl',
  name: 'Фэйри',
  nameEn: 'Faerie',
  description: '',
  creatureType: 'fey',
  size: ['small'],
  speed: { walk: 30 },
  features: [
    {
      key: 'fey-magic',
      name: 'Магия фей',
      description: '',
      featData: {
        type: 'feat',
        counters: [
          {
            key: 'faerie-fire',
            name: 'Огонь фей',
            max: '1',
            progression: { 3: 1 },
            recovery: 'long',
          },
          {
            key: 'enlarge-reduce',
            name: 'Увеличение/уменьшение',
            max: '1',
            progression: { 5: 1 },
            recovery: 'long',
          },
        ],
      },
    },
    {
      key: 'late-gift',
      name: 'Поздний дар',
      description: '',
      level: 3,
      featData: {
        type: 'feat',
        counters: [
          {
            key: 'late-charge',
            name: 'Поздний заряд',
            max: '1',
            recovery: 'long',
          },
        ],
      },
    },
  ],
};

/** Счётчик класса, который ресурсы вида трогать не должны. */
const classCounter = {
  counterKey: 'second-wind',
  classKey: 'fighter',
  name: 'Второе дыхание',
  recovery: 'short-one',
  current: 1,
  max: 2,
};

/** Свой ресурс игрока с нулевым максимумом. */
const customCounter = {
  counterKey: 'custom-counter-1',
  classKey: 'custom',
  name: 'Мой ресурс',
  shortName: 'Мой',
  maxFormula: '0',
  current: 0,
  max: 0,
};

/**
 * Персонаж нужного уровня с валидным состоянием движка.
 *
 * @param {number} level - суммарный уровень персонажа
 */
function createActor(level) {
  const actor = structuredClone(runtime.DEFAULT_ACTOR);

  actor.id = 'actor-1';

  actor.system.classes = [
    {
      classKey: 'fighter',
      className: 'Воин',
      level,
      subclassKey: null,
      hitDie: 10,
      hitDiceUsed: 0,
      hitPointsGained: [],
      chosenSkills: [],
    },
  ];

  return actor;
}

/**
 * Персонаж на новом уровне с теми же счётчиками — как лист после повышения.
 *
 * @param {object} actor - персонаж
 * @param {number} level - новый суммарный уровень
 */
function withLevel(actor, level) {
  return {
    ...actor,
    system: {
      ...actor.system,
      classes: actor.system.classes.map((entry) => ({ ...entry, level })),
    },
  };
}

/**
 * Состояние ресурсов вида строками: так видно и заряды, и отсутствие дублей.
 *
 * @param {object[]} counters - счётчики актора
 */
function speciesCounterStates(counters) {
  return counters
    .filter((counter) => runtime.isSpeciesCounter(counter))
    .map(
      (counter) =>
        `${counter.featureId}/${counter.counterKey}=${counter.current}/${counter.max}`,
    );
}

/**
 * Пересобирает ресурсы лесного эльфа так же, как лист на смене уровня.
 *
 * @param {object} actor - персонаж с уже новым уровнем
 */
function refreshWoodElf(actor) {
  const level = runtime.getTotalLevel(actor.system.classes);

  return runtime.refreshSpeciesCounters(
    actor,
    actor.system.classCounters,
    runtime.collectSpeciesFeatDataSources(elf, level, [], woodElf),
  );
}

/**
 * Применяет обновления мастера к персонажу, как это делает лист.
 *
 * @param {object} actor - персонаж
 * @param {{ systemUpdates: object, rootUpdates: object }} updates - итог мастера
 */
function applyUpdates(actor, { systemUpdates, rootUpdates }) {
  return {
    ...actor,
    ...rootUpdates,
    system: { ...actor.system, ...systemUpdates },
  };
}

/**
 * Прогоняет мастер вида целиком и возвращает его обновления.
 *
 * @param {object} actor - персонаж
 * @param {object} definition - вид
 * @param {object | null} subspecies - подвид-запись
 * @param {object | null} previous - прежние вид и подвид для отката
 */
function runSpeciesWizard(actor, definition, subspecies, previous = null) {
  const wizard = runtime.useSpeciesWizard(
    runtime.ref(actor),
    runtime.ref(definition),
    runtime.ref([elf, woodElf, faerie]),
  );

  wizard.state.value.selectedSize = definition.size[0];
  wizard.state.value.subspeciesKey = subspecies?.key ?? null;

  return wizard.buildUpdates(
    previous?.definition ?? null,
    [],
    previous?.subspecies ?? null,
  );
}

it('wood elf resources appear on character levels 3 and 5', () => {
  const level1 = refreshWoodElf(createActor(1));
  const level3 = refreshWoodElf(createActor(3));
  const level5 = refreshWoodElf(createActor(5));

  assert.deepEqual(speciesCounterStates(level1), [
    'species:wood-elf-phb/longstrider=0/0',
    'species:wood-elf-phb/pass-without-trace=0/0',
  ]);

  assert.deepEqual(speciesCounterStates(level3), [
    'species:wood-elf-phb/longstrider=1/1',
    'species:wood-elf-phb/pass-without-trace=0/0',
  ]);

  assert.deepEqual(speciesCounterStates(level5), [
    'species:wood-elf-phb/longstrider=1/1',
    'species:wood-elf-phb/pass-without-trace=1/1',
  ]);

  // Ступени старше формулы: запасная формула «1» на акторе не оседает, иначе
  // отдых на первом уровне поднял бы ещё не появившийся ресурс
  assert.ok(level1.every((counter) => counter.maxFormula === undefined));
});

it('level-up keeps spent charges and brings a new resource full', () => {
  let actor = createActor(1);

  actor.system.classCounters = [classCounter, customCounter];
  actor.system.classCounters = refreshWoodElf(actor);

  actor = withLevel(actor, 3);
  actor.system.classCounters = refreshWoodElf(actor);

  assert.deepEqual(speciesCounterStates(actor.system.classCounters), [
    'species:wood-elf-phb/longstrider=1/1',
    'species:wood-elf-phb/pass-without-trace=0/0',
  ]);

  // «Скороход» потрачен до следующего продолжительного отдыха
  actor.system.classCounters = actor.system.classCounters.map((counter) =>
    counter.counterKey === 'longstrider' ? { ...counter, current: 0 } : counter,
  );

  actor = withLevel(actor, 4);
  actor.system.classCounters = refreshWoodElf(actor);

  actor = withLevel(actor, 5);
  actor.system.classCounters = refreshWoodElf(actor);

  assert.deepEqual(speciesCounterStates(actor.system.classCounters), [
    'species:wood-elf-phb/longstrider=0/1',
    'species:wood-elf-phb/pass-without-trace=1/1',
  ]);

  // Повторный пересчёт на том же уровне ничего не меняет и не задваивает
  const again = refreshWoodElf(actor);

  assert.ok(runtime.isSameCounterList(actor.system.classCounters, again));

  // Чужие счётчики стоят на своих местах и не тронуты
  assert.deepEqual(actor.system.classCounters.slice(0, 2), [
    classCounter,
    customCounter,
  ]);
});

it('species resources on a feature, including a feature with its own level', () => {
  const statesAt = (level) =>
    speciesCounterStates(
      runtime.refreshSpeciesCounters(
        createActor(level),
        [],
        runtime.collectSpeciesFeatDataSources(faerie, level, [], null),
      ),
    );

  assert.deepEqual(statesAt(1), [
    'species:feature:fey-magic/faerie-fire=0/0',
    'species:feature:fey-magic/enlarge-reduce=0/0',
  ]);

  assert.deepEqual(statesAt(3), [
    'species:feature:fey-magic/faerie-fire=1/1',
    'species:feature:fey-magic/enlarge-reduce=0/0',
    'species:feature:late-gift/late-charge=1/1',
  ]);

  assert.deepEqual(statesAt(5), [
    'species:feature:fey-magic/faerie-fire=1/1',
    'species:feature:fey-magic/enlarge-reduce=1/1',
    'species:feature:late-gift/late-charge=1/1',
  ]);
});

it('species wizard creates resources and re-application keeps spent charges', () => {
  let actor = createActor(3);

  actor.system.classCounters = [classCounter];
  actor = applyUpdates(actor, runSpeciesWizard(actor, elf, woodElf));

  assert.deepEqual(speciesCounterStates(actor.system.classCounters), [
    'species:wood-elf-phb/longstrider=1/1',
    'species:wood-elf-phb/pass-without-trace=0/0',
  ]);

  actor.system.classCounters = actor.system.classCounters.map((counter) =>
    counter.counterKey === 'longstrider' ? { ...counter, current: 0 } : counter,
  );

  actor = applyUpdates(
    actor,
    runSpeciesWizard(actor, elf, woodElf, {
      definition: elf,
      subspecies: woodElf,
    }),
  );

  assert.deepEqual(speciesCounterStates(actor.system.classCounters), [
    'species:wood-elf-phb/longstrider=0/1',
    'species:wood-elf-phb/pass-without-trace=0/0',
  ]);

  assert.deepEqual(actor.system.classCounters[0], classCounter);
});

it('changing and removing species takes its resources away', () => {
  let actor = createActor(5);

  actor.system.classCounters = [classCounter, customCounter];
  actor = applyUpdates(actor, runSpeciesWizard(actor, elf, woodElf));

  actor = applyUpdates(
    actor,
    runSpeciesWizard(actor, faerie, null, {
      definition: elf,
      subspecies: woodElf,
    }),
  );

  assert.deepEqual(speciesCounterStates(actor.system.classCounters), [
    'species:feature:fey-magic/faerie-fire=1/1',
    'species:feature:fey-magic/enlarge-reduce=1/1',
    'species:feature:late-gift/late-charge=1/1',
  ]);

  const { systemUpdates } = runtime.buildSpeciesRemovalUpdates(actor, faerie);

  assert.deepEqual(systemUpdates.classCounters, [classCounter, customCounter]);
});

it('species resources with the same key from different sources stay separate', () => {
  const sameKeyCounter = {
    key: 'longstrider',
    name: 'Скороход подвида',
    max: '1',
    recovery: 'long',
  };

  const sources = [
    ...runtime.collectSpeciesFeatDataSources(elf, 3, [], woodElf),
    {
      sourceKey: 'feature:extra',
      sourceName: 'Второй источник',
      featData: { type: 'feat', counters: [sameKeyCounter] },
    },
  ];

  const counters = runtime.refreshSpeciesCounters(createActor(3), [], sources);

  const spent = counters.map((counter, index) =>
    index === 0 ? { ...counter, current: 0 } : counter,
  );

  // Трата одного не задевает второй: идентичность общая с плитками листа
  assert.equal(runtime.isSameCounter(spent[0], spent[2]), false);

  assert.deepEqual(
    speciesCounterStates(
      runtime.refreshSpeciesCounters(createActor(3), spent, sources),
    ),
    [
      'species:wood-elf-phb/longstrider=0/1',
      'species:wood-elf-phb/pass-without-trace=0/0',
      'species:feature:extra/longstrider=1/1',
    ],
  );
});

it('feat recount on level-up keeps species resources', () => {
  let actor = createActor(3);

  actor.system.classCounters = refreshWoodElf(actor);
  actor = withLevel(actor, 4);

  const refreshed = runtime.refreshFeatCounters(
    actor,
    actor.system.classCounters,
  );

  assert.deepEqual(speciesCounterStates(refreshed), [
    'species:wood-elf-phb/longstrider=1/1',
    'species:wood-elf-phb/pass-without-trace=0/0',
  ]);
});

it('feat resource with progression and no max formula', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  // Шпион снимается и при упавшей проверке: иначе чужие тесты потеряли бы лог
  onTestFinished(() => warn.mockRestore());

  const feat = {
    id: 'feature-feat',
    featData: {
      type: 'feat',
      counters: [
        {
          key: 'steps-only',
          name: 'Только ступени',
          progression: { 3: 2, 7: 3 },
          recovery: 'long',
        },
        { key: 'luck', name: 'Очки удачи', max: '@prof', recovery: 'long' },
      ],
    },
  };

  const level1 = runtime.buildFeatCounters(feat, createActor(1));

  assert.equal(level1[0].max, 0);
  assert.equal(level1[0].current, 0);
  assert.equal('maxFormula' in level1[0], false);

  // Ресурс без ступеней — как раньше: формула на счётчике, максимум по ней
  assert.equal(level1[1].max, 2);
  assert.equal(level1[1].maxFormula, '@prof');

  const spentLuck = level1.map((counter) =>
    counter.counterKey === 'luck' ? { ...counter, current: 1 } : counter,
  );

  const level3 = runtime.buildFeatCounters(feat, createActor(3), spentLuck);

  assert.deepEqual(
    level3.map(
      (counter) => `${counter.counterKey}=${counter.current}/${counter.max}`,
    ),
    ['steps-only=2/2', 'luck=1/2'],
  );

  const level7 = runtime.buildFeatCounters(feat, createActor(7), [
    { ...level3[0], current: 1 },
    level3[1],
  ]);

  assert.equal(`${level7[0].current}/${level7[0].max}`, '1/3');
  assert.equal(warn.mock.calls.length, 0);
});

it('resource without charges is hidden on the sheet and in the long rest summary', () => {
  const actor = createActor(1);

  actor.system.classCounters = [
    ...refreshWoodElf(actor),
    customCounter,
    { ...classCounter, current: 0 },
  ];

  const context = runtime.buildCounterFormulaContext(actor);

  const shown = actor.system.classCounters.filter((counter) =>
    runtime.isCounterAvailable(
      counter,
      runtime.resolveCounterMaxIn(context, counter),
    ),
  );

  assert.deepEqual(
    shown.map((counter) => counter.counterKey),
    ['custom-counter-1', 'second-wind'],
  );

  // Отдых вернёт заряды только «Второму дыханию»: ресурсы вида ещё не появились
  assert.equal(runtime.summarizeActorLongRest(actor).countersRestored, 1);
});

it('feat editor keeps a resource defined only by progression', () => {
  const featData = {
    type: 'feat',
    counters: [
      {
        key: 'longstrider',
        name: 'Скороход',
        progression: { 3: 1 },
        recovery: 'long',
      },
      {
        key: 'pass-without-trace',
        name: 'Бесследное передвижение',
        max: '1',
        progression: { 5: 1 },
        recovery: 'long',
      },
      { key: 'plain', name: 'Без ступеней', recovery: 'short' },
    ],
  };

  const grants = runtime.featDataToGrants(featData);

  assert.equal(grants.counters[0].max, '');

  assert.deepEqual(runtime.buildFeatData(grants).counters, [
    {
      key: 'longstrider',
      name: 'Скороход',
      recovery: 'long',
      progression: { 3: 1 },
    },
    {
      key: 'pass-without-trace',
      name: 'Бесследное передвижение',
      recovery: 'long',
      max: '1',
      progression: { 5: 1 },
    },
    { key: 'plain', name: 'Без ступеней', recovery: 'short', max: '0' },
  ]);

  const summary = runtime.buildFeatGrantsSummary({
    id: 'feat',
    name: 'Лесной эльф',
    description: '',
    featData,
  });

  assert.match(summary, /Скороход \(с 3 ур\. — 1, продолжительный отдых\)/);
  assert.doesNotMatch(summary, /undefined/);
});
