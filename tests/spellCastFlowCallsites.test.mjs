import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEntityWrites } from './helpers/combatWrite.mjs';
import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Каст заклинания разбирается в одном месте: персонаж — `spellCastFlow.ts`,
 * существо — `creatureSpellCast.ts`, применение умения и предмета — общим
 * финалом. «Храповик» держит список файлов, которым ещё разрешено звать
 * разбор каста напрямую, — новая копия пути каста в листе или макросе
 * роняет тест. Матрица «вход × вид каста» гоняет настоящие входы листа и
 * горячей панели (персонажа и существа) с их настоящими портами и сравнивает
 * свойства окна, порядок отправок и мир после каста.
 */

const FLOW_PATH = 'src/client/composables/spellCastFlow.ts';
const CREATURE_FLOW_PATH = 'src/client/composables/creatureSpellCast.ts';

/**
 * Кому разрешён вызов: определения функций и общие модули разбора — каст
 * персонажа и существа, действие существа, удар оружием.
 */
const ALLOWED_CALLERS = {
  'resolveSpellDamage(': [
    FLOW_PATH,
    'src/client/composables/spellEffectTargeting.ts',
    'src/client/composables/useSpellResolution.ts',
  ],
  'resolveSpellDamageWithParts(': [
    FLOW_PATH,
    CREATURE_FLOW_PATH,
    'src/client/composables/spellEffectTargeting.ts',
    'src/client/composables/useSpellDamageWithParts.ts',
    // Действие существа и удар оружием: лист и горячая панель — один путь
    'src/client/composables/creatureActionRoll.ts',
    'src/client/composables/weaponAttackRoll.ts',
  ],
  'completeSpellCast(': [
    FLOW_PATH,
    CREATURE_FLOW_PATH,
    'src/client/composables/effectActivationUse.ts',
    'src/client/composables/spellCastCompletion.ts',
  ],
  'beginSpellCast(': [
    FLOW_PATH,
    CREATURE_FLOW_PATH,
    'src/client/composables/effectActivationUse.ts',
    'src/client/composables/spellCasts.ts',
  ],
};

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

