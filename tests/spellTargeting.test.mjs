import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeEach, it } from 'vitest';

import { hostSharedEntry } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const systemRoot = fileURLToPath(new URL('../', import.meta.url));

const require = createRequire(join(systemRoot, 'package.json'));
const { parse, compileScript } = require('@vue/compiler-sfc');
const { build } = require('esbuild');

const hostRoot = join(systemRoot, '../vttg');

const hostFixture = `
import { reactive } from 'vue';
export const fixture = reactive({ world: null, scene: null, user: { id: 'player' }, isGM: false, canPerformActions: true });
export const messages = [];
export const updates = [];
export const prompts = [];
export const socket = {};
export const worldStore = {
  get currentWorld() { return fixture.world; },
  get currentScene() { return fixture.scene; },
  get currentUser() { return fixture.user; },
  get isGM() { return fixture.isGM; },
  get canPerformActions() { return fixture.canPerformActions; },
};
export const chatStore = { getSocket: () => socket, sendMessage: (...args) => messages.push(args) };
export const modalManager = { openModal: (component, props) => { prompts.push({component, props}); return 'prompt'; } };
export const emitEntityCombatState = (_socket, entity) => updates.push(entity);
`;

const bundle = await build({
  stdin: {
    contents: `
      export * from './src/client/composables/spellEffectTargeting.ts';
      export { targetEffectsNeedResolution } from './src/client/composables/spellResolutionShared.ts';
      export { getSpellEffectTargetCount } from './src/engine/spellUtils.ts';
      export * from 'test:host';
      export { useProjectileStore } from '@/stores/projectileStore';
      export { createPinia, setActivePinia } from 'pinia';
      export { createRenderer, nextTick } from 'vue';
      export { DEFAULT_ACTOR } from './src/engine/consts.ts';
      export { default as PromptModal } from './src/client/ui/actor/ProjectilePromptModal.vue';
    `,
    resolveDir: systemRoot,
    sourcefile: 'spell-targeting-entry.ts',
    loader: 'ts',
  },
  plugins: [
    {
      name: 'test-host',
      setup(builder) {
        builder.onResolve({ filter: /^test:host$/ }, () => ({
          path: 'host',
          namespace: 'fixture',
        }));

        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: hostFixture,
          resolveDir: systemRoot,
        }));

        builder.onResolve({ filter: /^@\// }, (request) => {
          if (request.path === '@/core/mimeTypes') {
            return {
              path: join(hostRoot, 'packages/client/src/core/mimeTypes.ts'),
            };
          }

          if (request.path === '@/stores/projectileStore') {
            return {
              path: join(
                hostRoot,
                'packages/client/src/stores/projectileStore.ts',
              ),
            };
          }

          return { path: request.path, namespace: 'host-api' };
        });

        builder.onLoad({ filter: /.*/, namespace: 'host-api' }, (request) => {
          const exports = {
            '@/stores/targetStore':
              'export const useTargetStore = () => ({ targetTokenId: null });',
            '@/stores/spellTemplateStore':
              'export const useSpellTemplateStore = () => ({});',
            '@/stores/diceRollerStore':
              'export const useDiceRollerStore = () => ({ parseAndRoll: () => ({ total: 4, dice: [{ values: [4] }] }) });',
            '@/core/api/rollRequestService':
              'export const getRollRequestService = () => null;',
            '@/stores/auraStore':
              'export const useAuraStore = () => ({ getAmbientEffectsForActor: () => [] });',
            '@/stores/initiativeStore':
              'export const useInitiativeStore = () => ({ encounter: null });',
            '@/stores/worldStore':
              'export { worldStore as unused } from "test:host"; import { worldStore } from "test:host"; export const useWorldStore = () => worldStore;',
            '@/stores/chatStore':
              'import { chatStore } from "test:host"; export const useChatStore = () => chatStore;',
            '@/shared_ui/composables/useModalManager':
              'import { modalManager } from "test:host"; export const useModalManager = () => modalManager;',
            '@/core/entityUtils':
              'export { emitEntityCombatState } from "test:host"; export const resolveTokenScale = (_world, token) => token.scale; export const collectWorldEntities = (world) => [...(world?.actors ?? []), ...(world?.creatures ?? [])]; export const findEntityInWorld = (world, entityId) => collectWorldEntities(world).find((entity) => entity.id === entityId);',
          };

          if (!(request.path in exports)) {
            throw new Error(`Неожиданный импорт хоста: ${request.path}`);
          }

          return { contents: exports[request.path], resolveDir: systemRoot };
        });

        builder.onLoad({ filter: /\.vue$/ }, async (request) => {
          const { descriptor } = parse(await readFile(request.path, 'utf8'), {
            filename: request.path,
          });

          const compiled = compileScript(descriptor, {
            id: 'targeting-test',
            genDefaultAs: 'component',
          });

          return {
            contents: `${
              compiled.content
            }\ncomponent.render = () => null; export default component;`,
            loader: 'ts',
          };
        });
      },
    },
  ],
  alias: {
    '@vtt/shared/system/dnd.js': join(systemRoot, 'src/engine/index.ts'),
    '@vtt/shared': hostSharedEntry,
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

const bundlePath = join(tmpdir(), `spell-target-test-${randomUUID()}.mjs`);

await writeFile(bundlePath, bundle.outputFiles[0].text);

const runtime = await import(pathToFileURL(bundlePath).href).finally(() =>
  unlink(bundlePath),
);

const bless = {
  id: 'bless',
  name: 'Благословение',
  level: 1,
  targetType: 'creature',
  targetCount: 3,
  range: 30,
  rangeUnit: 'ft',
  deliveryType: 'none',
  saveType: 'none',
  scaling: { additionalTargets: 1 },
  activeEffects: [
    {
      id: 'bless-effect',
      name: 'Благословение',
      effectTarget: 'target',
      origin: 'spell',
      changes: [],
      flags: [],
      duration: { type: 'minutes', value: 1 },
    },
  ],
};

/** Создаёт актёра с валидным состоянием движка. */
function createActor(id, ownerIds = []) {
  const actor = structuredClone(runtime.DEFAULT_ACTOR);

  actor.system.classes = [
    {
      classKey: 'cleric',
      level: 1,
      casterType: 'full',
      spellcastingAbility: 'wisdom',
    },
  ];

  return {
    ...actor,
    id,
    name: id,
    ownerIds,
    spells: [{ ...bless, prepared: true }],
  };
}

beforeEach(() => {
  runtime.setActivePinia(runtime.createPinia());
  runtime.messages.length = 0;
  runtime.updates.length = 0;
  runtime.prompts.length = 0;

  runtime.fixture.world = {
    id: 'world',
    actors: [
      createActor('caster', ['player']),
      createActor('ally'),
      createActor('enemy'),
      createActor('third'),
      createActor('fourth'),
    ],
    creatures: [],
  };

  runtime.fixture.scene = {
    id: 'scene',
    gridSettings: {
      type: 'custom',
      cellSize: 100,
      scale: 5,
      units: 'ft',
      color: '#ffffff',
      visible: true,
    },
    tokens: ['caster', 'ally', 'enemy', 'third', 'fourth'].map(
      (actorId, index) => ({
        id: actorId,
        actorId,
        x: index * 100,
        y: 0,
        scale: 1,
        rotation: 0,
      }),
    ),
  };

  runtime.fixture.user = { id: 'player' };
  runtime.fixture.isGM = false;
  runtime.fixture.canPerformActions = true;
});

/** Запускает настоящий системный запрос и возвращает подтверждённый контекст. */
function startSelection(spell = bless) {
  let selected;

  runtime.requestSpellEffectTargets(
    spell,
    'caster',
    [1, 2],
    (level, targets) => {
      selected = { level, targets };
    },
  );

  return {
    prompt: runtime.prompts.at(-1),
    get selected() {
      return selected;
    },
    store: runtime.useProjectileStore(),
  };
}

/** Монтирует настоящий setup окна, чтобы проверить обработчики и очистку Vue. */
function mountPrompt(prompt) {
  const renderer = runtime.createRenderer({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
  });

  const application = renderer.createApp(runtime.PromptModal, {
    ...prompt.props,
    open: true,
    modalId: 'prompt',
  });

  application.mount({});

  return { application, setup: application._instance.setupState };
}

it('pROD Bless opens distinct targeting and applies effects to three foreign or own creatures', () => {
  assert.equal(runtime.needsSpellEffectTargets(bless), true);

  const selection = startSelection();

  assert.equal(selection.prompt.component, 'ProjectilePromptModal');
  assert.equal(selection.prompt.props.targetMode, 'effects');
  assert.equal(selection.store.distribution, 'distinct');

  for (const tokenId of ['caster', 'ally', 'enemy', 'third']) {
    selection.store.toggleTarget(tokenId);
  }

  assert.equal(selection.store.assignedTargets.size, 3);
  assert.equal(selection.prompt.props.onConfirm(1), true);
  assert.equal(selection.store.isActive, false);
  assert.equal(selection.selected.targets.validate(), true);
  selection.selected.targets.apply();

  assert.deepEqual(
    runtime.updates.map((entity) => entity.id),
    ['caster', 'ally', 'enemy'],
  );

  assert.equal(
    new Set(runtime.updates.map((entity) => entity.activeEffects.at(-1).id))
      .size,
    3,
  );

  selection.selected.targets.apply();
  assert.equal(runtime.updates.length, 3);
});

it('prompt supports upcasting, partial target selection, right-click removal and limit reduction', async () => {
  const selection = startSelection();
  const mounted = mountPrompt(selection.prompt);

  mounted.setup.selectedSpellLevel = 2;
  await runtime.nextTick();
  assert.equal(selection.store.maxProjectiles, 4);

  for (const tokenId of ['ally', 'enemy', 'third', 'fourth']) {
    selection.store.toggleTarget(tokenId);
  }

  selection.store.toggleTarget('fourth', false);
  mounted.setup.selectedSpellLevel = 1;
  await runtime.nextTick();
  assert.equal(selection.store.assignedTargets.size, 3);
  mounted.setup.handleConfirm();
  assert.equal(selection.selected.level, 1);
  mounted.application.unmount();
});

it('cancel and old prompt disposal never stop a restarted targeting session', async () => {
  const first = startSelection();
  const mounted = mountPrompt(first.prompt);
  const second = startSelection();

  assert.equal(first.prompt.props.onConfirm(1), false);
  await runtime.nextTick();
  mounted.application.unmount();
  assert.equal(second.store.isActive, true);

  const current = mountPrompt(second.prompt);

  current.setup.handleCancel();
  assert.equal(second.store.isActive, false);
  assert.equal(runtime.updates.length, 0);
  current.application.unmount();
});

it('same creature cannot consume multiple target slots through duplicate tokens', () => {
  runtime.fixture.scene.tokens.push({
    ...runtime.fixture.scene.tokens[1],
    id: 'ally-copy',
  });

  const selection = startSelection();

  selection.store.toggleTarget('ally');
  selection.store.toggleTarget('ally-copy');
  assert.equal(selection.store.assignedTargets.size, 1);
});

it('hidden and out-of-range tokens are rejected without requiring ownership of the target', () => {
  runtime.fixture.scene.tokens.find((token) => token.id === 'enemy').hidden =
    true;

  runtime.fixture.scene.tokens.find((token) => token.id === 'third').x = 2000;

  const selection = startSelection();

  for (const tokenId of ['ally', 'enemy', 'third']) {
    selection.store.toggleTarget(tokenId);
  }

  assert.deepEqual([...selection.store.assignedTargets.keys()], ['ally']);
});

for (const [scenario, invalidate] of [
  [
    'target removed',
    () => {
      runtime.fixture.scene.tokens = runtime.fixture.scene.tokens.filter(
        (token) => token.id !== 'ally',
      );
    },
  ],
  [
    'caster token removed',
    () => {
      runtime.fixture.scene.tokens = runtime.fixture.scene.tokens.filter(
        (token) => token.id !== 'caster',
      );
    },
  ],
  [
    'target replaced',
    () => {
      runtime.fixture.scene.tokens.find(
        (token) => token.id === 'ally',
      ).actorId = 'enemy';
    },
  ],
  [
    'target moved beyond range',
    () => {
      runtime.fixture.scene.tokens.find((token) => token.id === 'ally').x =
        2000;
    },
  ],
  [
    'target hidden',
    () => {
      runtime.fixture.scene.tokens.find((token) => token.id === 'ally').hidden =
        true;
    },
  ],
  [
    'scene changed',
    () => {
      runtime.fixture.scene.id = 'other-scene';
    },
  ],
  [
    'world changed',
    () => {
      runtime.fixture.world.id = 'other-world';
    },
  ],
  [
    'caster control revoked',
    () => {
      runtime.fixture.world.actors[0].ownerIds = [];
    },
  ],
  [
    'game paused',
    () => {
      runtime.fixture.canPerformActions = false;
    },
  ],
]) {
  it(`cast is invalidated before resource consumption when ${scenario}`, () => {
    const selection = startSelection();

    selection.store.toggleTarget('ally');
    selection.prompt.props.onConfirm(1);
    invalidate();
    assert.equal(selection.selected.targets.validate(), false);
    selection.selected.targets.apply();
    assert.equal(runtime.updates.length, 0);
  });
}

it('effects with their own damage go through the orchestrator: one write with damage and effect', async () => {
  const venom = {
    ...bless,
    id: 'venom',
    name: 'Ядовитое касание',
    targetCount: 1,
    scaling: undefined,
    activeEffects: [
      {
        ...bless.activeEffects[0],
        id: 'venom-effect',
        name: 'Яд',
        flags: ['attack.disadvantage'],
        damageParts: [{ formula: '1d4', type: 'poison', target: 'selected' }],
      },
    ],
  };

  runtime.fixture.world.actors[0].spells = [{ ...venom, prepared: true }];

  assert.equal(runtime.targetEffectsNeedResolution(bless), false);
  assert.equal(runtime.targetEffectsNeedResolution(venom), true);

  const selection = startSelection(venom);

  selection.store.toggleTarget('ally');
  assert.equal(selection.prompt.props.onConfirm(1), true);

  const hpBefore = runtime.fixture.world.actors[1].system.hitPoints.current;

  runtime.applySpellTargetEffects(
    venom,
    { casterId: 'caster', spellSaveDC: 13 },
    selection.selected.targets,
  );

  // Оркестратор асинхронный: разбор эффектов идёт до первой записи
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  assert.equal(runtime.updates.length, 1);

  const [ally] = runtime.updates;

  assert.equal(ally.id, 'ally');
  assert.equal(ally.system.hitPoints.current, hpBefore - 4);
  assert.ok(ally.activeEffects.some((effect) => effect.name === 'Яд'));

  // Цели забраны: второй вызов ничего не накладывает
  runtime.applySpellTargetEffects(
    venom,
    { casterId: 'caster', spellSaveDC: 13 },
    selection.selected.targets,
  );

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  assert.equal(runtime.updates.length, 1);
});

it('single effects use one target, while self, damage, save, area and projectile spells retain existing paths', () => {
  assert.equal(
    runtime.getSpellEffectTargetCount(
      { ...bless, targetCount: undefined, scaling: undefined },
      1,
    ),
    1,
  );

  for (const variation of [
    { activeEffects: [{ ...bless.activeEffects[0], effectTarget: 'self' }] },
    { saveType: 'wisdom' },
    { damageParts: [{ formula: '1d4', type: 'force' }] },
    { areaOfEffect: { shape: 'sphere' } },
    { projectiles: { count: 3 } },
  ]) {
    assert.equal(
      runtime.needsSpellEffectTargets({ ...bless, ...variation }),
      false,
    );
  }
});

it('final cast checks fresh regular or pact resources and respects disabled slot consumption', () => {
  const selection = startSelection();

  selection.store.toggleTarget('ally');
  selection.prompt.props.onConfirm(1);
  assert.equal(selection.selected.targets.validate(1, true, false), true);
  runtime.fixture.world.actors[0].system.spellSlotsUsed = [2];
  assert.equal(selection.selected.targets.validate(1, true, false), false);
  assert.equal(selection.selected.targets.validate(1, false, false), true);
  assert.equal(selection.selected.targets.validate(1, true, true), false);

  runtime.fixture.world.actors[0].system.classes.push({
    classKey: 'warlock',
    level: 1,
    casterType: 'pact',
  });

  assert.equal(selection.selected.targets.validate(1, true, true), true);
  runtime.fixture.world.actors[0].system.pactSlotsUsed = 1;
  assert.equal(selection.selected.targets.validate(1, true, true), false);
  runtime.fixture.world.actors[0].spells = [];
  assert.equal(selection.selected.targets.validate(1, false, false), false);
});

it('the actual actor-sheet cast handler opens Bless targets before ordinary confirmation', async () => {
  const actor = runtime.fixture.world.actors[0];

  let continued;

  const castSpell = await loadHandler(
    'src/client/ui/actor/tabs/ActorSpellsTab.vue',
    'castSpell',
    {
      props: { actor },
      getCastableSpellLevels: () => [1, 2],
      needsSpellEffectTargets: runtime.needsSpellEffectTargets,
      requestSpellEffectTargets: runtime.requestSpellEffectTargets,
      proceedWithCastSpell: (spell, level, targets) => {
        continued = { spell, level, targets };
      },
    },
  );

  castSpell(bless);

  const prompt = runtime.prompts.at(-1);

  assert.equal(prompt.props.targetMode, 'effects');
  runtime.useProjectileStore().toggleTarget('enemy');
  prompt.props.onConfirm(1);
  assert.equal(continued.spell.id, bless.id);
  continued.targets.apply();

  assert.deepEqual(
    runtime.updates.map((entity) => entity.id),
    ['enemy'],
  );
});

it('the actual hotbar spell executor opens the same target selection and passes it to buff resolution', async () => {
  const actor = runtime.fixture.world.actors[0];

  let continued;

  const castMacro = await loadHandler(
    'src/client/macros/dnd5eMacros.ts',
    'spell-cast',
    {
      console,
      isDnDActorEntity: (entity) => entity?.entityType === 'actor',
      findSpell: () => ({ spell: bless, actor }),
      getAvailableSpellLevels: () => [1, 2],
      needsSpellEffectTargets: runtime.needsSpellEffectTargets,
      requestSpellEffectTargets: runtime.requestSpellEffectTargets,
      castBuffSpellMacro: (spell, caster, level, targets) => {
        continued = { spell, caster, level, targets };
      },
    },
    true,
  );

  castMacro({ ref: 'bless' }, { actor, actors: [actor] });

  const prompt = runtime.prompts.at(-1);

  assert.equal(prompt.props.targetMode, 'effects');
  runtime.useProjectileStore().toggleTarget('ally');
  prompt.props.onConfirm(1);
  continued.targets.apply();

  assert.deepEqual(
    runtime.updates.map((entity) => entity.id),
    ['ally'],
  );
});

for (const invalidate of [false, true]) {
  it(`real DiceRoll handler ${invalidate ? 'blocks stale' : 'applies valid'} targets before slot consumption`, async () => {
    const selection = startSelection();

    selection.store.toggleTarget('ally');
    selection.prompt.props.onConfirm(1);
    let consumed = 0;

    const isOpen = { value: true };
    const actor = runtime.fixture.world.actors[0];

    if (invalidate) {
      actor.system.spellSlotsUsed = [2];
    }

    const performRoll = await loadHandler(
      'src/client/ui/actor/DiceRollModal.vue',
      'performRoll',
      {
        console,
        hasRolled: false,
        props: {
          beforeRoll: selection.selected.targets.validate,
          skipRoll: true,
          onSpellSlotConsume: () => {
            consumed += 1;
            actor.system.spellSlotsUsed = [2];
          },
          onRoll: () => selection.selected.targets.apply(),
        },
        isOpen,
        selectedSpellLevel: { value: 1 },
        consumeSpellSlot: { value: true },
        usePactSlot: { value: false },
        hasSpellCast: { value: true },
        rollType: { value: 'public' },
        resolvedDamageType: { value: undefined },
        chatStore: { isPrivateRoll: false, isGmOnlyRoll: false },
        DICE_ROLL_LOG_PREFIX: 'test-cast',
      },
    );

    performRoll();
    assert.equal(consumed, invalidate ? 0 : 1);
    assert.equal(runtime.updates.length, invalidate ? 0 : 1);
    assert.equal(isOpen.value, invalidate);
  });
}

it('an old prompt mounted after a restart cannot take ownership of the newer selection', () => {
  const first = startSelection();
  const second = startSelection();
  const delayed = mountPrompt(first.prompt);

  delayed.setup.handleCancel();
  delayed.application.unmount();
  assert.equal(second.store.isActive, true);
});

it('a scene change or unmount cancels unfinished selection without applying effects', async () => {
  const selection = startSelection();
  const mounted = mountPrompt(selection.prompt);

  selection.store.toggleTarget('ally');
  runtime.fixture.scene.id = 'new-scene';
  await runtime.nextTick();
  assert.equal(selection.store.isActive, false);
  mounted.application.unmount();
  assert.equal(selection.selected, undefined);
  assert.equal(runtime.updates.length, 0);
});

for (const relativePath of [
  'src/client/ui/actor/tabs/ActorSpellsTab.vue',
  'src/client/macros/dnd5eMacros.ts',
]) {
  it(`obsolete projectile DiceRoll cannot consume a slot after Bless starts (${relativePath})`, async () => {
    const projectileStore = runtime.useProjectileStore();

    projectileStore.startTargeting(null, 3);

    const isCurrentProjectileCast = await loadHandler(
      relativePath,
      'isCurrentProjectileCast',
      {
        hasProjectiles: true,
        projectileStore,
        createProjectileCastValidator: runtime.createProjectileCastValidator,
      },
    );

    assert.equal(isCurrentProjectileCast(), true);

    const selection = startSelection();

    selection.store.toggleTarget('ally');
    assert.equal(isCurrentProjectileCast(), false);
    let consumed = 0;

    const performRoll = await loadHandler(
      'src/client/ui/actor/DiceRollModal.vue',
      'performRoll',
      {
        hasRolled: false,
        props: {
          beforeRoll: isCurrentProjectileCast,
          onSpellSlotConsume: () => {
            consumed += 1;
          },
        },
        selectedSpellLevel: { value: 1 },
        consumeSpellSlot: { value: true },
        usePactSlot: { value: false },
      },
    );

    performRoll();
    assert.equal(consumed, 0);
    assert.equal(selection.store.isActive, true);
    assert.equal(selection.store.assignedProjectilesCount, 1);
  });
}

it('closing an obsolete actor-sheet DiceRoll preserves the new Bless session and removes its unload listener', async () => {
  const relativePath = 'src/client/ui/actor/tabs/ActorSpellsTab.vue';
  const projectileStore = runtime.useProjectileStore();

  projectileStore.startTargeting(null, 3);

  const isCurrentProjectileCast = await loadHandler(
    relativePath,
    'isCurrentProjectileCast',
    {
      hasProjectiles: true,
      projectileStore,
      createProjectileCastValidator: runtime.createProjectileCastValidator,
    },
  );

  const handleUnload = await loadHandler(relativePath, 'handleUnload', {
    isApplied: false,
    hasProjectiles: true,
    isCurrentProjectileCast,
    projectileStore,
    templateId: undefined,
  });

  const removed = [];

  const handleModalClose = await loadHandler(relativePath, 'handleModalClose', {
    handleUnload,
    window: {
      removeEventListener: (...argumentsList) => removed.push(argumentsList),
    },
  });

  const selection = startSelection();

  selection.store.toggleTarget('enemy');
  handleModalClose(false);
  assert.equal(removed.length, 1);
  assert.equal(removed[0][0], 'beforeunload');
  assert.equal(removed[0][1], handleUnload);
  assert.equal(selection.store.isActive, true);
  assert.equal(selection.store.assignedProjectilesCount, 1);
  selection.prompt.props.onConfirm(1);
  selection.selected.targets.apply();

  assert.deepEqual(
    runtime.updates.map((entity) => entity.id),
    ['enemy'],
  );
});

it('the actual modal manager keeps a new Bless cast independent from an unfinished projectile roll', async () => {
  const managerPath =
    '../vttg/packages/client/src/shared_ui/composables/useModalManager.ts';

  const modals = { value: [] };
  const getModalKey = await loadHandler(managerPath, 'getModalKey', {});

  const openModal = await loadHandler(managerPath, 'openModal', {
    modals,
    getModalKey,
    getNextZIndex: () => modals.value.length + 1,
    bringToFront: () => {},
    clearTimeout,
  });

  openModal('DiceRollModal', { beforeRoll: () => false });

  const selection = startSelection();

  selection.store.toggleTarget('ally');
  selection.prompt.props.onConfirm(1);

  const castBuff = await loadHandler(
    'src/client/macros/dnd5eMacros.ts',
    'castBuffSpellMacro',
    {
      prepareCasterSpellEffects: () => [],
      completeSpellCast: () => {},
      beginSpellCast: () => {},
      resolveSpellcastingAbility: () => 'wisdom',
      resolveActorStats: () => ({ abilityMods: {} }),
      resolveSpellSaveDC: () => 13,
      useWorldStore: () => runtime.worldStore,
      useChatStore: () => runtime.chatStore,
      useModalManager: () => ({ openModal }),
      getPactSlotInfo: () => ({ level: 0 }),
      computeAvailableLevels: () => [1],
      SPELL_MENU_LABELS: { cast: 'Применить' },
      SPELL_CAST_MODAL_KEY_PREFIX: 'spell-cast',
      SPELL_CAST_KEY_PREFIX: 'cast',
      generateId: () => randomUUID(),
    },
  );

  castBuff(
    bless,
    runtime.fixture.world.actors[0],
    1,
    selection.selected.targets,
  );

  assert.equal(modals.value.length, 2);
  assert.equal(modals.value[0].props.beforeRoll(), false);
  assert.equal(modals.value[1].props.beforeRoll(1, true, false), true);
  assert.equal(modals.value[1].props.rollLabel, bless.name);

  castBuff(
    bless,
    runtime.fixture.world.actors[0],
    1,
    selection.selected.targets,
  );

  assert.equal(modals.value.length, 3);
});

for (const [changedField, changes] of [
  ['effects', { activeEffects: [] }],
  ['range', { range: 0 }],
  ['target count', { targetCount: 1 }],
  ['scaling', { scaling: { additionalTargets: 0 } }],
]) {
  it(`changed spell ${changedField} invalidates captured targets before resources are consumed`, () => {
    const selection = startSelection();

    selection.store.toggleTarget('ally');
    selection.prompt.props.onConfirm(1);

    const caster = runtime.fixture.world.actors[0];
    const originalSlots = [...caster.system.spellSlotsUsed];

    caster.spells = [{ ...caster.spells[0], ...changes }];
    assert.equal(selection.selected.targets.validate(1, true, false), false);
    selection.selected.targets.apply();
    assert.equal(runtime.updates.length, 0);
    assert.deepEqual(caster.system.spellSlotsUsed, originalSlots);
  });
}

it('spent spell uses do not invalidate already confirmed effects and preparation remains a resource gate', () => {
  const caster = runtime.fixture.world.actors[0];

  const innateSpell = {
    ...bless,
    prepared: true,
    uses: { max: 1, current: 1, recovery: 'longRest' },
  };

  caster.spells = [innateSpell];

  const selection = startSelection(innateSpell);

  selection.store.toggleTarget('ally');
  selection.prompt.props.onConfirm(1);
  assert.equal(selection.selected.targets.validate(1, false, false), true);
  caster.spells[0].prepared = false;
  assert.equal(selection.selected.targets.validate(1, false, false), false);
  caster.spells[0].prepared = true;
  caster.spells[0].uses.current = 0;
  assert.equal(selection.selected.targets.validate(1, false, false), false);
  assert.equal(selection.selected.targets.validate(), true);
  selection.selected.targets.apply();
  assert.equal(runtime.updates.length, 1);
});

for (const [kind, instantSpell] of [
  ['cantrip', { ...bless, level: 0 }],
  ['innate', { ...bless, uses: { max: 1, current: 1, recovery: 'longRest' } }],
]) {
  it(`the actual instant ${kind} cast releases its unload listener without opening a roll window`, async () => {
    const listeners = new Set();

    let appliedTargets = 0;

    const continueSpellCast = await loadHandler(
      'src/client/ui/actor/tabs/ActorSpellsTab.vue',
      'continueSpellCast',
      {
        props: { actor: runtime.fixture.world.actors[0] },
        handleSpellSlotConsume() {},
        getTotalLevel: () => 1,
        getSpellProjectileCount: () => 0,
        useProjectileStore: runtime.useProjectileStore,
        createProjectileCastValidator: runtime.createProjectileCastValidator,
        targetStore: { getTargetActor: () => null },
        isRecord: () => false,
        isDndSceneEntity: () => false,
        pickCantripTierParts: () => [],
        getSpellDamageParts: () => [],
        resolvedStats: { value: { damageBonuses: { spell: 0 } } },
        spellIsHealing: () => false,
        withFlatFormulaBonus: (formula) => formula,
        resolveSpellDamageFormula: () => '',
        collectEffectsWithAuras: () => [],
        hasSpellBonusDamage: () => false,
        getTargetSpellEffects: (spell) => spell.activeEffects,
        targetEffectsNeedResolution: runtime.targetEffectsNeedResolution,
        spellTargetEffectsSource: () => ({
          casterId: 'caster',
          spellSaveDC: 13,
        }),
        needsAutoResolution: () => false,
        getSpellAttackType: () => undefined,
        applyCasterSpellEffects() {},
        applySpellTargetEffects: runtime.applySpellTargetEffects,
        spellCasterSource: () => ({ saveDc: 13, spellMod: 3 }),
        completeSpellCast: () => {},
        beginSpellCast: () => {},
        generateId: (prefix) => `${prefix}_test`,
        SPELL_CAST_KEY_PREFIX: 'cast',
        useSpellTemplateStore: () => ({
          getPlacedTemplate: () => undefined,
          removePlacedTemplate() {},
          deleteTemplate() {},
        }),
        openModal: () =>
          assert.fail('Instant cast must not open a dice window'),
        window: {
          addEventListener: (event, listener) => {
            assert.equal(event, 'beforeunload');
            listeners.add(listener);
          },
          removeEventListener: (event, listener) => {
            assert.equal(event, 'beforeunload');
            listeners.delete(listener);
          },
        },
      },
    );

    for (let i = 0; i < 2; i++) {
      continueSpellCast(instantSpell, undefined, instantSpell.level, {
        apply: () => {
          appliedTargets++;
        },
      });

      assert.equal(listeners.size, 0);
    }

    assert.equal(appliedTargets, 2);
  });
}
