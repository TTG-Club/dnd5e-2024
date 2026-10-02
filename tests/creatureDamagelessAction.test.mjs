import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

const composablePath = 'src/client/composables/creatureDamageChoice.ts';
const sheetPath = 'src/client/ui/creature/CreatureActionsBlock.vue';
const macroPath = 'src/client/macros/dnd5eMacros.ts';

/** Состояние на цель: ложится по провалу спасброска действия */
const PARALYZED = {
  id: 'effect_pod',
  name: 'Парализованный',
  effectTarget: 'target',
  conditionKey: 'paralyzed',
  changes: [],
  flags: [],
};

/** «Пленяющий стручок»: спасбросок Силы Сл 15, урона нет */
const POD = {
  name: 'Пленяющий стручок',
  saveType: 'strength',
  saveDC: 15,
  damageParts: [],
  activeEffects: [PARALYZED],
};

/** «Ужасающий облик»: конус без урона в «Бое» — урон несёт эффект */
const VISAGE = {
  name: 'Ужасающий облик',
  saveType: 'wisdom',
  saveDC: 13,
  areaOfEffect: { type: 'cone', size: 60 },
  activeEffects: [PARALYZED],
};

/** «Захват» бехира: спасбросок с уроном — окно броска остаётся */
const CONSTRICT = {
  name: 'Захват',
  saveType: 'strength',
  saveDC: 18,
  damageParts: [{ formula: '5к8@dmg.bludgeoning' }],
};

/**
 * Порты открытия окна броска действия: окно не рисуется, его настройки
 * остаются в `rollConfig`, применение записывается.
 *
 * @returns {Promise<object>} порты и журналы
 */
async function createPorts() {
  const applied = [];
  const rollConfig = { value: null };

  /** Части действия — как их отдаёт настоящая сборка: без урона пусто */
  const buildSetup = (options) => ({
    baseParts: (options.action.damageParts ?? []).map((part) => ({
      formula: part.formula,
      isHealing: false,
    })),
    evaluateBonusDamageParts: () => [],
    pseudoSpell: {
      name: options.action.name,
      saveType: options.action.saveType,
      activeEffects: options.action.activeEffects,
    },
  });

  const record = (...args) => {
    applied.push(args);
  };

  const shared = {
    creatureActionHasSave: engine.creatureActionHasSave,
    getDamagePartsPrimaryType: () => undefined,
    // Типа урона на выбор у фикстур нет: плашка пропускает действие сразу
    runWithDamageTypeChoices: (source, proceed) => proceed(source),
    announceCreatureDamageVariant: () => {},
  };

  const ports = {
    ...shared,
    rollConfig,
    isRollModalOpen: { value: false },
    buildCreatureRollVariants: await loadHandler(
      composablePath,
      'buildCreatureRollVariants',
      shared,
    ),
    runDamagelessCreatureAction: await loadHandler(
      composablePath,
      'runDamagelessCreatureAction',
      shared,
    ),
    useModalManager: () => ({
      openModal: (_name, props) => {
        rollConfig.value = props;
      },
    }),
    useBonusDamageParts: () => ({
      buildCreatureRollSetup: buildSetup,
      buildTargetHpContext: () => undefined,
    }),
    buildCreatureRollSetup: buildSetup,
    buildTargetHpContext: () => undefined,
    buildRollBonusEvaluator: () => () => [],
    getCreatureEntity: () => undefined,
    useWorldEntities: () => ({ findCurrentDndEntity: () => undefined }),
    collectActiveEffects: () => [],
    getAttackFlagCategory: engine.getAttackFlagCategory,
    getAttackBonusKey: engine.getAttackBonusKey,
    resolveTargetedAttackRoll: () => ({
      mode: 'normal',
      reasons: { advantage: [], disadvantage: [] },
    }),
    discardSpellTemplate: () => {},
    applyActionParts: record,
    applyCreatureActionParts: record,
    CREATURE_ACTIONS_BLOCK_LABELS: { attackRollPrefix: 'Attack ' },
    CREATURE_ACTION_MENU_LABELS: { attack: 'attack' },
    SPELL_DAMAGE_ROLL_BUTTON: 'roll',
  };

  return { ports, applied, rollConfig };
}

