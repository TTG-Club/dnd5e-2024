import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, it } from 'vitest';

import { hostSharedEntry } from './helpers/engineBundle.mjs';

const systemRoot = fileURLToPath(new URL('../', import.meta.url));

const require = createRequire(join(systemRoot, 'package.json'));
const { build } = require('esbuild');

const hostFixture = `
import { reactive } from 'vue';
export const fixture = reactive({
  rolls: [], formulas: [], messages: [], prompts: [], requests: [], entities: [],
  outcome: { status: 'noRecipient' }, ambient: [],
});
export const worldStore = {
  connectionState: { loggedAsUserId: 'player' },
  get currentWorld() { return { actors: fixture.entities, creatures: [] }; },
};
export const diceStore = { parseAndRoll(formula) {
  fixture.formulas.push(formula);
  const result = fixture.rolls.shift();
  if (!result) throw new Error('Unexpected dice roll');
  return { ...result, formula };
} };
export const chatStore = { sendMessage: (...message) => fixture.messages.push(message) };
export const modalManager = { openModal(component, props) {
  fixture.prompts.push({ component, props }); return 'save-modal';
}, closeModal() {} };
export const requestService = { async request(options) {
  fixture.requests.push(options); return fixture.outcome;
}, async requestMany(options) {
  fixture.requests.push(...options); return options.map(() => fixture.outcome);
} };
`;

const bundle = await build({
  stdin: {
    contents: `
      export * from './src/client/composables/useSpellSavingThrows.ts';
      export { promptRequestedRoll } from './src/client/composables/requestedRollPrompt.ts';
      export { decrementActorEffectDurations } from './src/engine/turnEffects.ts';
      export { processTurnEffects, resolveEntryEffect } from './src/engine/effectTriggerRunner.ts';
      export { DEFAULT_ACTOR, DEFAULT_CREATURE } from './src/engine/consts.ts';
      export { SAVING_THROW_REQUEST_KIND } from './src/engine/savingThrowRequest.ts';
      export { collectActiveEffects } from './src/engine/effectPipeline.ts';
      export { systemRegistry } from '@vtt/shared';
      export * from 'test:host';
    `,
    resolveDir: systemRoot,
    sourcefile: 'saving-throw-test-entry.ts',
    loader: 'ts',
  },
  alias: {
    '@vtt/shared/system/dnd.js': join(systemRoot, 'src/engine/index.ts'),
    '@vtt/shared': hostSharedEntry,
  },
  plugins: [
    {
      name: 'saving-throw-host-fixture',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^\.\/(?:useBonusDamageParts|incomingAttack|targetAllyAdjacent)$/,
          },
          (request) =>
            request.importer.endsWith('rollBonusEvaluator.ts')
              ? { path: request.path, namespace: 'target-fixture' }
              : null,
        );

        builder.onLoad({ filter: /.*/, namespace: 'target-fixture' }, () => ({
          // Цели у спасброска нет: контекст цели, её защиты и союзники пусты
          contents: [
            'export const useBonusDamageParts = () => ({ buildTargetHpContext: () => undefined });',
            'export const resolveAttackTypeOfKeys = () => undefined;',
            'export const collectDefenderRollFormulas = () => [];',
            'export const isAllyAdjacentToTarget = () => false;',
          ].join('\n'),
        }));

        builder.onResolve({ filter: /^test:host$/ }, () => ({
          path: 'host',
          namespace: 'fixture',
        }));

        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: hostFixture,
          resolveDir: systemRoot,
        }));

        builder.onResolve({ filter: /^@\// }, (request) =>
          request.path === '@/core/mimeTypes'
            ? {
                path: join(
                  systemRoot,
                  '../vttg/packages/client/src/core/mimeTypes.ts',
                ),
              }
            : { path: request.path, namespace: 'host-api' },
        );

        builder.onLoad({ filter: /.*/, namespace: 'host-api' }, (request) => {
          const modules = {
            '@/core/api/rollRequestService':
              'import { requestService } from "test:host"; export const getRollRequestService = () => requestService;',
            '@/stores/chatStore':
              'import { chatStore } from "test:host"; export const useChatStore = () => chatStore;',
            '@/stores/diceRollerStore':
              'import { diceStore } from "test:host"; export const useDiceRollerStore = () => diceStore;',
            '@/stores/worldStore':
              'import { worldStore } from "test:host"; export const useWorldStore = () => worldStore;',
            '@/shared_ui/composables/useModalManager':
              'import { modalManager } from "test:host"; export const useModalManager = () => modalManager;',
            '@/stores/initiativeStore':
              'export const useInitiativeStore = () => ({ encounter: null });',
            '@/stores/spellTemplateStore':
              'export const useSpellTemplateStore = () => ({});',
            '@/stores/projectileStore':
              'export const useProjectileStore = () => ({ isActive: false, assignedTargets: new Map() });',
            '@/stores/auraStore':
              'import { fixture } from "test:host"; export const useAuraStore = () => ({ getAmbientEffectsForActor: () => fixture.ambient });',
            '@/core/entityUtils':
              'export const collectWorldEntities = world => world?.actors ?? []; export const findEntityInWorld = (world, id) => world?.actors.find(entity => entity.id === id);',
          };

          if (!(request.path in modules)) {
            throw new Error(`Unexpected host import: ${request.path}`);
          }

          return { contents: modules[request.path], resolveDir: systemRoot };
        });
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node20',
});

