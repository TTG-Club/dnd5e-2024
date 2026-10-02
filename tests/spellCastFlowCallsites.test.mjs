import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
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
 * роняет тест. Матрица «вход × вид каста» проверяет, что лист и горячая
 * панель дают одно окно и один порядок записей.
 */

const FLOW_PATH = 'src/client/composables/spellCastFlow.ts';
const CREATURE_FLOW_PATH = 'src/client/composables/creatureSpellCast.ts';

/**
 * Кому разрешён вызов. Определения функций и общий разбор — навсегда;
 * отмеченные «5.5» — атака оружием: её копии «лист против панели» ещё не
 * сведены.
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
    // Действие существа: лист и горячая панель — один путь
    'src/client/composables/creatureActionRoll.ts',
    // 5.5: атака оружием с горячей панели
    'src/client/macros/dnd5eMacros.ts',
    // 5.5: атака оружием с листа персонажа
    'src/client/ui/actor/tabs/ActorEquipmentTab.vue',
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
          /openModal\(\s*'DiceRollModal'/u.test(code)
          && /availableSpellLevels/u.test(code)
        );
      })
      .map(toSystemPath)
      .sort();

    assert.deepEqual(openers, [CREATURE_FLOW_PATH, FLOW_PATH].sort());
  });
});

// Подписи окна — настоящие константы клиента

const constants = await loadEngineBundle(`
  export {
    ACTOR_SPELLS_TAB_LABELS,
    SPELL_CAST_MODAL_KEY_PREFIX,
    SPELL_MENU_LABELS,
    SPELL_ROLL_BUTTON_LABELS,
  } from './src/client/ui/actor/constants.ts';
`);

/** Функции общего разбора, которые матрица собирает настоящими */
const FLOW_FUNCTIONS = [
  'openSpellCastWindow',
  'buildSpellSlotProps',
  'resolveCastableSpellLevels',
  'listSlotSpellLevels',
  'resolveSpellCasterSource',
  'targetEffectsSourceOf',
  'finishSpellCast',
  'claimCastTemplate',
  'markSpellCastApplied',
  'abandonSpellCast',
  'settleSpellRoll',
  'settleSpellRollParts',
  'settleSpellProjectileAttack',
  'settleNoRollSpellCast',
];

/**
 * Настоящий разбор каста персонажа на одном окружении: движок — настоящий,
 * сторы, окна и разбор целей — журналом.
 *
 * @param {object} target - выбранная цель
 * @returns {Promise<object>} окружение и журнал
 */
async function loadFlow(target) {
  const log = [];
  const modals = [];

  const ports = {
    ...engine,
    ...constants,
    console,
    generateId: (prefix) => `${prefix}_${modals.length}_${log.length}`,
    SPELL_CAST_KEY_PREFIX: 'cast',
    beginSpellCast: () => {},
    setSpellCastLevel: () => {},
    useBonusDamageParts: () => ({
      hasSpellBonusDamage: () => false,
      buildSpellBonusEvaluator: () => () => [],
    }),
    collectEffectsWithAuras: () => [],
    listAmbientEffects: () => [],
    useTargetStore: () => ({ getTargetActor: () => target }),
    useProjectileStore: () => ({
      isActive: true,
      sessionId: 'projectiles',
      startTargeting() {},
      stopTargeting() {},
    }),
    createProjectileCastValidator: () => () => true,
    isSpellTargetBlockedByRange: () => false,
    resolveTargetedAttackRoll: () => ({ mode: 'normal' }),
    buildRollBonusEvaluator: () => () => [],
    collectProjectileRollBonuses: () => new Map(),
    useWorldEntities: () => ({
      findCurrentDndEntity: () => undefined,
      getCurrentWorldEntities: () => [target],
    }),
    useChatStore: () => ({ getSocket: () => ({}) }),
    useWorldStore: () => ({ currentScene: { id: 'scene' } }),
    useSpellTemplateStore: () => ({
      getPlacedTemplate: (templateId) => ({ id: templateId }),
      removePlacedTemplate() {},
      deleteTemplate() {},
    }),
    window: { addEventListener() {}, removeEventListener() {} },
    useModalManager: () => ({
      openModal: (_name, props) => modals.push(props),
    }),
    // Разбор целей ждёт доведения каста — настоящим промисом
    afterSpellCast: (completion, proceed) => {
      completion.then(proceed);
    },
    completeSpellCast: () => {
      log.push('complete');

      return Promise.resolve();
    },
    resolveSpellTargets: (_session, damageTotal) =>
      log.push(`targets:resolve:${damageTotal}`),
    applySpellTargetEffects: () => log.push('targets:apply'),
    settleNoRollSpellTargets: () => log.push('targets:noRoll'),
    useSpellResolution: () => ({
      resolveSpellDamage: () => log.push('targets:projectiles'),
      resolveSpellDamageWithParts: () => log.push('targets:parts'),
    }),
  };

  for (const name of FLOW_FUNCTIONS) {
    ports[name] = await loadHandler(FLOW_PATH, name, ports);
  }

  return { ports, log, modals };
}

