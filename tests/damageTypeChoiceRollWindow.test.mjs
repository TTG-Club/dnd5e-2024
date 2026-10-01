import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Тип урона на выбор спрашивает окно броска: у источника с `@dmg.choice(…)`
 * окно получает вопрос, в начале броска отдаёт итог источнику — раньше урона
 * и эффектов, — и эффекты на цель ложатся тем же типом, что и урон.
 */

const modalPath = 'src/client/ui/actor/DiceRollModal.vue';
const composablePath = 'src/client/composables/damageTypeChoice.ts';
const macroPath = 'src/client/macros/dnd5eMacros.ts';

const FIRE_OR_COLD = { mode: 'choose', options: ['fire', 'cold'] };
const RANDOM_ACID_OR_THUNDER = { mode: 'random', options: ['acid', 'thunder'] };
const FIRE_OR_COLD_KEY = engine.damageTypeChoiceKey(FIRE_OR_COLD);

/** Значение из VM-контекста — в обычные массивы и объекты для сравнения */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Настоящий `requestDamageTypeChoice` клиента на функциях движка */
const requestDamageTypeChoice = await loadHandler(
  composablePath,
  'requestDamageTypeChoice',
  { listSourceDamageTypeChoices: engine.listSourceDamageTypeChoices },
);

/** Настоящий `requestDamageTypeChoiceFor`: вопрос и подстановка итога */
const requestDamageTypeChoiceFor = await loadHandler(
  composablePath,
  'requestDamageTypeChoiceFor',
  {
    requestDamageTypeChoice,
    applySourceDamageTypeChoices: engine.applySourceDamageTypeChoices,
  },
);

/** Эффект на цель с уроном того же списка, что и у самого источника */
function createTargetEffect() {
  return {
    id: 'breath-effect',
    name: 'Ожог',
    changes: [],
    damageParts: [{ formula: '1к6@dmg.choice(fire,cold)' }],
  };
}

/** Строки чата о выбранном наборе урона «или» */
const announcedVariants = [];

/** Настоящая сборка наборов урона действия на функциях движка */
const buildCreatureRollVariants = await loadHandler(
  'src/client/composables/creatureDamageChoice.ts',
  'buildCreatureRollVariants',
  {
    requestDamageTypeChoice,
    applySourceDamageTypeChoices: engine.applySourceDamageTypeChoices,
    getDamagePartsPrimaryType: engine.getDamagePartsPrimaryType,
    announceCreatureDamageVariant: (actionName, variant) => {
      announcedVariants.push(`${actionName}: ${variant.label}`);
    },
  },
);

/**
 * Настоящий `settleRollDamageTypeChoices` окна с заданным вопросом и полями.
 *
 * @param request - вопрос источника
 * @param rows - поля окна «Тип урона»
 * @param announced - куда складывать строки чата
 */
function loadSettle(request, rows, announced) {
  return loadHandler(modalPath, 'settleRollDamageTypeChoices', {
    rollDamageTypeChoice: { value: request },
    partTypeChoiceRows: { value: rows },
    rollRandomDamageTypeChoices: engine.rollRandomDamageTypeChoices,
    announceDamageTypeChoices: (sourceName, choices, picks) => {
      announced.push({ sourceName, choices, picks: new Map(picks) });
    },
  });
}