describe('действие существа со спасброском и без урона', () => {
  const creature = { id: 'plant', name: 'Растение-похититель' };

  for (const [path, name, creatureFirst] of [
    [sheetPath, 'startActionRoll', false],
    [macroPath, 'openCreatureActionRoll', true],
  ]) {
    /**
     * Запускает настоящий обработчик листа или горячей панели.
     *
     * @param {object} action - действие существа
     * @param {string | undefined} templateId - шаблон области
     * @returns {Promise<object>} журналы применения и окна
     */
    const launch = async (action, templateId) => {
      const { ports, applied, rollConfig } = await createPorts();
      const handler = await loadHandler(path, name, ports);

      handler(
        ...(creatureFirst
          ? [creature, action, false, templateId]
          : [action, creature, false, templateId]),
      );

      return { applied, rollConfig, opened: ports.isRollModalOpen.value };
    };

    it(`${name}: цель спасается сразу, окна броска нет`, async () => {
      const { applied, rollConfig, opened } = await launch(POD, undefined);

      assert.equal(rollConfig.value, null, 'окно не настраивалось');
      assert.equal(opened, false, 'окно не открывалось');
      assert.equal(applied.length, 1, 'применение вызвано один раз');

      const [args] = applied;
      const parts = args.find((arg) => Array.isArray(arg));
      const actionSpell = args.find((arg) => arg?.saveType && !arg.saveDC);

      // Массив создан в песочнице обработчика — сравнивается по длине
      assert.equal(parts.length, 0, 'частей урона нет — разбор по эффектам');
      assert.equal(actionSpell.saveType, 'strength');
      assert.equal(actionSpell.activeEffects[0].conditionKey, 'paralyzed');
    });

    it(`${name}: область без урона применяет шаблон`, async () => {
      const { applied, rollConfig } = await launch(VISAGE, 'template_cone');

      assert.equal(rollConfig.value, null);
      assert.equal(applied.length, 1);

      assert.ok(
        applied[0].includes('template_cone'),
        'шаблон дошёл до разбора',
      );
    });

    it(`${name}: спасбросок с уроном по-прежнему бросают окном`, async () => {
      const { applied, rollConfig, opened } = await launch(
        CONSTRICT,
        undefined,
      );

      assert.equal(applied.length, 0, 'до броска ничего не применено');

      const config = rollConfig.value;

      assert.equal(config.damageParts.length, 1);
      assert.equal(typeof config.onRollParts, 'function');

      // Лист открывает своё окно флагом, горячая панель — менеджером окон
      assert.equal(opened, !creatureFirst);
    });
  }
});

describe('признак «действие без урона»', () => {
  /**
   * Настоящий разбор с записью применения.
   *
   * @param {object} action - действие
   * @param {object[]} rollVariants - наборы урона окна
   * @returns {Promise<{ handled: boolean, applied: unknown[][] }>} итог
   */
  async function run(action, rollVariants) {
    const applied = [];

    const handler = await loadHandler(
      composablePath,
      'runDamagelessCreatureAction',
      {
        creatureActionHasSave: engine.creatureActionHasSave,
        runWithDamageTypeChoices: (source, proceed) => proceed(source),
      },
    );

    const handled = handler(
      action,
      rollVariants,
      (chosen) => ({ name: chosen.name }),
      (...args) => applied.push(args),
    );

    return { handled, applied };
  }

  it('атака без спасброска и области идёт окном броска', async () => {
    const bite = { name: 'Укус', attackBonus: 5, damageParts: [] };
    const { handled, applied } = await run(bite, [{ damageParts: [] }]);

    assert.equal(handled, false);
    assert.equal(applied.length, 0);
  });

  it('урон хотя бы в одном наборе «или» — окно броска', async () => {
    const { handled } = await run(POD, [
      { damageParts: [] },
      { damageParts: [{ formula: '2к6' }] },
    ]);

    assert.equal(handled, false);
  });

  it('спасбросок без урона уходит на применение с пустыми частями', async () => {
    const { handled, applied } = await run(POD, [{ damageParts: [] }]);

    assert.equal(handled, true);
    assert.equal(applied.length, 1);

    const [[chosenAction, actionSpell, parts]] = applied;

    assert.equal(chosenAction, POD);
    assert.equal(actionSpell.name, POD.name);
    assert.equal(parts.length, 0);
  });
});