/**
 * Заклинатель: волшебник 5-го уровня с ячейками.
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

/**
 * Порт заклинателя: лист и горячая панель различаются только им.
 *
 * @param {object} caster - лист
 * @param {string[]} log - журнал
 * @returns {object} порт
 */
function createPort(caster, log) {
  return {
    casterId: caster.id,
    readCaster: () => caster,
    spendSlot: (castLevel) => log.push(`slot:${castLevel}`),
    spendUse: () => log.push('use'),
    refuse: () => log.push('refuse'),
  };
}

const TARGET_EFFECT = createEffect('mark', { effectTarget: 'target' });

const FORMS = [
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
    expected: { skipRoll: false, button: 'attack', formula: true },
  },
  {
    title: 'спасбросок с уроном',
    spell: {
      id: 'burst',
      name: 'Взрыв',
      level: 1,
      saveType: 'dexterity',
      // Волна от заклинателя: доставка «дальнобойная» с уроном сделала бы её
      // атакой со спасброском-райдером
      deliveryType: 'self',
      damageParts: [{ formula: '3к6', type: 'thunder' }],
    },
    expected: {
      skipRoll: false,
      button: 'damage',
      formula: true,
      targets: 'targets:resolve:7',
    },
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
    expected: { skipRoll: true, targets: 'targets:noRoll' },
  },
  {
    title: 'без броска на себя',
    spell: {
      id: 'shield',
      name: 'Щит',
      level: 1,
      saveType: 'none',
      deliveryType: 'self',
      activeEffects: [createEffect('shield', { effectTarget: 'self' })],
    },
    expected: { skipRoll: true, targets: 'targets:noRoll' },
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
    expected: { skipRoll: false, parts: true, targets: 'targets:parts' },
  },
];

describe('матрица: вход × вид каста', () => {
  for (const form of FORMS) {
    it(`${form.title}: лист и горячая панель — одно окно и один порядок`, async () => {
      const results = [];

      for (const entry of ['sheet', 'hotbar']) {
        const target = createCreature();
        const { ports, log, modals } = await loadFlow(target);
        const caster = createWizard();

        ports.openSpellCastWindow(form.spell, createPort(caster, log));

        const props = modals.at(-1);

        assert.ok(props, `${entry}: окно открылось`);
        assert.equal(Boolean(props.skipRoll), form.expected.skipRoll);

        if (form.expected.button) {
          assert.equal(
            props.rollButtonText,
            constants.SPELL_ROLL_BUTTON_LABELS[form.expected.button],
          );
        }

        if (form.expected.formula) {
          assert.ok(props.formula, `${form.title}: формула окна`);
        }

        // Окно: ячейка, затем применение
        props.onSpellSlotConsume?.(form.spell.level, true, false);

        if (form.expected.parts) {
          props.onRollParts([]);
        } else {
          props.onRoll(7);
        }

        await Promise.resolve();
        await Promise.resolve();

        const expectedLog = [`slot:${form.spell.level}`, 'complete'];

        if (form.expected.targets) {
          expectedLog.push(form.expected.targets);
        }

        assert.deepEqual(log.slice(0, expectedLog.length), expectedLog);

        results.push({
          skipRoll: Boolean(props.skipRoll),
          button: props.rollButtonText,
          levels: [...(props.availableSpellLevels ?? [])],
          log: [...log],
        });
      }

      assert.deepEqual(results[0], results[1], 'лист и панель совпали');
    });
  }

  it('атака заклинанием-эффектом: эффекты на цель — после доведения каста и только при попадании', async () => {
    const target = createCreature();
    const { ports, log, modals } = await loadFlow(target);

    const touch = {
      id: 'touch',
      name: 'Касание',
      level: 1,
      saveType: 'none',
      deliveryType: 'melee',
      activeEffects: [TARGET_EFFECT],
    };

    ports.openSpellCastWindow(touch, createPort(createWizard(), log));

    const props = modals.at(-1);

    props.onSpellSlotConsume(1, true, false);
    props.onHit();
    props.onRoll(14);

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(log, ['slot:1', 'complete', 'targets:apply']);
  });

  it('заговор без урона — без окна, сразу доведение и цели', async () => {
    const target = createCreature();
    const { ports, log, modals } = await loadFlow(target);

    ports.openSpellCastWindow(
      {
        id: 'guidance',
        name: 'Указание',
        level: 0,
        saveType: 'none',
        deliveryType: 'touch',
        activeEffects: [TARGET_EFFECT],
      },
      createPort(createWizard(), log),
    );

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modals.length, 0);
    assert.deepEqual(log, ['complete', 'targets:noRoll']);
  });
});