describe('окно броска решает тип урона на выбор', () => {
  it('поле окна и случайный список уходят источнику и в чат одним итогом', async () => {
    const received = [];
    const announced = [];

    const settle = await loadSettle(
      {
        sourceName: 'Дыхание',
        choices: [FIRE_OR_COLD, RANDOM_ACID_OR_THUNDER],
        onChoose: (picks) => received.push(new Map(picks)),
      },
      [{ key: FIRE_OR_COLD_KEY, value: 'cold' }],
      announced,
    );

    const picks = settle();

    assert.equal(picks.get(FIRE_OR_COLD_KEY), 'cold');

    assert.ok(
      RANDOM_ACID_OR_THUNDER.options.includes(
        picks.get(engine.damageTypeChoiceKey(RANDOM_ACID_OR_THUNDER)),
      ),
      'случайный список выпадает в окне, а не остаётся без типа',
    );

    assert.deepEqual(
      plain(received.map((entry) => [...entry])),
      plain([[...picks]]),
    );

    assert.equal(announced.length, 1);
    assert.equal(announced[0].sourceName, 'Дыхание');
  });

  it('без вопроса источника окно решает только свои поля и молчит', async () => {
    const announced = [];

    const settle = await loadSettle(
      undefined,
      [{ key: FIRE_OR_COLD_KEY, value: 'fire' }],
      announced,
    );

    assert.deepEqual(plain([...settle()]), [[FIRE_OR_COLD_KEY, 'fire']]);
    assert.deepEqual(announced, []);
  });

  it('источник узнаёт тип раньше, чем окно отдаёт урон, и части идут выбранным типом', async () => {
    const events = [];

    const performRoll = await loadHandler(modalPath, 'performRoll', {
      console,
      hasRolled: false,
      props: {},
      activeDamageVariant: {
        value: { onSelect: () => events.push('variant') },
      },
      rollDamageParts: {
        value: [
          {
            formula: '3к8',
            type: 'choice',
            typeChoice: FIRE_OR_COLD,
            isHealing: false,
          },
        ],
      },
      rollEvaluateBonusDamageParts: { value: undefined },
      settleRollDamageTypeChoices: () => {
        events.push('choose');

        return new Map([[FIRE_OR_COLD_KEY, 'cold']]);
      },
      settleDamageTypeChoices: engine.settleDamageTypeChoices,
      performPartsRoll: (parts) => {
        events.push(['roll', parts.map((part) => part.type)]);
      },
      hasAttackRoll: { value: false },
      targetAc: { value: null },
      selectedSpellLevel: { value: 1 },
      consumeSpellSlot: { value: false },
      usePactSlot: { value: false },
      hasSpellCast: { value: false },
      rollType: { value: 'public' },
      attackRollMode: { value: 'normal' },
      bonusValue: { value: 0 },
      currentConditionalBonuses: { value: { attackBonus: 0, damageBonus: 0 } },
      currentBonusRollFormulas: { value: [] },
      isOpen: { value: true },
      chatStore: { isPrivateRoll: false, isGmOnlyRoll: false },
      DICE_ROLL_LOG_PREFIX: 'test-roll',
    });

    performRoll();

    assert.deepEqual(plain(events), ['variant', 'choose', ['roll', ['cold']]]);
  });

  it('вопроса нет, если у источника нет токенов «на выбор»', () => {
    assert.equal(
      requestDamageTypeChoice(
        { name: 'Меч', damageParts: [{ formula: '1к8@dmg.slashing' }] },
        () => {},
      ),
      undefined,
    );
  });
});

/**
 * Порты открытия окна у действия и заклинания существа: окно не рисуется,
 * его настройки остаются в `rollConfig`, применение урона записывается.
 *
 * @param applied - куда складывать применение
 */
function createPorts(applied) {
  const rollConfig = { value: null };

  /** Псевдо-заклинание несёт эффекты источника, как у настоящей сборки */
  const buildSetup = (options) => {
    const source = options.action ?? options.spell;

    return {
      baseParts: [
        {
          formula: '3к8',
          type: 'choice',
          typeChoice: FIRE_OR_COLD,
          isHealing: false,
        },
      ],
      pseudoSpell: { name: source.name, activeEffects: source.activeEffects },
    };
  };

  const record = (...args) => {
    applied.push(args);
  };

  return {
    rollConfig,
    isRollModalOpen: { value: false },
    requestDamageTypeChoice,
    requestDamageTypeChoiceFor,
    buildCreatureRollVariants,
    applySourceDamageTypeChoices: engine.applySourceDamageTypeChoices,
    useModalManager: () => ({
      openModal: (_name, props) => {
        rollConfig.value = props;
      },
    }),
    useBonusDamageParts: () => ({
      buildCreatureRollSetup: buildSetup,
      buildCreatureSpellRollSetup: buildSetup,
      buildTargetHpContext: () => undefined,
    }),
    buildCreatureRollSetup: buildSetup,
    buildCreatureSpellRollSetup: buildSetup,
    buildTargetHpContext: () => undefined,
    buildRollBonusEvaluator: () => () => [],
    getCreatureEntity: () => undefined,
    useWorldEntities: () => ({ findCurrentDndEntity: () => undefined }),
    collectActiveEffects: () => [],
    creatureActionHasSave: engine.creatureActionHasSave,
    getAttackFlagCategory: engine.getAttackFlagCategory,
    getAttackBonusKey: engine.getAttackBonusKey,
    getDamagePartsPrimaryType: () => undefined,
    resolveTargetedAttackRoll: () => ({
      mode: 'normal',
      reasons: { advantage: [], disadvantage: [] },
    }),
    getSpellAttackType: (spell) => spell.deliveryType,
    calculateCreatureSpellBlockNumbers: () => ({ attackBonus: 5, saveDC: 13 }),
    getCreatureSpellBlockAbility: () => 'wisdom',
    getCreatureSpellMod: () => 2,
    getCreatureSpellRollButtonText: () => 'roll',
    resolveCreatureSpellSaveDC: (_spell, blockSaveDC) => blockSaveDC,
    generateId: (prefix) => `${prefix}_test`,
    SPELL_CAST_KEY_PREFIX: 'cast',
    beginSpellCast: () => {},
    spellIsHealing: () => false,
    applyActionParts: record,
    applyCreatureActionParts: record,
    applySpellParts: record,
    applyCreatureSpellParts: record,
    CREATURE_ACTIONS_BLOCK_LABELS: { attackRollPrefix: 'Attack ' },
    CREATURE_ACTION_MENU_LABELS: { attack: 'attack' },
    SPELL_DAMAGE_ROLL_BUTTON: 'roll',
  };
}

