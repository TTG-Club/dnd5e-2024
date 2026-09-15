import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/attackUtils.ts'; export * from './src/engine/effectPipeline.ts'; export * from './src/engine/consts.ts'; export * from './src/engine/formulaParser.ts'; export * from './src/engine/hitPoints.ts';",
);

const macroPath = 'src/client/macros/dnd5eMacros.ts';
const resolverPath = 'src/client/composables/useSpellResolution.ts';
const normalContext = { hasAdvantage: false, hasDisadvantage: false };

/** Изолирует вычисление формул: тестируется выбор ключа и актуального носителя обработчиком. */
function buildRollBonusEvaluator(getEntity, key) {
  return () => getEntity()?.bonuses?.[key] ?? [];
}

/** Различающиеся бонусы выявляют смешивание spell с melee/ranged. */
function createEntity() {
  return {
    id: 'caster',
    entityType: 'actor',
    system: {},
    bonuses: {
      'attack.melee': ['1d4'],
      'attack.ranged': ['1d6'],
      'attack.spell': ['1d8'],
      'save.wisdom': ['1d10'],
    },
  };
}

/** Незатронутые части урона служат границей проверяемого обработчика. */
function createRollSetup() {
  return {
    baseParts: [{ formula: '1d6', target: 'selected', isHealing: false }],
    pseudoSpell: {},
  };
}

/** Порты подготовки броска без настоящего окна и записи урона. */
function createPorts(current) {
  const rollConfig = { value: null };

  const ports = {
    buildRollBonusEvaluator,
    props: { entity: current.value, actor: current.value, isEditMode: false },
    rollConfig,
    isRollModalOpen: { value: false },
    getCreatureEntity: () => current.value,
    findCurrentDndEntity: () => current.value,
    collectActiveEffects: () => [],
    resolveActorStats: () => ({ activeFlags: new Set() }),
    resolvedStats: { value: { activeFlags: new Set() } },
    combinedEffects: { value: [] },
    targetStore: { getTargetActor: () => null },
    useTargetStore: () => ({ getTargetFlags: () => new Set() }),
    useModalManager: () => ({
      openModal: (_name, props) => {
        rollConfig.value = props;
      },
    }),
    useBonusDamageParts: () => ({
      buildCreatureRollSetup: createRollSetup,
      buildCreatureSpellRollSetup: createRollSetup,
      buildWeaponRollSetup: createRollSetup,
      buildTargetHpContext: () => undefined,
      buildTargetTypeContext: () => undefined,
    }),
    buildWeaponRollSetup: createRollSetup,
    buildCreatureRollSetup: createRollSetup,
    buildCreatureSpellRollSetup: createRollSetup,
    buildTargetHpContext: () => undefined,
    getAttackBonusKey: engine.getAttackBonusKey,
    getDamageBonusKey: engine.getDamageBonusKey,
    calculateWeaponAttackModifier: () => 5,
    getWeaponPrimaryDamageType: () => undefined,
    resolveAttackRollMode: () => 'normal',
    isDndSceneEntity: () => true,
    actionHasSave: (action) => !!action.saveType && action.saveType !== 'none',
    actionPrimaryType: () => undefined,
    spellPrimaryType: () => undefined,
    getSpellAttackType: (spell) => spell.deliveryType,
    calculateCreatureSpellBlockNumbers: () => ({ attackBonus: 5, saveDC: 13 }),
    getCreatureSpellBlockAbility: () => 'wisdom',
    getCreatureSpellMod: () => 2,
    getCreatureSpellRollButtonText: () => 'roll',
    generateId: (prefix) => `${prefix}_test`,
    SPELL_CAST_KEY_PREFIX: 'cast',
    DEFAULT_CREATURE_SPELL_SAVE_DC: 10,
    readSpellOwnSaveDC: () => undefined,
    completeSpellCast: () => {},
    spellIsHealing: () => false,
    describeDamagePart: () => ({ types: [] }),
    CREATURE_ACTIONS_BLOCK_LABELS: { attackRollPrefix: 'Attack ' },
    CREATURE_ACTION_MENU_LABELS: { attack: 'attack' },
    SPELL_DAMAGE_ROLL_BUTTON: 'roll',
  };

  return ports;
}