describe('храповик: разбор каста — только в общих модулях', () => {
  for (const [call, allowed] of Object.entries(ALLOWED_CALLERS)) {
    it(`${call} — только у разрешённых`, () => {
      const callers = listClientSources()
        .filter((path) => readCode(path).includes(call))
        .map(toSystemPath)
        .sort();

      assert.deepEqual(callers, [...allowed].sort());
    });
  }

  it('окно броска заклинания (с выбором круга) открывают только общие модули', () => {
    const openers = listClientSources()
      .filter((path) => {
        const code = readCode(path);

        return (
          /openDiceRollWindow\(/u.test(code)
          && /availableSpellLevels/u.test(code)
        );
      })
      .map(toSystemPath)
      .sort();

    assert.deepEqual(openers, [CREATURE_FLOW_PATH, FLOW_PATH].sort());
  });
});

// Подписи окна и чата — настоящие константы клиента

const constants = await loadEngineBundle(`
  export {
    ACTION_REFUSAL_LABELS,
    ACTOR_SPELLS_TAB_LABELS,
    PROJECTILE_MODAL_KEY_PREFIX,
    PROJECTILE_PROMPT_MODAL,
    SPELL_CAST_PROMPT_ID_PREFIX,
    SPELL_MENU_LABELS,
    SPELL_ROLL_BUTTON_LABELS,
  } from './src/client/ui/actor/constants.ts';
  export { CREATURE_ACTIONS_BLOCK_LABELS } from './src/client/ui/creature/constants.ts';
`);

/** Отказ действия — один помощник на лист и панель */
const REFUSAL_PATH = 'src/client/composables/actionRefusal.ts';

const SHEET_PATH = 'src/client/ui/actor/tabs/ActorSpellsTab.vue';
const CREATURE_SHEET_PATH = 'src/client/ui/creature/CreatureSpellsBlock.vue';
const MACROS_PATH = 'src/client/macros/dnd5eMacros.ts';
const TARGETING_PATH = 'src/client/composables/spellEffectTargeting.ts';
const BONUS_PARTS_PATH = 'src/client/composables/useBonusDamageParts.ts';

/** Функции разбора каста персонажа — настоящие */
const FLOW_FUNCTIONS = [
  'createSpellCasterPort',
  'resolveCastableSpellLevels',
  'listSlotSpellLevels',
  'findSpellCastRefusal',
  'startSpellCast',
  'chooseSpellCastTargets',
  'proceedWithSpellCast',
  'spendSpellCastTurn',
  'commitSpellCastStart',
  'proceedWithPaidSpellCast',
  'resolveSpellCasterSource',
  'targetEffectsSourceOf',
  'finishSpellCast',
  'claimCastTemplate',
  'markSpellCastApplied',
  'abandonSpellCast',
  'settleSpellRoll',
  'resolveSpellTargets',
  'settleSpellRollParts',
  'settleSpellProjectileAttack',
  'settleNoRollSpellCast',
  'settleSpellCastWindowOpen',
  'openSpellCastWindow',
  'buildSpellSlotProps',
];

/** Функции разбора каста существа — настоящие */
const CREATURE_FLOW_FUNCTIONS = [
  'readCreature',
  'spendCreatureSpellUse',
  'createCreatureSpellCasterPort',
  'startCreatureSpellCast',
  'openCreatureSpellRoll',
  'applyCreatureSpellParts',
];

/**
 * Окружение каста: мир, помощники записи и журнал всего, что ушло наружу, —
 * по порядку. Движок, разбор каста, порты входов и помощники записи —
 * настоящие; карта, окна и сторы хоста — журналом. Вход получает своё
 * окружение, и журналы двух входов сравниваются целиком.
 *
 * @param {object[]} entities - сущности мира
 * @param {object} [options] - окружение
 * @param {boolean} [options.windowOpens] - открывает ли менеджер окно броска
 * @returns {Promise<object>} порты, мир, окна и журнал
 */
async function loadCastEnvironment(entities, { windowOpens = true } = {}) {
  const world = new Map(
    entities.map((entity) => [entity.id, structuredClone(entity)]),
  );

  const sends = [];
  const windows = [];
  const prompts = [];

  let idCounter = 0;

  const writes = await loadEntityWrites({
    world,
    recordCombatBaseline: engine.recordCombatBaseline,
    onSend: (kind, entity) => sends.push(`${kind}:${entity.id}`),
  });

  const target = entities.find((entity) => entity.id === 'target');

  const ports = {
    ...engine,
    ...constants,
    console,
    world,
    changeEntitySheet: writes.changeEntitySheet,
    changeEntityCombatState: writes.changeEntityCombatState,
    generateId: (prefix) => `${prefix}-${(idCounter += 1)}`,
    SPELL_CAST_KEY_PREFIX: 'cast',
    SPELL_ATTACK_KEY: 'attack.spell',
    PAGE_UNLOAD_EVENT: 'beforeunload',
    window: { addEventListener() {}, removeEventListener() {} },
    useWorldEntities: () => ({
      findCurrentDndEntity: (entityId) => world.get(entityId),
      getCurrentWorldEntities: () => [...world.values()],
    }),
    useWorldStore: () => ({ currentScene: { id: 'scene' } }),
    useChatStore: () => ({
      getSocket: () => ({}),
      sendMessage: (text) => sends.push(`chat:${text}`),
    }),
    useTargetStore: () => ({ getTargetActor: () => target ?? null }),
    useModalManager: () => ({
      openModal: (name, props) => {
        windows.push({ name, props });
        sends.push(`window:${name}`);

        return windowOpens || name !== 'DiceRollModal'
          ? `modal-${windows.length}`
          : null;
      },
    }),
    useActionPromptStore: () => ({
      addPrompt: (prompt) => {
        prompts.push(prompt);
        sends.push('prompt');
      },
      removePrompt() {},
    }),
    useSpellTemplateStore: () => ({
      requestPlacement: (_area, _color, _casterId, onPlaced) => {
        sends.push('template:place');
        onPlaced('tpl');
      },
      getPlacedTemplate: (templateId) => ({ id: templateId }),
      removePlacedTemplate() {},
      deleteTemplate: (templateId) =>
        sends.push(`template:delete:${templateId}`),
    }),
    useProjectileStore: () => ({
      isActive: true,
      sessionId: 'projectiles',
      startTargeting: () => sends.push('projectiles:target'),
      stopTargeting() {},
    }),
    useBonusDamageParts: () => ({
      hasSpellBonusDamage: () => false,
      buildSpellBonusEvaluator: () => () => [],
      buildCreatureSpellRollSetup: ({ spell }) => ({
        baseParts: (spell.damageParts ?? []).map((part) => ({
          formula: part.formula,
          isHealing: false,
          target: 'selected',
        })),
        pseudoSpell: spell,
        evaluateBonusDamageParts: () => [],
      }),
    }),
    collectEffectsWithAuras: () => [],
    listAmbientEffects: () => [],
    resolveTargetedAttackRoll: () => ({ mode: 'normal' }),
    buildRollBonusEvaluator: () => () => [],
    collectProjectileRollBonuses: () => new Map(),
    isSpellCastBlockedByRange: () => false,
    isSpellTargetBlockedByRange: () => false,
    getSpellMaxRangeOnScene: () => null,
    createProjectileCastValidator: () => () => true,
    // Провал каста и цена сверх ячейки — проходные: у фикстур их нет
    runWithCastFailureAndPay: (spell, _caster, options, proceed) =>
      proceed(spell, options.lockedLevel),
    runWithCastFailure: (_spell, _caster, _options, proceed) => proceed(),
    chooseAreaCastLevel: (_spell, levels, proceed) => proceed(levels[0]),
    requestSpellEffectTargets: (_spell, _casterId, levels, proceed) => {
      sends.push('targets:choose');

      proceed(levels[0], {
        validate: () => true,
        apply: () => sends.push('targets:apply'),
      });
    },
    // Ход: запись хода у обоих входов одна — здесь журналом
    recordEntityActionSpend: (entityId, cost) =>
      sends.push(`turn:${entityId}:${cost}`),
    beginSpellCast: () => {},
    setSpellCastLevel: () => {},
    completeSpellCast: () => {
      sends.push('complete');

      return Promise.resolve();
    },
    afterSpellCast: (completion, proceed) => {
      completion.then(proceed);
    },
    applySpellTargetEffects: () => sends.push('targets:apply'),
    settleNoRollSpellTargets: () => sends.push('targets:noRoll'),
    useSpellResolution: () => ({
      resolveSpellDamage: () => sends.push('targets:resolve'),
      resolveSpellDamageWithParts: () => sends.push('targets:parts'),
    }),
    discardSpellTemplate: (templateId) =>
      sends.push(`template:discard:${templateId}`),
    // Отказ — уведомлением у действовавшего: и с листа, и с панели
    useSystemToastStore: () => ({
      add: ({ description }) => sends.push(`toast:${description}`),
    }),
    isDnDActorEntity: (entity) => entity?.entityType === 'actor',
    isDnDCreatureEntity: (entity) => entity?.entityType === 'creature',
  };

  for (const name of ['refuseAction', 'refuseSpellCast']) {
    ports[name] = await loadHandler(REFUSAL_PATH, name, ports);
  }

  ports.needsSpellEffectTargets = await loadHandler(
    TARGETING_PATH,
    'needsSpellEffectTargets',
    ports,
  );

  ports.withFlatDamageBonusPart = await loadHandler(
    BONUS_PARTS_PATH,
    'withFlatDamageBonusPart',
    ports,
  );

  for (const name of FLOW_FUNCTIONS) {
    ports[name] = await loadHandler(FLOW_PATH, name, ports);
  }

  for (const name of CREATURE_FLOW_FUNCTIONS) {
    ports[name] = await loadHandler(CREATURE_FLOW_PATH, name, ports);
  }

  return { ports, world, sends, windows, prompts };
}

/**
 * Окружение макросов горячей панели: ошибка внутри макроса роняет тест, а не
 * уходит в консоль.
 *
 * @param {object} env - окружение
 * @returns {object} порты макросов
 */
function loadMacroPorts(env) {
  return {
    ...env.ports,
    console: { warn: assert.fail, error: assert.fail },
  };
}

/**
 * Входы каста персонажа и существа: настоящие обработчики листа и горячей
 * панели на одном окружении.
 */
const ENTRIES = {
  /**
   * Вкладка «Заклинания» листа персонажа.
   *
   * @param {object} env - окружение
   * @param {object} caster - заклинатель (черновик листа)
   * @returns {Promise<(spell: object) => void>} каст
   */
  async sheet(env, caster) {
    const ports = { ...env.ports, props: { actor: caster } };

    ports.createSheetCasterPort = await loadHandler(
      SHEET_PATH,
      'createSheetCasterPort',
      ports,
    );

    return loadHandler(SHEET_PATH, 'castSpell', ports);
  },

  /**
   * Макрос горячей панели `spell-cast`.
   *
   * @param {object} env - окружение
   * @param {object} caster - заклинатель
   * @returns {Promise<(spell: object) => void>} каст
   */
  async hotbar(env, caster) {
    const ports = loadMacroPorts(env);

    ports.createHotbarCasterPort = await loadHandler(
      MACROS_PATH,
      'createHotbarCasterPort',
      ports,
    );

    const macro = await loadHandler(MACROS_PATH, 'spell-cast', ports, true);

    return (spell) => {
      ports.findSpell = () => ({ spell, actor: caster });
      macro({ ref: spell.id }, { actor: caster, actors: [caster] });
    };
  },

  /**
   * Блок заклинаний листа существа.
   *
   * @param {object} env - окружение
   * @param {object} creature - существо
   * @returns {Promise<(spell: object) => void>} каст
   */
  async creatureSheet(env, creature) {
    const ports = {
      ...env.ports,
      props: { creatureId: creature.id, isReadOnly: false },
    };

    ports.createSheetCreaturePort = await loadHandler(
      CREATURE_SHEET_PATH,
      'createSheetCreaturePort',
      ports,
    );

    const cast = await loadHandler(CREATURE_SHEET_PATH, 'castSpell', ports);

    return (spell) => cast(spell, undefined);
  },

  /**
   * Макрос горячей панели `creature-spell`.
   *
   * @param {object} env - окружение
   * @param {object} creature - существо
   * @returns {Promise<(spell: object) => void>} каст
   */
  async creatureHotbar(env, creature) {
    const macro = await loadHandler(
      MACROS_PATH,
      'creature-spell',
      loadMacroPorts(env),
      true,
    );

    return (spell) =>
      macro(
        { ref: spell.id, actorId: creature.id },
        { actor: creature, creatures: [creature] },
      );
  },
};

/**
 * Свойства окна для сравнения: значения — как есть, функции — признаком.
 *
 * @param {object} props - свойства окна
 * @returns {object} снимок свойств
 */
function describeWindowProps(props) {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => {
      // Ключ окна у каждого открытия свой — сравнивается его наличие
      if (key === '_modalKey' || typeof value === 'function') {
        return [key, typeof value];
      }

      return [key, JSON.parse(JSON.stringify(value ?? null))];
    }),
  );
}

