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
    'buildBeforeRoll',
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
        /\{\s*(?:\.\.\.\(sourceKey === undefined \? \{\} : \{ sourceKey \}\)|sourceKey(?:: buildRollSourceKey\([^)]*\))?),/u,
        `${path}: ключ не отдан окну`,
      );

      assert.match(
        code,
        /\bcommit(?::| \})/u,
        `${path}: расход хода и ресурсов не отдан окну`,
      );
    }
  });

  it('проверку перед броском окну собирает только помощник', () => {
    const offenders = listClientSources()
      .filter((path) => toSystemPath(path) !== WINDOW_PATH)
      .filter((path) => !path.endsWith('DiceRollModal.vue'))
      .filter((path) => /\bbeforeRoll\s*:/u.test(readCode(path)))
      .map(toSystemPath);

    assert.deepEqual(offenders, []);
  });
});

describe('ход и ресурсы тратит бросок, а не открытие окна', () => {
  /**
   * Окно источника с расходом и проверкой.
   *
   * @param {object} rollWindow - помощник окна
   * @param {string[]} log - журнал
   * @param {object} [options] - проверка и исход расхода
   * @param {() => boolean} [options.validateRoll] - проверка перед броском
   * @param {() => boolean} [options.commit] - расход
   * @returns {string | null} id окна
   */
  function openSourceWindow(rollWindow, log, options = {}) {
    return rollWindow.openDiceRollWindow(
      { onCancel: () => log.push('cancel') },
      {
        sourceKey: rollWindow.buildRollSourceKey('wolf', 'spell', 'wave'),
        commit: () => {
          log.push('spend');

          return true;
        },
        ...options,
      },
    );
  }

  it('отмена — ресурс цел', async () => {
    const { manager, modals } = createModalManager();
    const rollWindow = await loadRollWindow(manager);
    const log = [];

    openSourceWindow(rollWindow, log);
    manager.closeModal(modals[0].id);

    assert.deepEqual(log, ['cancel']);
  });

  it('подтверждение — потрачен один раз, даже если окно спросит дважды', async () => {
    const { manager, modals } = createModalManager();
    const rollWindow = await loadRollWindow(manager);
    const log = [];

    openSourceWindow(rollWindow, log);

    assert.deepEqual(log, [], 'открытие ничего не тратит');
    assert.equal(modals[0].props.beforeRoll(0, false, false), true);
    assert.equal(modals[0].props.beforeRoll(0, false, false), true);
    assert.deepEqual(log, ['spend']);
  });

  it('замена окна — потрачен один раз, броском нового окна', async () => {
    const { manager, modals } = createModalManager();
    const rollWindow = await loadRollWindow(manager);
    const log = [];

    openSourceWindow(rollWindow, log);
    openSourceWindow(rollWindow, log);

    assert.deepEqual(log, ['cancel'], 'прежнее окно закрыто и не потратило');
    assert.equal(modals[1].props.beforeRoll(0, false, false), true);
    assert.deepEqual(log, ['cancel', 'spend']);
  });

  it('проверка не прошла — расход не зовётся; расход отказал — бросок не идёт', async () => {
    const { manager, modals } = createModalManager();
    const rollWindow = await loadRollWindow(manager);
    const log = [];

    openSourceWindow(rollWindow, log, { validateRoll: () => false });

    assert.equal(modals[0].props.beforeRoll(0, false, false), false);
    assert.deepEqual(log, [], 'расход не звался');

    let usesLeft = false;

    rollWindow.openDiceRollWindow(
      {},
      {
        commit: () => {
          log.push(usesLeft ? 'spend' : 'refuse');

          return usesLeft;
        },
      },
    );

    assert.equal(modals[1].props.beforeRoll(0, false, false), false);

    // Заряд вернулся (отдых) — тот же щелчок «Бросить» проходит
    usesLeft = true;

    assert.equal(modals[1].props.beforeRoll(0, false, false), true);
    assert.deepEqual(log, ['refuse', 'spend']);
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

  /** Свойства открытого окна: бросок окна зовёт `beforeRoll` */
  const modal = { props: null };

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
    ACTION_SOURCE_SEPARATOR: '/',
    closeRollWindow: () => false,
    buildRollSourceKey: (...parts) => parts.join(':'),
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
      openModal: (_name, props) => {
        modal.props = props;

        return windowOpens ? 'modal' : null;
      },
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
    ports,
    start: (action) =>
      start(action, {
        creatureId: WOLF.id,
        section: 'actions',
        refuse: (_title, reason) => log.push(`refuse:${reason}`),
        announce: () => log.push('announce'),
      }),
    /** Бросок в открытом окне: проверка окна перед броском */
    roll: () => modal.props.beforeRoll(0, false, false),
  };
}

describe('действие существа: ход тратит бросок', () => {
  it('окно не открылось — ход не потрачен, шаблон убран, в чат ничего', async () => {
    const { log, start } = await loadCreatureAction(false);

    start(BREATH);

    assert.deepEqual(log, ['template:place', 'template:discard:tpl']);
  });

  it('окно открылось — ход цел; бросок — ход потрачен', async () => {
    const { log, start, roll } = await loadCreatureAction(true);

    start(BREATH);

    assert.deepEqual(log, ['template:place', 'chat:или']);
    assert.equal(roll(), true);
    assert.deepEqual(log, ['template:place', 'chat:или', 'turn']);
  });

  it('ход заняло другое действие, пока окно стояло, — бросок отказывает с причиной', async () => {
    const { log, ports, start, roll } = await loadCreatureAction(true);

    start(BREATH);
    ports.findCreatureActionBlock = () => 'действие уже потрачено';

    assert.equal(roll(), false);

    assert.deepEqual(log, [
      'template:place',
      'chat:или',
      'refuse:действие уже потрачено',
    ]);
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

  /** Свойства открытого окна: бросок окна зовёт `beforeRoll` */
  const modal = { props: null };

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
      openModal: (_name, props) => {
        modal.props = props;

        return windowOpens ? 'modal' : null;
      },
    }),
    CREATURE_ACTIONS_BLOCK_LABELS: { attackRollPrefix: 'Атака: ' },
    ACTOR_SPELLS_TAB_LABELS: { noUsesTitle: 'Нет зарядов' },
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
    ports,
    start: (spell) =>
      start(spell, undefined, {
        creatureId: WOLF.id,
        spendUse: () => log.push('use'),
        refuse: (_spell, refusal) => log.push(`refuse:${refusal.title}`),
      }),
    /** Бросок в открытом окне: проверка окна перед броском */
    roll: () => modal.props.beforeRoll(0, false, false),
  };
}

describe('заклинание существа: ход и заряд тратит бросок', () => {
  it('окно не открылось — ни хода, ни заряда, шаблон убран', async () => {
    const { log, start } = await loadCreatureSpell(false);

    start(FIRE_BREATH);

    assert.deepEqual(log, ['template:place', 'template:discard:tpl']);
  });

  it('окно открылось — ход и заряд целы; бросок — потрачены', async () => {
    const { log, start, roll } = await loadCreatureSpell(true);

    start(FIRE_BREATH);

    assert.deepEqual(log, ['template:place']);
    assert.equal(roll(), true);
    assert.deepEqual(log, ['template:place', 'turn', 'use']);
  });

  it('заряд ушёл, пока окно стояло, — бросок отказывает и в долг не тратит', async () => {
    const { log, ports, start, roll } = await loadCreatureSpell(true);

    start(FIRE_BREATH);
    ports.hasLiveCreatureSpellUsesLeft = () => false;

    assert.equal(roll(), false);
    assert.deepEqual(log, ['template:place', 'refuse:Нет зарядов']);
  });
});

describe('заклинание существа: повторный каст заменяет окно и тратит один раз', () => {
  it('второй щелчок — прежнее окно закрыто, его шаблон убран, ход и заряд тратит бросок нового окна', async () => {
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
      'template:place',
      // Прежнее окно закрыто как отменённое — свой шаблон оно убрало само
      'template:discard:tpl',
    ]);

    assert.equal(modals[1].props.beforeRoll(0, false, false), true);
    assert.deepEqual(log.slice(3), ['turn', 'use']);

    assert.deepEqual(
      modals.map((modal) => modal.props.open),
      [false, true],
      'окно одно — новое',
    );
  });
});

describe('галочка «Тратить ячейку заклинаний»', () => {
  it('показана только там, где ячейку есть кому списать', () => {
    assert.match(
      readFileSync('src/client/ui/actor/DiceRollModal.vue', 'utf8'),
      /<UCheckbox\s+v-if="onSpellSlotConsume"\s+v-model="consumeSpellSlot"/u,
    );
  });

  it('окно каста существа списание ячейки не передаёт: ячеек у существа нет', () => {
    assert.doesNotMatch(readCode(CREATURE_SPELL_PATH), /onSpellSlotConsume/u);
  });
});