const runtime = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

runtime.systemRegistry.register({
  id: 'saving-throw-test',
  collectActiveEffects: runtime.collectActiveEffects,
});

runtime.systemRegistry.setActiveSessionSystem('saving-throw-test');

beforeEach(() => {
  for (const key of [
    'rolls',
    'formulas',
    'messages',
    'prompts',
    'requests',
    'entities',
    'ambient',
  ]) {
    runtime.fixture[key].length = 0;
  }

  runtime.fixture.outcome = { status: 'noRecipient' };
});

/** Создаёт эффект с полями реального контракта системы. */
function createEffect(id, overrides = {}) {
  return {
    id,
    name: id,
    description: '',
    origin: 'spell',
    disabled: false,
    transfer: false,
    duration: { type: 'permanent' },
    changes: [],
    flags: [],
    ...overrides,
  };
}

/** Создаёт Благословение для спасброска Телосложения. */
function createBless(overrides = {}) {
  return createEffect('bless', {
    changes: [
      { key: 'save.constitution', mode: 'add', value: '1d4', priority: 20 },
    ],
    ...overrides,
  });
}

/** Создаёт персонажа или существо с модификатором Телосложения +2. */
function createEntity(kind = 'actor', overrides = {}) {
  const base = structuredClone(
    kind === 'actor' ? runtime.DEFAULT_ACTOR : runtime.DEFAULT_CREATURE,
  );

  const entity = {
    ...base,
    id: `saving-${kind}`,
    name: kind,
    ownerId: 'player',
    autoSaves: true,
    system: {
      ...base.system,
      abilities: { ...base.system.abilities, constitution: 14 },
    },
    activeEffects: [createBless()],
    ...overrides,
  };

  runtime.fixture.entities.push(entity);

  return runtime.fixture.entities.at(-1);
}

/** Создаёт итог роллера, сохраняя отброшенные d20 и отдельную бонусную кость. */
function rolled(total, d20Values = [12], dropped = [], bonusValues = [3]) {
  return {
    formula: '',
    total,
    details: '',
    dice: [
      {
        count: d20Values.length,
        sides: 20,
        values: d20Values,
        dropped,
        critSuccesses: [],
        critFailures: [],
      },
      ...(bonusValues.length
        ? [
            {
              count: bonusValues.length,
              sides: 4,
              values: bonusValues,
              dropped: [],
              critSuccesses: [],
              critFailures: [],
            },
          ]
        : []),
    ],
  };
}

/** Выполняет серверный сценарий с определёнными результатами костей. */
function withDice(randomValues, runScenario) {
  const originalRandom = Math.random;
  const pending = [...randomValues];

  Math.random = () => {
    assert.ok(pending.length > 0, 'Unexpected random roll');

    return pending.shift();
  };

  try {
    const result = runScenario();

    assert.equal(pending.length, 0, 'Expected dice were not rolled');

    return result;
  } finally {
    Math.random = originalRandom;
  }
}

it('local auto saves add Bless for actors and creatures and retain the kept advantage d20', () => {
  for (const kind of ['actor', 'creature']) {
    const entity = createEntity(kind);

    entity.activeEffects.push(
      createEffect('advantage', { flags: ['save.advantage.constitution'] }),
    );

    runtime.fixture.rolls.push(rolled(23, [5, 18], [0]));

    const result = runtime
      .useSpellSavingThrows()
      .rollSavingThrow({ entity, ability: 'constitution', dc: 22 });

    assert.deepEqual(result, {
      roll: 18,
      modifier: 5,
      total: 23,
      passed: true,
    });

    assert.match(runtime.fixture.formulas.at(-1), /1d4/);
    assert.match(runtime.fixture.formulas.at(-1), /2[кd]20/);
  }
});