for (const rangeType of ['melee', 'ranged']) {
  it(`actual equipment sheet forwards only ${rangeType} attack dice and keeps the source reactive`, async () => {
    const current = { value: createEntity() };
    const ports = createPorts(current);

    const handler = await loadHandler(
      'src/client/ui/actor/tabs/ActorEquipmentTab.vue',
      'openRollModal',
      ports,
    );

    const weapon = {
      name: 'Weapon',
      rangeType,
      damageParts: [{ formula: '1d6' }],
    };

    handler(weapon);

    assert.deepEqual(
      ports.rollConfig.value.evaluateBonusRollFormulas(normalContext),
      current.value.bonuses[`attack.${rangeType}`],
    );

    ports.props.entity = { ...current.value, bonuses: {} };

    assert.deepEqual(
      ports.rollConfig.value.evaluateBonusRollFormulas(normalContext),
      [],
    );

    handler({ ...weapon, saveType: 'dexterity' });
    assert.equal(ports.rollConfig.value.evaluateBonusRollFormulas, undefined);
  });
}

for (const entry of [
  ['src/client/ui/creature/CreatureActionsBlock.vue', 'startActionRoll', false],
  [macroPath, 'openCreatureActionRoll', true],
]) {
  it(`actual ${entry[1]} uses current creature effects and disables attack dice for saving-throw actions`, async () => {
    const current = { value: createEntity() };
    const ports = createPorts(current);
    const handler = await loadHandler(entry[0], entry[1], ports);
    const creature = current.value;

    for (const rangeType of ['melee', 'ranged']) {
      const action = {
        name: 'Action',
        attackBonus: 5,
        rangeType,
        damageParts: [{ formula: '1d6' }],
      };

      handler(
        ...(entry[2]
          ? [creature, action, false, undefined]
          : [action, creature, false, undefined]),
      );

      assert.deepEqual(
        ports.rollConfig.value.evaluateBonusRollFormulas(normalContext),
        creature.bonuses[`attack.${rangeType}`],
      );

      current.value = undefined;

      assert.deepEqual(
        ports.rollConfig.value.evaluateBonusRollFormulas(normalContext),
        [],
      );

      current.value = creature;

      const saveAction = { ...action, saveType: 'dexterity' };

      handler(
        ...(entry[2]
          ? [creature, saveAction, false, undefined]
          : [saveAction, creature, false, undefined]),
      );

      assert.equal(ports.rollConfig.value.evaluateBonusRollFormulas, undefined);
    }
  });
}

for (const entry of [
  ['src/client/ui/creature/CreatureSpellsBlock.vue', 'startSpellRoll', false],
  [macroPath, 'openCreatureSpellRoll', true],
]) {
  it(`actual ${entry[1]} applies only attack.spell and follows effect changes`, async () => {
    const current = { value: createEntity() };
    const ports = createPorts(current);
    const handler = await loadHandler(entry[0], entry[1], ports);
    const creature = current.value;

    const spell = {
      name: 'Spell',
      deliveryType: 'ranged',
      damageParts: [{ formula: '1d6' }],
    };

    handler(
      ...(entry[2]
        ? [creature, spell, undefined, undefined]
        : [spell, creature, undefined, undefined]),
    );

    assert.deepEqual(
      ports.rollConfig.value.evaluateBonusRollFormulas(normalContext),
      ['1d8'],
    );

    current.value = { ...creature, bonuses: {} };

    assert.deepEqual(
      ports.rollConfig.value.evaluateBonusRollFormulas(normalContext),
      [],
    );

    const saveSpell = { ...spell, saveType: 'wisdom' };

    handler(
      ...(entry[2]
        ? [creature, saveSpell, undefined, undefined]
        : [saveSpell, creature, undefined, undefined]),
    );

    assert.equal(ports.rollConfig.value.evaluateBonusRollFormulas, undefined);
  });
}

