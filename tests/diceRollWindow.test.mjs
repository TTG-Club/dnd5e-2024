import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Окно броска открывает один помощник — `openDiceRollWindow`, всегда со своим
 * ключом. Менеджер окон ядра без ключа считал окно броска одним на всё
 * приложение: второй вызов поднимал прежнее окно с прежними свойствами и
 * возвращал `null`, а вход уже потратил ход, поставил шаблон и написал в чат.
 */

const WINDOW_PATH = 'src/client/composables/diceRollWindow.ts';
const CREATURE_ACTION_PATH = 'src/client/composables/creatureActionRoll.ts';
const CREATURE_SPELL_PATH = 'src/client/composables/creatureSpellCast.ts';

/**
 * Исходник без строк-комментариев.
 *
 * @param {string} path - файл
 * @returns {string} текст
 */
function readCode(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

describe('окно броска — один помощник', () => {
  it("'DiceRollModal' в менеджер окон отдаёт только помощник", () => {
    const openers = listClientSources()
      .filter((path) => /['"`]DiceRollModal['"`]/u.test(readCode(path)))
      .map(toSystemPath);

    assert.deepEqual(openers, [WINDOW_PATH]);
  });

  it('у каждого открытия свой ключ; переданный ключ — как есть', async () => {
    const opened = [];

    let counter = 0;

    const openDiceRollWindow = await loadHandler(
      WINDOW_PATH,
      'openDiceRollWindow',
      {
        useModalManager: () => ({
          openModal: (name, props) => {
            opened.push({ name, key: props._modalKey });

            return `modal-${opened.length}`;
          },
        }),
        DICE_ROLL_MODAL: 'DiceRollModal',
        DICE_ROLL_MODAL_KEY_PREFIX: 'dice-roll',
        generateId: (prefix) => `${prefix}-${(counter += 1)}`,
        closeRollWindow: () => assert.fail('без источника заменять нечего'),
        sourceWindows: new Map(),
      },
    );

    assert.equal(openDiceRollWindow({ title: 'А' }), 'modal-1');
    openDiceRollWindow({ title: 'Б' });

    openDiceRollWindow(
      { title: 'Инициатива' },
      { modalKey: 'initiative:wolf' },
    );

    assert.deepEqual(opened, [
      { name: 'DiceRollModal', key: 'dice-roll-1' },
      { name: 'DiceRollModal', key: 'dice-roll-2' },
      { name: 'DiceRollModal', key: 'initiative:wolf' },
    ]);
  });
});

/**
 * Менеджер окон, как у ядра: окно узнают по `_modalKey`, закрытие ставит
 * `open: false`, а само окно на это сворачивает своё действие (`onCancel`) —
 * так делает `DiceRollModal`, пока в нём не бросили.
 *
 * @returns {object} менеджер и его окна
 */
function createModalManager() {
  const modals = [];

  const manager = {
    openModal: (component, props) => {
      const modal = {
        id: `modal-${modals.length + 1}`,
        component,
        props: { ...props, open: true },
      };

      modals.push(modal);

      return modal.id;
    },
    getModal: (modalId) => modals.find((modal) => modal.id === modalId),
    closeModal: (modalId) => {
      const modal = manager.getModal(modalId);

      if (modal?.props.open) {
        modal.props.open = false;
        modal.props.onCancel?.();
      }
    },
  };

  return { manager, modals };
}

/**
 * Настоящий помощник окна броска поверх менеджера окон теста.
 *
 * @param {object} manager - менеджер окон
 * @returns {Promise<object>} открытие, закрытие окна источника и ключ источника
 */
async function loadRollWindow(manager) {
  let counter = 0;

  const ports = {
    useModalManager: () => manager,
    DICE_ROLL_MODAL: 'DiceRollModal',
    DICE_ROLL_MODAL_KEY_PREFIX: 'dice-roll',
    CLOSE_LISTENER_PROP: 'onUpdate:open',
    SOURCE_KEY_SEPARATOR: ':',
    sourceWindows: new Map(),
    generateId: (prefix) => `${prefix}-${(counter += 1)}`,
  };

  for (const name of [
    'findOpenSourceWindow',
    'closeRollWindow',
    'openDiceRollWindow',
    'buildRollSourceKey',
  ]) {
    ports[name] = await loadHandler(WINDOW_PATH, name, ports);
  }

  return ports;
}

describe('повторное действие источника заменяет своё окно', () => {
  it('то же оружие — прежнее окно закрыто как отменённое, разные источники живут рядом', async () => {
    const { manager, modals } = createModalManager();
    const rollWindow = await loadRollWindow(manager);
    const log = [];

    const sword = rollWindow.buildRollSourceKey('hero', 'weapon', 'sword');
    const bow = rollWindow.buildRollSourceKey('hero', 'weapon', 'bow');
    const wolfBite = rollWindow.buildRollSourceKey('wolf', 'weapon', 'sword');

    assert.notEqual(sword, bow);

    assert.notEqual(
      sword,
      wolfBite,
      'то же оружие другой сущности — другой источник',
    );

    /**
     * Окно источника с шаблоном и обработчиком закрытия.
     *
     * @param {string} sourceKey - источник
     * @param {string} label - подпись для журнала
     * @returns {string | null} id окна
     */
    const open = (sourceKey, label) =>
      rollWindow.openDiceRollWindow(
        {
          title: label,
          onCancel: () => log.push(`cancel:${label}`),
        },
        {
          sourceKey,
          onClose: (isOpen) => log.push(`close:${label}:${isOpen}`),
        },
      );

    open(sword, 'меч-1');
    open(bow, 'лук');
    open(wolfBite, 'волк');

    assert.deepEqual(log, [], 'разные источники друг друга не закрывают');

    open(sword, 'меч-2');

    assert.deepEqual(log, ['cancel:меч-1', 'close:меч-1:false']);

    assert.deepEqual(
      modals
        .filter((modal) => modal.props.open)
        .map((modal) => modal.props.title),
      ['лук', 'волк', 'меч-2'],
    );

    assert.equal(new Set(modals.map((modal) => modal.props._modalKey)).size, 4);
  });

  it('окно, в котором уже бросили, не трогается: оно закрылось само', async () => {
    const { manager, modals } = createModalManager();
    const rollWindow = await loadRollWindow(manager);
    const sourceKey = rollWindow.buildRollSourceKey('hero', 'spell', 'bolt');
    const log = [];

    rollWindow.openDiceRollWindow(
      {},
      { sourceKey, onClose: () => log.push('close') },
    );

    // Бросок закрыл окно: менеджер ещё держит его на время анимации
    modals[0].props.open = false;

    assert.equal(rollWindow.closeRollWindow(sourceKey), false);

    rollWindow.openDiceRollWindow({}, { sourceKey });

    assert.deepEqual(log, []);
    assert.equal(rollWindow.closeRollWindow(sourceKey), true);

    assert.equal(
      rollWindow.closeRollWindow(sourceKey),
      false,
      'закрыто один раз',
    );
  });

  it('входы действий открывают окно с ключом источника', () => {
    const SOURCES = {
      'src/client/composables/weaponAttackRoll.ts':
        /buildRollSourceKey\(attacker\.id, 'weapon', weapon\.id\)/u,
      'src/client/composables/spellCastFlow.ts':
        /buildRollSourceKey\(caster\.id, 'spell', sourceSpell\.id\)/u,
      [CREATURE_SPELL_PATH]:
        /buildRollSourceKey\(creature\.id, 'spell', spell\.id\)/u,
      [CREATURE_ACTION_PATH]:
        /buildRollSourceKey\(\s*creature\.id,\s*'action',/u,
    };

    for (const [path, pattern] of Object.entries(SOURCES)) {
      const code = readCode(
        listClientSources().find((source) => toSystemPath(source) === path),
      );

      assert.match(code, pattern, `${path}: окно без ключа источника`);

      assert.match(
        code,
        /\{ sourceKey(?:: buildRollSourceKey\([^)]*\))?(?:, onClose: \w+)? \}/u,
        `${path}: ключ не отдан окну`,
      );
    }
  });
});

/** Существо: волк с укусом */
const WOLF = { id: 'wolf', name: 'Волк', entityType: 'creature' };

/** Укус с областью: шаблон ставится до окна */
const BREATH = {
  name: 'Дыхание',
  attackBonus: 5,
  areaOfEffect: { type: 'cone', size: 15 },
  damageParts: [{ formula: '2к6', type: 'fire' }],
};

/**
 * Окружение действия существа: окно броска открывается или нет.
 *
 * @param {boolean} windowOpens - вернёт ли менеджер окно
 * @param {object | null} [creature] - существо мира; `null` — ушло из мира
 * @returns {Promise<object>} вход действия и журнал
 */
async function loadCreatureAction(windowOpens, creature = WOLF) {
  const log = [];

  const ports = {
    log,
    readCreature: () => creature ?? undefined,
    CREATURE_ACTION_BLOCKED_TITLE: 'Сейчас не совершить',
    CREATURE_ACTION_MISSING_REASON: 'нет в мире',
    findCreatureActionBlock: () => null,
    resolveEntityActionBlocks: () => [],
    listAmbientEffects: () => [],
    isEntityOwnTurn: () => true,
    hasActionUseEffects: () => false,
    useTargetStore: () => ({ targetTokenId: null }),
    // Урон «или» решён состоянием: строка чата ждёт открытия окна
    runWithCreatureDamageChoice: (action, _creature, proceed) =>
      proceed(action, [], () => log.push('chat:или')),
    launchCreatureAction: (_action, _creatureId, openRoll) => {
      log.push('template:place');
      openRoll('tpl');
    },
    discardSpellTemplate: (templateId) =>
      log.push(`template:discard:${templateId}`),
    recordEntityActionSpend: () => log.push('turn'),
    resolveCreatureSectionCost: () => 'action',
    isCreatureAttackAction: () => true,
    warnOpportunityAttack: () => {},
    creatureActionHasSave: engine.creatureActionHasSave,
    collectActiveEffects: () => [],
    useBonusDamageParts: () => ({
      buildCreatureRollSetup: () => ({ baseParts: [], pseudoSpell: {} }),
      buildTargetHpContext: () => undefined,
    }),
    buildCreatureRollVariants: () => [
      {
        formula: '2к6',
        damageParts: [],
        evaluateBonusDamageParts: () => [],
        onRollParts: () => {},
      },
    ],
    resolveTargetedAttackRoll: () => ({ mode: 'normal' }),
    getAttackFlagCategory: engine.getAttackFlagCategory,
    getAttackBonusKey: engine.getAttackBonusKey,
    buildRollBonusEvaluator: () => () => [],
    useModalManager: () => ({
      openModal: () => (windowOpens ? 'modal' : null),
    }),
    CREATURE_ACTIONS_BLOCK_LABELS: { attackRollPrefix: 'Атака: ' },
    CREATURE_ACTION_MENU_LABELS: { attack: 'Атаковать' },
    SPELL_DAMAGE_ROLL_BUTTON: 'Урон',
  };

  ports.hasCreatureActionRoll = engine.hasCreatureActionRoll;
  ports.isTargetAtFullHp = engine.isTargetAtFullHp;
  ports.resolveCreatureActionSaveDc = engine.resolveCreatureActionSaveDc;

  for (const name of ['spendCreatureActionTurn', 'openCreatureActionRoll']) {
    ports[name] = await loadHandler(CREATURE_ACTION_PATH, name, ports);
  }

  const start = await loadHandler(
    CREATURE_ACTION_PATH,
    'startCreatureAction',
    ports,
  );

  return {
    log,
    start: (action) =>
      start(action, {
        creatureId: WOLF.id,
        section: 'actions',
        refuse: (_title, reason) => log.push(`refuse:${reason}`),
        announce: () => log.push('announce'),
      }),
  };
}

describe('действие существа: необратимое — после открытия окна', () => {
  it('окно не открылось — ход не потрачен, шаблон убран, в чат ничего', async () => {
    const { log, start } = await loadCreatureAction(false);

    start(BREATH);

    assert.deepEqual(log, ['template:place', 'template:discard:tpl']);
  });

  it('окно открылось — ход и строка чата после него', async () => {
    const { log, start } = await loadCreatureAction(true);

    start(BREATH);

    assert.deepEqual(log, ['template:place', 'turn', 'chat:или']);
  });

  it('существа нет в мире — вход говорит почему, а не молчит', async () => {
    const { log, start } = await loadCreatureAction(true, null);

    start(BREATH);

    assert.deepEqual(log, ['refuse:нет в мире']);
  });
});

/** Заклинание существа с областью и зарядами */
const FIRE_BREATH = {
  id: 'fire',
  name: 'Огненный шар',
  level: 3,
  saveType: 'dexterity',
  deliveryType: 'self',
  areaOfEffect: { type: 'sphere', size: 20 },
  damageParts: [{ formula: '8к6', type: 'fire' }],
};

/**
 * Окружение заклинания существа: окно броска открывается или нет.
 *
 * @param {boolean} windowOpens - вернёт ли менеджер окно
 * @param {object} [overrides] - порты поверх окружения (настоящее окно броска)
 * @returns {Promise<object>} вход каста и журнал
 */
async function loadCreatureSpell(windowOpens, overrides = {}) {
  const log = [];

  const ports = {
    ...engine,
    readCreature: () => WOLF,
    resolveSpellCastBlock: () => null,
    listAmbientEffects: () => [],
    retypeCasterSpellDamage: (spell) => spell,
    hasLiveCreatureSpellUsesLeft: () => true,
    runWithCastFailure: (_spell, _caster, _options, proceed) => proceed(),
    recordEntityActionSpend: () => log.push('turn'),
    resolveSpellAreaAtLevel: () => undefined,
    getDamageTemplateColor: () => 'red',
    useSpellTemplateStore: () => ({
      requestPlacement: (_area, _color, _casterId, onPlaced) => {
        log.push('template:place');
        onPlaced('tpl');
      },
    }),
    discardSpellTemplate: (templateId) =>
      log.push(`template:discard:${templateId}`),
    useTargetStore: () => ({ getTargetActor: () => null }),
    getCreatureSpellBlockAbility: () => 'wisdom',
    useBonusDamageParts: () => ({
      buildCreatureSpellRollSetup: ({ spell }) => ({
        baseParts: spell.damageParts.map((part) => ({ ...part })),
        pseudoSpell: spell,
        evaluateBonusDamageParts: () => [],
      }),
    }),
    collectActiveEffects: () => [],
    calculateCreatureSpellBlockNumbers: () => ({ attackBonus: 5, saveDC: 13 }),
    getCreatureSpellMod: () => 2,
    generateId: (prefix) => `${prefix}-1`,
    SPELL_CAST_KEY_PREFIX: 'cast',
    SPELL_ATTACK_KEY: 'attack.spell',
    PAGE_UNLOAD_EVENT: 'beforeunload',
    beginSpellCast: () => {},
    resolveTargetedAttackRoll: () => ({ mode: 'normal' }),
    buildRollBonusEvaluator: () => () => [],
    getCreatureSpellRollButtonText: () => 'Урон',
    useModalManager: () => ({
      openModal: () => (windowOpens ? 'modal' : null),
    }),
    CREATURE_ACTIONS_BLOCK_LABELS: { attackRollPrefix: 'Атака: ' },
    ACTOR_SPELLS_TAB_LABELS: {},
    ...overrides,
  };

  ports.openCreatureSpellRoll = await loadHandler(
    CREATURE_SPELL_PATH,
    'openCreatureSpellRoll',
    ports,
  );

  const start = await loadHandler(
    CREATURE_SPELL_PATH,
    'startCreatureSpellCast',
    ports,
  );

  return {
    log,
    start: (spell) =>
      start(spell, undefined, {
        creatureId: WOLF.id,
        spendUse: () => log.push('use'),
        refuse: () => log.push('refuse'),
      }),
  };
}

describe('заклинание существа: ход и заряд — после открытия окна', () => {
  it('окно не открылось — ни хода, ни заряда, шаблон убран', async () => {
    const { log, start } = await loadCreatureSpell(false);

    start(FIRE_BREATH);

    assert.deepEqual(log, ['template:place', 'template:discard:tpl']);
  });

  it('окно открылось — ход и заряд', async () => {
    const { log, start } = await loadCreatureSpell(true);

    start(FIRE_BREATH);

    assert.deepEqual(log, ['template:place', 'turn', 'use']);
  });
});

describe('заклинание существа: повторный каст заменяет окно и второй раз не тратит', () => {
  it('второй щелчок — прежнее окно закрыто, его шаблон убран, ход и заряд потрачены один раз', async () => {
    const { manager, modals } = createModalManager();
    const rollWindow = await loadRollWindow(manager);

    const { log, start } = await loadCreatureSpell(true, {
      useModalManager: () => manager,
      openDiceRollWindow: rollWindow.openDiceRollWindow,
      closeRollWindow: rollWindow.closeRollWindow,
      buildRollSourceKey: rollWindow.buildRollSourceKey,
    });

    start(FIRE_BREATH);
    start(FIRE_BREATH);

    assert.deepEqual(log, [
      'template:place',
      'turn',
      'use',
      'template:place',
      // Прежнее окно закрыто как отменённое — свой шаблон оно убрало само
      'template:discard:tpl',
    ]);

    assert.deepEqual(
      modals.map((modal) => modal.props.open),
      [false, true],
      'окно одно — новое',
    );
  });
});