/** Урон эффекта на цель в том, что дошло до применения */
function readEffectFormula(pseudoSpell) {
  return pseudoSpell.activeEffects[0].damageParts[0].formula;
}

describe('выбор из окна доходит до эффектов источника', () => {
  const creature = { id: 'dragon', name: 'Дракон' };

  for (const [path, name, creatureFirst] of [
    [
      'src/client/ui/creature/CreatureActionsBlock.vue',
      'startActionRoll',
      false,
    ],
    [macroPath, 'openCreatureActionRoll', true],
  ]) {
    it(`${name}: эффект действия на цель ложится выбранным типом`, async () => {
      const applied = [];
      const ports = createPorts(applied);
      const handler = await loadHandler(path, name, ports);

      const action = {
        name: 'Цветной плевок',
        attackBonus: 5,
        rangeType: 'ranged',
        damageParts: [{ formula: '3к8@dmg.choice(fire,cold)' }],
        activeEffects: [createTargetEffect()],
      };

      handler(
        ...(creatureFirst
          ? [creature, action, false, undefined]
          : [action, creature, false, undefined]),
      );

      const request = ports.rollConfig.value.damageTypeChoice;

      assert.deepEqual(plain(request.choices), [FIRE_OR_COLD]);
      assert.equal(request.sourceName, 'Цветной плевок');

      request.onChoose(new Map([[FIRE_OR_COLD_KEY, 'cold']]));
      ports.rollConfig.value.onRollParts([]);

      // Порядок аргументов у листа и хотбара разный: действие и псевдо-
      // заклинание находятся по форме
      const [args] = applied;
      const chosenAction = args.find((arg) => arg?.attackBonus === 5);

      const actionSpell = args.find(
        (arg) => arg?.activeEffects && !arg.attackBonus,
      );

      assert.equal(readEffectFormula(actionSpell), '1к6@dmg.cold');
      assert.equal(chosenAction.damageParts[0].formula, '3к8@dmg.cold');
    });
  }

  for (const [path, name, creatureFirst] of [
    ['src/client/ui/creature/CreatureSpellsBlock.vue', 'startSpellRoll', false],
    [macroPath, 'openCreatureSpellRoll', true],
  ]) {
    it(`${name}: эффект заклинания на цель ложится выбранным типом`, async () => {
      const applied = [];
      const ports = createPorts(applied);
      const handler = await loadHandler(path, name, ports);

      const spell = {
        name: 'Цветной шарик',
        deliveryType: 'ranged',
        damageParts: [{ formula: '3к8@dmg.choice(fire,cold)' }],
        activeEffects: [createTargetEffect()],
      };

      handler(
        ...(creatureFirst
          ? [creature, spell, undefined, undefined]
          : [spell, creature, undefined, undefined]),
      );

      ports.rollConfig.value.damageTypeChoice.onChoose(
        new Map([[FIRE_OR_COLD_KEY, 'fire']]),
      );

      ports.rollConfig.value.onRollParts([]);

      const castSpell = applied[0].find((arg) => arg?.activeEffects);

      assert.equal(readEffectFormula(castSpell), '1к6@dmg.fire');
    });
  }
});