for (const relativePath of [
  'src/client/ui/actor/ActorLeftPanel.vue',
  'src/client/ui/creature/CreatureSheet.vue',
]) {
  it(`actual manual save in ${relativePath} uses save ability and current effects`, async () => {
    const current = { value: createEntity() };
    const ports = createPorts(current);

    let config;

    Object.assign(ports, {
      localCreature: current,
      isEditMode: { value: false },
      openDiceRoll: (next) => {
        config = next;
      },
      calculateSavingThrow: () => 3,
      resolveSavingThrowRollMode: () => 'normal',
      SAVING_THROW_ROLL_LABELS: {
        titlePrefix: 'Save ',
        rollPrefix: 'Save ',
        button: 'roll',
      },
    });

    const handler = await loadHandler(
      relativePath,
      'handleSavingThrowClick',
      ports,
    );

    handler({ key: 'wisdom', label: 'Wisdom' });
    assert.deepEqual(config.evaluateBonusRollFormulas(normalContext), ['1d10']);
    current.value = { ...current.value, bonuses: {} };
    ports.props.actor = current.value;
    assert.deepEqual(config.evaluateBonusRollFormulas(normalContext), []);
  });
}

it('macro source lookup reads a replaced entity and returns no stale source after removal', async () => {
  let current = createEntity();

  const lookup = await loadHandler(macroPath, 'findCurrentDndEntity', {
    useWorldEntities: () => ({
      findCurrentWorldEntity: (entityId) =>
        current?.id === entityId ? current : undefined,
    }),
    isDndSceneEntity: (entity) => entity.entityType === 'actor',
  });

  const original = current;

  assert.equal(lookup('caster'), original);
  current = { ...original, bonuses: {} };
  assert.equal(lookup('caster'), current);
  current = undefined;
  assert.equal(lookup('caster'), undefined);
});

for (const relativePath of [
  'src/client/ui/actor/tabs/ActorSpellsTab.vue',
  macroPath,
]) {
  it(`actual projectile callback in ${relativePath} preserves the captured bonus formulas`, async () => {
    let forwarded;

    const entity = createEntity();

    const worldStore = {
      currentScene: { tokens: [] },
      connectionState: { currentWorldId: 'world' },
      worlds: [{ id: 'world', actors: [entity] }],
    };

    const handler = await loadHandler(
      relativePath,
      'handleProjectileAttackRoll',
      {
        spell: { name: 'Ray' },
        actor: entity,
        props: { actor: entity },
        incomingAttackType: 'ranged',
        getSpellAttackType: () => 'ranged',
        isApplied: false,
        window: { removeEventListener() {} },
        handleUnload() {},
        worldStore,
        getCurrentWorldEntities: () => [entity],
        getWorldSocket: () => ({}),
        useChatStore: () => ({ getSocket: () => ({}) }),
        evaluateSpellBonusParts: undefined,
        withFlatDamageBonusPart: (parts) => parts,
        spellIsHealing: () => false,
        flatSpellDamageBonus: 0,
        resolveSpellDamage: (_context, options) => {
          forwarded = options.projectileAttack;
        },
        resolveSpellSaveDC: () => 13,
        spellSaveDc: 13,
        resolvedStats: { spellSaveDC: 13, value: {} },
        resolvedDamageFormula: '1d6',
      },
    );

    const formulas = new Map([['target', Object.freeze(['1d4'])]]);

    handler({
      attackModifier: 5,
      rollMode: 'advantage',
      bonusDiceFormulasByTarget: formulas,
    });

    assert.equal(forwarded.bonusDiceFormulasByTarget, formulas);
    assert.equal(forwarded.rollMode, 'advantage');
  });
}