/**
 * Отказ входа: уведомление у действовавшего — одно и то же с листа и с
 * панели («<заклинание>: <причина>»). В чат отказ не уходит.
 *
 * @param {string} entry - отправка
 * @returns {string} отказ с причиной без названия заклинания
 */
function normalizeRefusal(entry) {
  const refusal = entry.match(/^toast:[^:]+: (.*)$/u);

  return refusal ? `refuse:${refusal[1]}` : entry;
}

/**
 * Проводит каст до конца: окно открыто — ячейка списывается и бросок
 * применяется так, как это делает окно.
 *
 * @param {object} env - окружение
 * @param {object} cell - клетка матрицы
 */
async function playWindows(env, cell) {
  // Плашка «Применить заклинание?» и окно снарядов подтверждаются
  for (const prompt of env.prompts) {
    prompt.actions[0].onClick();
  }

  for (const { name, props } of [...env.windows]) {
    if (name === 'ProjectilePromptModal') {
      props.onConfirm(cell.spell.level);
    }
  }

  const rollWindow = env.windows.find(({ name }) => name === 'DiceRollModal');

  if (!rollWindow) {
    return;
  }

  const { props } = rollWindow;

  // Бросок окна: проверка и расход хода и заряда — первым делом, как в окне
  if (props.beforeRoll && !props.beforeRoll(cell.spell.level, true, false)) {
    return;
  }

  props.onSpellSlotConsume?.(cell.spell.level, true, false);

  if (props.onRollParts) {
    props.onRollParts([{ formula: '1', total: 4, type: 'fire' }]);
  } else {
    props.onRoll(7);
  }

  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Волшебник 5-го уровня с ячейками; лист держит черновик, отличный от мира,
 * — вход, читающий черновик вместо мира, разойдётся с панелью.
 *
 * @returns {object} персонаж
 */
function createWizard() {
  const wizard = createActor({ id: 'wizard', name: 'Волшебник' });

  wizard.system.classes = [
    {
      classKey: 'wizard',
      level: 5,
      casterType: 'full',
      spellcastingAbility: 'intelligence',
    },
  ];

  wizard.system.spellSlotsUsed = [0, 0, 0];

  return wizard;
}

/** Существо-заклинатель */
function createMage() {
  return createCreature({ id: 'mage', name: 'Маг-существо' });
}

const TARGET_EFFECT = createEffect('mark', { effectTarget: 'target' });

/** Клетки матрицы: вид каста персонажа */
const CHARACTER_CELLS = [
  {
    title: 'атака',
    spell: {
      id: 'ray',
      name: 'Луч',
      level: 1,
      saveType: 'none',
      deliveryType: 'ranged',
      damageParts: [{ formula: '2к8', type: 'fire' }],
    },
    // Урон атаки по цели пишет само окно броска
    expect: [
      'window:DiceRollModal',
      'turn:wizard',
      'update:wizard',
      'complete',
    ],
  },
  {
    title: 'спасбросок с уроном',
    spell: {
      id: 'burst',
      name: 'Взрыв',
      level: 1,
      saveType: 'dexterity',
      deliveryType: 'self',
      damageParts: [{ formula: '3к6', type: 'thunder' }],
    },
    expect: [
      'window:DiceRollModal',
      'turn:wizard',
      'update:wizard',
      'complete',
      'targets:resolve',
    ],
  },
  {
    title: 'многочастный',
    spell: {
      id: 'storm',
      name: 'Буря',
      level: 1,
      saveType: 'none',
      deliveryType: 'touch',
      autoHit: true,
      damageParts: [
        { formula: '1к6', type: 'cold' },
        { formula: '1к6', type: 'lightning' },
      ],
    },
    expect: [
      'window:DiceRollModal',
      'turn:wizard',
      'update:wizard',
      'complete',
      'targets:parts',
    ],
  },
  {
    title: 'спасбросок без урона',
    spell: {
      id: 'hold',
      name: 'Удержание личности',
      level: 2,
      saveType: 'wisdom',
      deliveryType: 'ranged',
      activeEffects: [TARGET_EFFECT],
    },
    expect: [
      'window:DiceRollModal',
      'turn:wizard',
      'update:wizard',
      'complete',
      'targets:noRoll',
    ],
  },
  {
    title: 'без броска на себя',
    spell: {
      id: 'shield',
      name: 'Щит',
      level: 1,
      saveType: 'none',
      deliveryType: 'self',
      castingTime: { unit: 'reaction', value: 1 },
      activeEffects: [createEffect('shield', { effectTarget: 'self' })],
    },
    expect: ['window:DiceRollModal'],
  },
  {
    title: 'заговор без урона — без окна',
    spell: {
      id: 'guidance',
      name: 'Указание',
      level: 0,
      saveType: 'none',
      deliveryType: 'touch',
      activeEffects: [TARGET_EFFECT],
    },
    expect: ['targets:choose', 'turn:wizard', 'complete', 'targets:noRoll'],
  },
  {
    title: 'каст с выбором целей',
    spell: {
      id: 'bless',
      name: 'Благословение',
      level: 1,
      saveType: 'none',
      deliveryType: 'touch',
      activeEffects: [TARGET_EFFECT],
    },
    expect: [
      'targets:choose',
      'window:DiceRollModal',
      'turn:wizard',
      'update:wizard',
      'complete',
    ],
  },
  {
    title: 'серия снарядов',
    spell: {
      id: 'missile',
      name: 'Волшебная стрела',
      level: 1,
      saveType: 'none',
      deliveryType: 'ranged',
      autoHit: true,
      projectiles: { count: 3, targetDistribution: null },
      damageParts: [{ formula: '1к4+1', type: 'force' }],
    },
    expect: [
      'projectiles:target',
      'window:ProjectilePromptModal',
      'window:DiceRollModal',
      'turn:wizard',
    ],
  },
  {
    title: 'область с шаблоном',
    spell: {
      id: 'fireball',
      name: 'Огненный шар',
      level: 3,
      saveType: 'dexterity',
      deliveryType: 'self',
      areaOfEffect: { type: 'sphere', size: 20 },
      damageParts: [{ formula: '8к6', type: 'fire' }],
    },
    expect: [
      'template:place',
      'window:DiceRollModal',
      'turn:wizard',
      'update:wizard',
      'complete',
    ],
  },
  {
    title: 'врождённое с зарядом',
    spell: {
      id: 'misty',
      name: 'Туманный шаг',
      level: 2,
      saveType: 'none',
      deliveryType: 'self',
      uses: { max: 1, current: 1, recovery: 'longRest' },
      activeEffects: [createEffect('misty', { effectTarget: 'self' })],
    },
    expect: ['turn:wizard', 'update:wizard', 'complete'],
  },
  {
    title: 'отказ: нет ячеек',
    spell: {
      id: 'wish',
      name: 'Исполнение желаний',
      level: 9,
      saveType: 'none',
      deliveryType: 'self',
      activeEffects: [createEffect('wish', { effectTarget: 'self' })],
    },
    expect: ['refuse:'],
  },
];

/** Клетки матрицы: вид каста существа */
const CREATURE_CELLS = [
  {
    title: 'атака существа',
    spell: {
      id: 'bolt',
      name: 'Огненный снаряд',
      level: 0,
      saveType: 'none',
      deliveryType: 'ranged',
      damageParts: [{ formula: '2к10', type: 'fire' }],
    },
    expect: ['window:DiceRollModal', 'turn:mage', 'complete', 'targets:parts'],
  },
  {
    title: 'область существа с шаблоном и зарядом',
    spell: {
      id: 'cone',
      name: 'Конус холода',
      level: 5,
      saveType: 'constitution',
      deliveryType: 'self',
      areaOfEffect: { type: 'cone', size: 60 },
      uses: { max: 1, current: 1, recovery: 'longRest' },
      damageParts: [{ formula: '8к8', type: 'cold' }],
    },
    expect: [
      'template:place',
      'window:DiceRollModal',
      'turn:mage',
      'update:mage',
      'complete',
      'targets:parts',
    ],
  },
  {
    title: 'существо без броска',
    spell: {
      id: 'ward',
      name: 'Защита',
      level: 1,
      saveType: 'none',
      deliveryType: 'self',
      activeEffects: [createEffect('ward', { effectTarget: 'self' })],
    },
    // Каст без окна применяется сразу; ход тратится до доведения каста
    expect: ['turn:mage', 'complete'],
  },
  {
    title: 'существо без броска с зарядом и концентрацией',
    spell: {
      id: 'veil',
      name: 'Невидимость',
      level: 2,
      saveType: 'none',
      deliveryType: 'self',
      concentration: true,
      uses: { max: 1, current: 1, recovery: 'longRest' },
      activeEffects: [createEffect('veil', { effectTarget: 'self' })],
    },
    // Заряд — полная запись сущности: после доведения каста она вернула бы
    // серверу прежние эффекты вместо новой метки концентрации
    expect: ['turn:mage', 'update:mage', 'complete'],
  },
];

/**
 * Проводит клетку на обоих входах и сравнивает: окна и отправки одинаковы.
 *
 * @param {object} cell - клетка
 * @param {[string, string]} entryNames - входы
 * @param {() => object} createCaster - заклинатель
 * @returns {Promise<object[]>} итоги входов
 */
async function runCell(cell, entryNames, createCaster) {
  const results = [];

  for (const entryName of entryNames) {
    const caster = createCaster();
    const casterWithSpell = { ...caster, spells: [cell.spell] };

    const env = await loadCastEnvironment([
      casterWithSpell,
      createCreature({ id: 'target' }),
    ]);

    // Черновик листа отстаёт от мира: вход, который читает черновик, а не
    // мир, разойдётся с панелью в кругах и записях
    const draft = structuredClone(casterWithSpell);

    if (draft.system.spellSlotsUsed) {
      draft.system.spellSlotsUsed = [4, 3, 2];
    }

    const cast = await ENTRIES[entryName](env, draft);

    cast(cell.spell);
    await Promise.resolve();
    await playWindows(env, cell);

    results.push({
      entryName,
      sends: env.sends.map(normalizeRefusal),
      windows: env.windows.map(({ name, props }) => ({
        name,
        props: describeWindowProps(props),
      })),
      world: JSON.parse(JSON.stringify(env.world.get(caster.id))),
    });
  }

  return results;
}

/**
 * Последовательность ожидаемых отправок встречается в журнале по порядку.
 *
 * @param {string[]} sends - журнал
 * @param {string[]} expected - ожидаемые отправки
 * @returns {boolean} да, если все по порядку
 */
function containsInOrder(sends, expected) {
  let index = 0;

  for (const entry of sends) {
    if (index < expected.length && entry.startsWith(expected[index])) {
      index += 1;
    }
  }

  return index === expected.length;
}

describe('матрица: вход × вид каста — лист и горячая панель одинаковы', () => {
  for (const cell of CHARACTER_CELLS) {
    it(`персонаж, ${cell.title}`, async () => {
      const [sheet, hotbar] = await runCell(
        cell,
        ['sheet', 'hotbar'],
        createWizard,
      );

      assert.ok(
        containsInOrder(sheet.sends, cell.expect),
        `${cell.title}: ${JSON.stringify(sheet.sends)}`,
      );

      assert.deepEqual(hotbar.sends, sheet.sends, 'отправки совпали');
      assert.deepEqual(hotbar.windows, sheet.windows, 'окна совпали');
      assert.deepEqual(hotbar.world, sheet.world, 'мир после каста совпал');
    });
  }

  for (const cell of CREATURE_CELLS) {
    it(`существо, ${cell.title}`, async () => {
      const [sheet, hotbar] = await runCell(
        cell,
        ['creatureSheet', 'creatureHotbar'],
        createMage,
      );

      assert.ok(
        containsInOrder(sheet.sends, cell.expect),
        `${cell.title}: ${JSON.stringify(sheet.sends)}`,
      );

      assert.deepEqual(hotbar.sends, sheet.sends, 'отправки совпали');
      assert.deepEqual(hotbar.windows, sheet.windows, 'окна совпали');
      assert.deepEqual(hotbar.world, sheet.world, 'мир после каста совпал');
    });
  }

  it('окно не открылось — ход и заряд не тратятся, шаблон убран', async () => {
    const wizard = { ...createWizard(), spells: [] };
    const env = await loadCastEnvironment([wizard], { windowOpens: false });

    env.ports.openSpellCastWindow(
      {
        id: 'fireball',
        name: 'Огненный шар',
        level: 3,
        saveType: 'dexterity',
        deliveryType: 'self',
        areaOfEffect: { type: 'sphere', size: 20 },
        uses: { max: 1, current: 1, recovery: 'longRest' },
        damageParts: [{ formula: '8к6', type: 'fire' }],
      },
      env.ports.createSpellCasterPort(wizard.id, () => {}),
      { template: { id: 'tpl' }, lockedLevel: 3 },
    );

    assert.deepEqual(env.sends, [
      'window:DiceRollModal',
      'template:delete:tpl',
    ]);
  });

  /** Заклинание с зарядом и областью: шаблон, окно броска, один заряд */
  const CHARGED_CONE = {
    id: 'cone',
    name: 'Конус холода',
    level: 5,
    saveType: 'constitution',
    deliveryType: 'self',
    areaOfEffect: { type: 'cone', size: 60 },
    uses: { max: 1, current: 1, recovery: 'longRest' },
    damageParts: [{ formula: '8к8', type: 'cold' }],
  };

  for (const [title, entryName, createCaster] of [
    ['лист персонажа', 'sheet', createWizard],
    ['панель персонажа', 'hotbar', createWizard],
    ['лист существа', 'creatureSheet', createMage],
    ['панель существа', 'creatureHotbar', createMage],
  ]) {
    it(`${title}: окно открыто и закрыто без броска — ход и заряд целы`, async () => {
      const caster = { ...createCaster(), spells: [CHARGED_CONE] };
      const env = await loadCastEnvironment([caster]);
      const cast = await ENTRIES[entryName](env, structuredClone(caster));

      cast(CHARGED_CONE);
      await Promise.resolve();

      assert.ok(
        env.windows.some(({ name }) => name === 'DiceRollModal'),
        'окно броска открыто',
      );

      // Окно закрыли крестиком: бросок не звался
      assert.deepEqual(
        env.sends.filter(
          (entry) => entry.startsWith('turn:') || entry.startsWith('update:'),
        ),
        [],
      );

      assert.equal(env.world.get(caster.id).spells[0].uses.current, 1);
    });
  }

  for (const [title, entryName, createCaster] of [
    ['лист персонажа', 'sheet', createWizard],
    ['панель персонажа', 'hotbar', createWizard],
    ['лист существа', 'creatureSheet', createMage],
    ['панель существа', 'creatureHotbar', createMage],
  ]) {
    it(`${title}: отказ «нет зарядов» видит только действовавший — в чат ничего`, async () => {
      const spent = {
        ...CHARGED_CONE,
        uses: { ...CHARGED_CONE.uses, current: 0 },
      };

      const caster = { ...createCaster(), spells: [spent] };
      const env = await loadCastEnvironment([caster]);
      const cast = await ENTRIES[entryName](env, structuredClone(caster));

      cast(spent);
      await Promise.resolve();

      assert.deepEqual(env.sends, [
        `toast:${spent.name}: ${constants.ACTOR_SPELLS_TAB_LABELS.noUsesText}`,
      ]);
    });
  }

  it('атака заклинанием-эффектом: эффекты на цель — после доведения каста и только при попадании', async () => {
    const wizard = createWizard();

    const env = await loadCastEnvironment([
      wizard,
      createCreature({ id: 'target' }),
    ]);

    env.ports.openSpellCastWindow(
      {
        id: 'touch',
        name: 'Касание',
        level: 1,
        saveType: 'none',
        deliveryType: 'melee',
        activeEffects: [TARGET_EFFECT],
      },
      env.ports.createSpellCasterPort(wizard.id, () => {}),
    );

    const { props } = env.windows.at(-1);

    props.onSpellSlotConsume(1, true, false);
    props.onHit();
    props.onRoll(14);

    await Promise.resolve();
    await Promise.resolve();

    assert.ok(
      containsInOrder(env.sends, [
        'update:wizard',
        'complete',
        'targets:apply',
      ]),
      JSON.stringify(env.sends),
    );
  });
});