it('manual save uses the selected mode for bonus conditions and keeps user bonuses outside natural d20', () => {
  const entity = createEntity('actor', { autoSaves: false });

  entity.activeEffects.push(
    createEffect('conditional', {
      changes: [
        {
          key: 'save.constitution',
          mode: 'add',
          value: '1d6',
          priority: 20,
          condition: 'roll.hasAdvantage === true',
        },
      ],
    }),
  );

  const results = [];

  runtime.useSpellSavingThrows().openSavingThrowModal(
    { entity, ability: 'constitution', dc: 18 },
    {
      onResult: (result) => results.push(result),
      onCancel: () => assert.fail('Unexpected cancel'),
    },
  );

  const modal = runtime.fixture.prompts[0].props;

  assert.deepEqual(
    modal.evaluateBonusRollFormulas({
      hasAdvantage: false,
      hasDisadvantage: false,
    }),
    ['1d4'],
  );

  assert.deepEqual(
    modal.evaluateBonusRollFormulas({
      hasAdvantage: true,
      hasDisadvantage: false,
    }),
    ['1d4', '1d6'],
  );

  modal.onCheckRoll({ total: 21, natural: 12, modifier: 9 });

  assert.deepEqual(results, [
    { roll: 12, modifier: 9, total: 21, passed: true },
  ]);
});

it('disabled and removed Bless stop contributing and auto-fail does not roll a bonus die', () => {
  const entity = createEntity();

  entity.activeEffects[0].disabled = true;
  runtime.fixture.rolls.push(rolled(14, [12], [], []));

  const saves = runtime.useSpellSavingThrows();

  saves.rollSavingThrow({ entity, ability: 'constitution', dc: 15 });
  assert.doesNotMatch(runtime.fixture.formulas[0], /1d4/);

  entity.activeEffects = [
    createEffect('auto-fail', { flags: ['save.autoFail.constitution'] }),
    createBless(),
  ];

  assert.equal(
    saves.rollSavingThrow({ entity, ability: 'constitution', dc: 1 }).passed,
    false,
  );

  assert.equal(runtime.fixture.formulas.length, 1);
});

it('manual bonus callbacks use the replacement entity and updated ambient effects after the window opens', () => {
  const entity = createEntity('actor', { autoSaves: false });

  runtime
    .useSpellSavingThrows()
    .openSavingThrowModal(
      { entity, ability: 'constitution', dc: 16 },
      { onResult() {}, onCancel() {} },
    );

  const modal = runtime.fixture.prompts[0].props;
  const mode = { hasAdvantage: false, hasDisadvantage: false };

  assert.deepEqual(modal.evaluateBonusRollFormulas(mode), ['1d4']);
  runtime.fixture.entities[0] = { ...entity, activeEffects: [] };
  assert.deepEqual(modal.evaluateBonusRollFormulas(mode), []);
  runtime.fixture.ambient.push(createBless({ id: 'ambient-bless' }));
  assert.deepEqual(modal.evaluateBonusRollFormulas(mode), ['1d4']);
  runtime.fixture.ambient.length = 0;
  assert.deepEqual(modal.evaluateBonusRollFormulas(mode), []);
  runtime.fixture.entities[0] = entity;
  assert.deepEqual(modal.evaluateBonusRollFormulas(mode), ['1d4']);
  runtime.fixture.entities.length = 0;
  assert.deepEqual(modal.evaluateBonusRollFormulas(mode), []);
});

it('auto saves receive ambient Bless once when the same native spell is also present', () => {
  const entity = createEntity();

  runtime.fixture.ambient.push(createBless({ id: 'ambient-bless' }));
  runtime.fixture.rolls.push(rolled(17));

  runtime
    .useSpellSavingThrows()
    .rollSavingThrow({ entity, ability: 'constitution', dc: 16 });

  assert.equal(runtime.fixture.formulas[0].match(/1d4/g)?.length, 1);
  entity.activeEffects = [];
  runtime.fixture.rolls.push(rolled(17));

  runtime
    .useSpellSavingThrows()
    .rollSavingThrow({ entity, ability: 'constitution', dc: 16 });

  assert.equal(runtime.fixture.formulas[1].match(/1d4/g)?.length, 1);
});

it('foreign-owner requests include Bless in fallback and decode the kept neutral d20', async () => {
  const entity = createEntity('actor', { ownerId: 'other-player' });
  const rollData = rolled(7, [17, 2], [0]);

  runtime.fixture.outcome = {
    status: 'answered',
    result: { neutral: true, formula: '2d20kl1+2+1d4', total: 7, rollData },
  };

  const result = await runtime
    .useSpellSavingThrows()
    .resolveSavingThrowForTarget({
      entity,
      ability: 'constitution',
      dc: 8,
      sourceEntityId: 'caster',
    });

  assert.match(runtime.fixture.requests[0].fallbackFormula, /1d4/);
  assert.deepEqual(result, { roll: 2, modifier: 5, total: 7, passed: false });
  assert.equal(runtime.fixture.formulas.length, 0);
});