it('actual projectile series rolls attack bonus per beam and preserves natural critical rules under advantage', async () => {
  const first = { id: 'first', name: 'First', armorClass: 17 };
  const second = { id: 'second', name: 'Second', armorClass: 8 };

  const projectileStore = {
    isActive: true,
    assignedTargets: new Map([
      ['one', 2],
      ['two', 1],
    ]),
    assignedProjectilesCount: 3,
    stopTargeting() {
      this.isActive = false;
    },
  };

  const attacks = [
    { values: [2, 20], dropped: [0], bonus: 1 },
    { values: [16, 3], dropped: [1], bonus: 4 },
    { values: [1, 1], dropped: [1], bonus: 4 },
  ];

  const rolledFormulas = [];
  const chatRolls = [];
  const applied = [];

  const diceStore = {
    parseAndRoll(formula) {
      rolledFormulas.push(formula);

      if (formula.includes('20')) {
        const sample = attacks.shift();

        const kept = sample.values.find(
          (_value, index) => !sample.dropped.includes(index),
        );

        return {
          formula,
          total: kept + 5 + sample.bonus,
          details: '',
          dice: [
            { sides: 20, values: sample.values, dropped: sample.dropped },
            { sides: 4, values: [sample.bonus], dropped: [] },
          ],
        };
      }

      return {
        formula,
        total: formula.startsWith('2') ? 9 : 5,
        dice: [],
        details: '',
      };
    },
    animateRoll() {},
  };

  const handler = await loadHandler(
    resolverPath,
    'resolveProjectileAttackSeries',
    {
      ...engine,
      useProjectileStore: () => projectileStore,
      useDiceRollerStore: () => diceStore,
      isDndSceneEntity: () => true,
      resolveActorStats: (entity) => ({
        armorClass: entity.armorClass,
        activeFlags: new Set(),
      }),
      evaluateDefensiveACBonus: () => 0,
      collectActiveEffects: () => [],
      chatStore: {
        sendMessage: (_formula, _kind, roll) => chatRolls.push(roll),
      },
      resolveEntityCurrentHp: () => 100,
      processTarget: (entity, context) => {
        applied.push({ entityId: entity.id, damage: context.damageTotal });

        return { actorName: entity.name, damageApplied: context.damageTotal };
      },
      sendAoeSummary() {},
      SPELL_NO_TARGETS_LABELS: { noTarget: 'none' },
    },
  );

  handler(
    { spell: { name: 'Rays' }, actors: [first, second] },
    {
      attack: {
        attackModifier: 5,
        rollMode: 'advantage',
        attackType: 'ranged',
        bonusDiceFormulasByTarget: new Map([
          ['one', ['1d4']],
          ['two', ['1d4']],
        ]),
      },
      resolvedDamageFormula: '1d6',
      scene: {
        tokens: [
          { id: 'one', actorId: 'first' },
          { id: 'two', actorId: 'second' },
        ],
      },
    },
  );

  assert.equal(
    rolledFormulas.filter((formula) => formula.includes('1d4')).length,
    3,
  );

  assert.deepEqual(
    rolledFormulas.filter((formula) => !formula.includes('20')),
    ['2d6', '1d6'],
  );

  assert.deepEqual(applied, [{ entityId: 'first', damage: 14 }]);
  assert.equal(chatRolls.length, 3);
  assert.equal(projectileStore.isActive, false);
});