describe('урон «или» выбирают в окне броска', () => {
  const creature = { id: 'dragon', name: 'Дракон' };

  /** Действие с уроном «или»: основной набор и вариант другого типа */
  function createVariantAction(damageParts) {
    return {
      name: 'Цветной плевок',
      attackBonus: 5,
      rangeType: 'ranged',
      damageParts,
      activeEffects: [createTargetEffect()],
    };
  }

  for (const [path, name, creatureFirst] of [
    [
      'src/client/ui/creature/CreatureActionsBlock.vue',
      'startActionRoll',
      false,
    ],
    [macroPath, 'openCreatureActionRoll', true],
  ]) {
    it(`${name}: у каждого набора свой урон, выбранный называется в чате`, async () => {
      announcedVariants.length = 0;

      const applied = [];
      const ports = createPorts(applied);
      const handler = await loadHandler(path, name, ports);

      const acid = createVariantAction([{ formula: '1к6+3@dmg.acid' }]);
      const fire = createVariantAction([{ formula: '2к6@dmg.fire' }]);

      const variants = [
        { label: '1к6+3 кислота', action: acid },
        { label: '2к6 огонь', action: fire },
      ];

      handler(
        ...(creatureFirst
          ? [creature, acid, false, undefined, variants]
          : [acid, creature, false, undefined, variants]),
      );

      const windowVariants = ports.rollConfig.value.damageVariants;

      assert.deepEqual(plain(windowVariants.map((variant) => variant.label)), [
        '1к6+3 кислота',
        '2к6 огонь',
      ]);

      assert.equal(windowVariants[1].damageType, 'fire');

      // Бросок вторым набором: окно зовёт его выбор, затем применение
      windowVariants[1].onSelect();
      windowVariants[1].onRollParts([]);

      assert.deepEqual(announcedVariants, ['Цветной плевок: 2к6 огонь']);

      const chosenAction = applied[0].find((arg) => arg?.attackBonus === 5);

      assert.equal(chosenAction.damageParts[0].formula, '2к6@dmg.fire');
    });
  }

  it('без урона «или» поля «Урон» нет, а бросок идёт самим действием', async () => {
    const applied = [];
    const ports = createPorts(applied);

    const handler = await loadHandler(
      'src/client/ui/creature/CreatureActionsBlock.vue',
      'startActionRoll',
      ports,
    );

    handler(
      createVariantAction([{ formula: '1к6+3@dmg.acid' }]),
      creature,
      false,
      undefined,
    );

    assert.equal(ports.rollConfig.value.damageVariants, undefined);

    ports.rollConfig.value.onRollParts([]);
    assert.equal(applied.length, 1);
  });
});

describe('плитка урона в строке листа', () => {
  const TYPE_LABELS = { acid: 'Кислота', cold: 'Холод' };

  /** Настоящая сборка подсказки и значка плитки урона */
  async function loadStat() {
    const describeSourceDamageTypeChoices = await loadHandler(
      composablePath,
      'describeSourceDamageTypeChoices',
      {
        listSourceDamageTypeChoices: engine.listSourceDamageTypeChoices,
        formatDamageTypeChoiceLabel: (choice, getTypeLabel) =>
          `На выбор: ${choice.options.map(getTypeLabel).join('/')}`,
      },
    );

    const formatDamageBonusLines = await loadHandler(
      composablePath,
      'formatDamageBonusLines',
      { DAMAGE_BONUS_LINE_PREFIX: '+ ' },
    );

    const resolveDamageStatIcon = await loadHandler(
      composablePath,
      'resolveDamageStatIcon',
      {
        DAMAGE_VARIANTS_STAT_ICON: 'variants-icon',
        DAMAGE_BONUS_STAT_ICON: 'bonus-icon',
      },
    );

    return loadHandler(composablePath, 'describeDamageVariantsStat', {
      describeSourceDamageTypeChoices,
      formatDamageBonusLines,
      resolveDamageStatIcon,
      SHEET_ROW_TOOLTIP_LINE_BREAK: '\n',
    });
  }

  it('тип на выбор — значок и строка вариантов в подсказке', async () => {
    const describeStat = await loadStat();

    const stat = describeStat(
      { damageParts: [{ formula: '1к6+3@dmg.choice(acid,cold)' }] },
      'Урон заклинания',
      (typeKey) => TYPE_LABELS[typeKey] ?? typeKey,
    );

    assert.equal(stat.icon, 'variants-icon');
    assert.equal(stat.tooltip, 'Урон заклинания\nНа выбор: Кислота/Холод');
  });

  it('тип один — ни значка, ни лишних строк', async () => {
    const describeStat = await loadStat();

    const stat = describeStat(
      { damageParts: [{ formula: '1к6+3@dmg.acid' }] },
      'Урон заклинания',
      (typeKey) => typeKey,
    );

    assert.equal(stat.icon, undefined);
    assert.equal(stat.tooltip, 'Урон заклинания');
  });

  it('добавка по условию — свой значок и строка в подсказке', async () => {
    const describeStat = await loadStat();

    const stat = describeStat(
      { damageParts: [{ formula: '1к6+3@dmg.acid' }] },
      'Урон заклинания',
      (typeKey) => typeKey,
      ['2к6 (цель: Лежащий ничком)'],
    );

    assert.equal(stat.icon, 'bonus-icon');

    assert.equal(stat.tooltip, 'Урон заклинания\n+ 2к6 (цель: Лежащий ничком)');
  });
});