it('a foreign neutral answer without a kept d20 folds the action instead of throwing or rerolling', async () => {
  const entity = createEntity('actor', { ownerId: 'other-player' });
  const warnings = [];
  const originalWarn = console.warn;

  runtime.fixture.outcome = {
    status: 'answered',
    result: {
      neutral: true,
      formula: '1d6',
      total: 4,
      rollData: { dice: [{ sides: 6, values: [4], dropped: [] }] },
    },
  };

  console.warn = (...message) => warnings.push(message);

  try {
    const result = await runtime
      .useSpellSavingThrows()
      .resolveSavingThrowForTarget({
        entity,
        ability: 'constitution',
        dc: 8,
        sourceEntityId: 'caster',
      });

    assert.equal(result, null);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.equal(runtime.fixture.formulas.length, 0);
});

it('the recipient uses its own active Bless for a requested saving throw', () => {
  const entity = createEntity();

  runtime.fixture.rolls.push(rolled(17));

  const answers = [];

  assert.equal(
    runtime.promptRequestedRoll(
      {
        entityId: entity.id,
        requestId: 'remote-save',
        payload: {
          kind: runtime.SAVING_THROW_REQUEST_KIND,
          ability: 'constitution',
          dc: 16,
          againstMagic: true,
        },
      },
      {
        answer: (result) => answers.push(result),
        decline: () => assert.fail('Unexpected decline'),
        onCancelled() {},
      },
    ),
    true,
  );

  assert.deepEqual(answers, [
    { roll: 12, modifier: 5, total: 17, passed: true },
  ]);

  assert.match(runtime.fixture.formulas[0], /1d4/);
});

it('closing a manual saving throw resolves cancellation without a fabricated result', async () => {
  const entity = createEntity('actor', { autoSaves: false });

  const pending = runtime
    .useSpellSavingThrows()
    .resolveSavingThrowForTarget({ entity, ability: 'constitution', dc: 16 });

  runtime.fixture.prompts[0].props.onCancel();
  assert.equal(await pending, null);
  assert.equal(runtime.fixture.messages.length, 0);
});

it('server recurring saves add Bless without changing the selected natural d20', () => {
  const entity = createEntity();

  entity.activeEffects.push(
    createEffect('save-target', {
      recurringSave: { ability: 'constitution', dc: 16, timing: 'endOfTurn' },
    }),
  );

  const result = withDice([0.55, 0.5], () =>
    runtime.processTurnEffects(entity, 'endOfTurn'),
  );

  assert.deepEqual(
    result.saveOutcomes.map((save) => [save.roll, save.total, save.passed]),
    [[12, 17, true]],
  );

  assert.deepEqual(
    entity.activeEffects.map((effect) => effect.id),
    ['bless'],
  );
});

it('an expired Bless and a Bless removed by the preceding save do not affect later saves', () => {
  const entity = createEntity();

  entity.activeEffects[0].duration = { type: 'rounds', value: 1, remaining: 1 };

  entity.activeEffects.push(
    createEffect('save-target', {
      recurringSave: { ability: 'constitution', dc: 16, timing: 'endOfTurn' },
    }),
  );

  runtime.decrementActorEffectDurations(entity);

  const expiredResult = withDice([0.55], () =>
    runtime.processTurnEffects(entity, 'endOfTurn'),
  );

  assert.equal(expiredResult.saveOutcomes[0].total, 14);

  entity.activeEffects.unshift(
    createBless({
      recurringSave: { ability: 'constitution', dc: 1, timing: 'endOfTurn' },
    }),
  );

  const removedResult = withDice([0.55, 0.5, 0.55], () =>
    runtime.processTurnEffects(entity, 'endOfTurn'),
  );

  assert.deepEqual(
    removedResult.saveOutcomes.map((save) => save.total),
    [17, 14],
  );
});

it('server area entry saves receive Bless and keep advantage dice separate from the bonus', () => {
  const entity = createEntity();

  entity.activeEffects.push(
    createEffect('advantage', { flags: ['save.advantage.constitution'] }),
  );

  const area = createEffect('area', {
    applySave: { ability: 'constitution', dc: 22, onSuccess: 'negate' },
  });

  const result = withDice([0.2, 0.85, 0.5], () =>
    runtime.resolveEntryEffect(entity, area),
  );

  assert.deepEqual(
    [
      result.saveOutcome.roll,
      result.saveOutcome.total,
      result.saveOutcome.passed,
    ],
    [18, 23, true],
  );
});