it('registered weapon macro selects melee/ranged dice from the fresh actor and omits them for save-based weapons', async () => {
  const current = { value: createEntity() };
  const ports = createPorts(current);

  let weapon;

  Object.assign(ports, {
    useChatStore: () => ({ getSocket: () => ({}) }),
    useTargetStore: () => ports.targetStore,
    useAuraStore: () => ({ getAmbientEffectsForActor: () => [] }),
    isDnDActorEntity: () => true,
    findWeapon: () => ({ actor: current.value, weapon }),
    isDnDEffect: () => true,
    combineEffectsWithAmbient: () => [],
    isTargetFullHp: () => undefined,
    console: { warn: assert.fail, error: assert.fail },
  });

  const handler = await loadHandler(macroPath, 'weapon-attack', ports, true);

  for (const rangeType of ['melee', 'ranged']) {
    weapon = { name: 'Weapon', rangeType, damageParts: [{ formula: '1d6' }] };

    handler(
      { ref: 'weapon' },
      { actor: current.value, actors: [current.value] },
    );

    const evaluate = ports.rollConfig.value.evaluateBonusRollFormulas;

    assert.deepEqual(
      evaluate(normalContext),
      current.value.bonuses[`attack.${rangeType}`],
    );

    const prior = current.value;

    current.value = { ...prior, bonuses: {} };
    assert.deepEqual(evaluate(normalContext), []);
    current.value = prior;
    weapon = { ...weapon, saveType: 'dexterity' };

    handler(
      { ref: 'weapon' },
      { actor: current.value, actors: [current.value] },
    );

    assert.equal(ports.rollConfig.value.evaluateBonusRollFormulas, undefined);
  }
});

it('projectile attack bonuses follow each assigned target instead of the unrelated selected token', async () => {
  const caster = structuredClone(engine.DEFAULT_ACTOR);

  const effects = {
    value: [
      {
        id: 'injured-bonus',
        name: 'Injured bonus',
        disabled: false,
        changes: [
          {
            key: 'attack.spell',
            mode: 'add',
            value: '1d4',
            priority: 20,
            condition: 'target.hp.value < target.hp.max',
          },
        ],
        flags: [],
      },
    ],
  };

  const first = {
    ...structuredClone(engine.DEFAULT_ACTOR),
    id: 'first',
    name: 'Injured',
    armorClass: 10,
  };

  const second = {
    ...structuredClone(engine.DEFAULT_ACTOR),
    id: 'second',
    name: 'Full',
    armorClass: 10,
  };

  first.system.hitPoints = { ...first.system.hitPoints, current: 5, max: 10 };

  second.system.hitPoints = {
    ...second.system.hitPoints,
    current: 10,
    max: 10,
  };

  const selected = { ...structuredClone(second), id: 'unrelated' };

  const scene = {
    tokens: [
      { id: 'one', actorId: 'first' },
      { id: 'two', actorId: 'second' },
    ],
  };

  const worldState = { scene, entities: [first, second, selected] };

  const projectileStore = {
    isActive: true,
    assignedTargets: new Map([
      ['one', 1],
      ['two', 1],
    ]),
    assignedProjectilesCount: 2,
    stopTargeting() {
      this.isActive = false;
    },
  };

  const buildTargetHpContext = await loadHandler(
    'src/client/composables/useBonusDamageParts.ts',
    'buildTargetHpContext',
    {
      ...engine,
      targetStore: { getTargetActor: () => selected },
      isDndSceneEntity: () => true,
      isActorEntity: (entity) => entity.entityType === 'actor',
      isCreatureEntity: (entity) => entity.entityType === 'creature',
      resolveEntityCreatureType: () => 'humanoid',
    },
  );

  const evaluatorPorts = {
    ...engine,
    computed: (getter) => ({
      get value() {
        return getter();
      },
    }),
    useResolvedStats: () => ({ combinedEffects: effects }),
    useBonusDamageParts: () => ({ buildTargetHpContext }),
    useProjectileStore: () => projectileStore,
    useWorldStore: () => ({ currentScene: worldState.scene }),
    useWorldEntities: () => ({
      getCurrentWorldEntities: () => worldState.entities,
    }),
    isDndSceneEntity: () => true,
  };

  const buildEvaluator = await loadHandler(
    'src/client/composables/rollBonusEvaluator.ts',
    'buildRollBonusEvaluator',
    evaluatorPorts,
  );

  const evaluateBonuses = buildEvaluator(() => caster, 'attack.spell');

  const collectBonuses = await loadHandler(
    'src/client/composables/rollBonusEvaluator.ts',
    'collectProjectileRollBonuses',
    evaluatorPorts,
  );

  assert.deepEqual([...evaluateBonuses(normalContext)], []);

  const bonusesByTarget = collectBonuses(normalContext, evaluateBonuses);

  selected.system.hitPoints.current = 1;
  assert.deepEqual([...evaluateBonuses(normalContext)], ['1d4']);

  assert.deepEqual(
    [...evaluateBonuses({ ...normalContext, target: undefined })],
    [],
  );

  assert.deepEqual(
    [...collectBonuses(normalContext, evaluateBonuses).get('two')],
    [],
  );

  const recovered = structuredClone(first);

  recovered.system.hitPoints.current = 10;
  worldState.entities = [recovered, second];

  assert.deepEqual(
    [...collectBonuses(normalContext, evaluateBonuses).get('one')],
    [],
  );

  worldState.entities = [second];

  assert.equal(
    collectBonuses(normalContext, evaluateBonuses).has('one'),
    false,
  );

  projectileStore.isActive = false;
  assert.equal(collectBonuses(normalContext, evaluateBonuses).size, 0);
  projectileStore.isActive = true;
  worldState.scene = null;
  assert.equal(collectBonuses(normalContext, evaluateBonuses).size, 0);
  worldState.scene = scene;
  worldState.entities = [first, second, selected];

  // Снятие эффекта после снимка не отбирает бонус начатой серии атак.
  effects.value = [];

  const formulas = [];

  const handler = await loadHandler(
    resolverPath,
    'resolveProjectileAttackSeries',
    {
      ...engine,
      useProjectileStore: () => projectileStore,
      useDiceRollerStore: () => ({
        parseAndRoll(formula) {
          formulas.push(formula);

          return {
            formula,
            total: 6,
            details: '',
            dice: [{ sides: 20, values: [1], dropped: [] }],
          };
        },
      }),
      isDndSceneEntity: () => true,
      resolveActorStats: (entity) => ({
        armorClass: entity.armorClass,
        activeFlags: new Set(),
      }),
      collectActiveEffects: () => [],
      evaluateDefensiveACBonus: () => 0,
      chatStore: { sendMessage() {} },
      resolveEntityCurrentHp: () => 10,
      sendAoeSummary() {},
      SPELL_NO_TARGETS_LABELS: { noTarget: 'none' },
    },
  );

  handler(
    { spell: { name: 'Rays' }, actors: [first, second] },
    {
      attack: {
        attackModifier: 5,
        rollMode: 'normal',
        attackType: 'ranged',
        bonusDiceFormulasByTarget: bonusesByTarget,
      },
      resolvedDamageFormula: '',
      scene,
    },
  );

  assert.deepEqual(formulas, ['1к20+5+1d4', '1к20+5']);
});

it('the shared target context reads creature average HP through the combat HP helpers', async () => {
  const target = structuredClone(engine.DEFAULT_CREATURE);

  target.system.hitPoints = { average: 12 };

  const readContext = await loadHandler(
    'src/client/composables/useBonusDamageParts.ts',
    'buildTargetHpContext',
    {
      ...engine,
      isDndSceneEntity: () => true,
      resolveEntityCreatureType: () => 'humanoid',
      targetStore: { getTargetActor: () => null },
    },
  );

  assert.deepEqual(
    { ...readContext(target) },
    { currentHp: 12, maxHp: 12, creatureType: 'humanoid', markedBy: [] },
  );

  target.system.hitPoints.current = 5;

  assert.deepEqual(
    { ...readContext(target) },
    { currentHp: 5, maxHp: 12, creatureType: 'humanoid', markedBy: [] },
  );

  assert.equal(readContext(), undefined);
});
