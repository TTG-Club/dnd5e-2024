import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Снаряды заклинаний существа. Раньше каст от НПС шёл без них: «Палящий луч»
 * бросал одну атаку, «Волшебная стрела» — один урон одной цели (жалоба мастера
 * 15.11, система 0.8.317). Теперь существо идёт путём персонажа: выбор целей
 * снарядов до каста, затем окно, которое катит формулу на каждый снаряд.
 */

const CREATURE_SPELL_PATH = 'src/client/composables/creatureSpellCast.ts';

const MAGE = { id: 'mage', name: 'Маг', entityType: 'creature' };

/** «Волшебная стрела»: три снаряда без броска атаки, +1 за круг выше */
const MAGIC_MISSILE = {
  id: 'magic-missile',
  name: 'Волшебная стрела',
  level: 1,
  saveType: 'none',
  deliveryType: 'ranged',
  autoHit: true,
  projectiles: { count: 3, perSlotLevel: 1 },
  damageParts: [{ formula: '1к4+1', type: 'force' }],
};

/** «Палящий луч»: три луча, на каждый — бросок атаки */
const SCORCHING_RAY = {
  id: 'scorching-ray',
  name: 'Палящий луч',
  level: 2,
  saveType: 'none',
  deliveryType: 'ranged',
  projectiles: { count: 3, perSlotLevel: 1 },
  damageParts: [{ formula: '2к6', type: 'fire' }],
};

/** «Огненный снаряд»: один снаряд — обычный каст без выбора снарядов */
const FIRE_BOLT = {
  id: 'fire-bolt',
  name: 'Огненный снаряд',
  level: 0,
  saveType: 'none',
  deliveryType: 'ranged',
  damageParts: [{ formula: '1к10', type: 'fire' }],
};

/**
 * Настоящий каст существа с подменённым окружением.
 *
 * @returns {Promise<object>} вход каста, журнал и открытые окна
 */
async function loadCreatureCast() {
  const log = [];

  /** Открытые окна по имени: выбор снарядов и окно броска */
  const modals = [];

  /** Окна броска: свойства и параметры открытия */
  const rollWindows = [];

  /** Вызовы разбора одной формулой */
  const resolutions = [];

  const projectileStore = {
    isActive: false,
    sessionId: 0,
    count: 0,
    startTargeting(_distribution, count) {
      this.isActive = true;
      this.sessionId += 1;
      this.count = count;
      log.push(`targeting:${count}`);
    },
    stopTargeting() {
      this.isActive = false;
      log.push('targeting:stop');
    },
  };

  const ports = {
    ...engine,
    readCreature: () => MAGE,
    resolveSpellCastBlock: () => null,
    listAmbientEffects: () => [],
    retypeCasterSpellDamage: (spell) => spell,
    runWithEffectVariants: (spell, proceed) => proceed(spell),
    hasLiveCreatureSpellUsesLeft: () => true,
    findSpellGroupLimitBlock: () => undefined,
    runWithCastFailure: (_spell, _caster, _options, proceed) => {
      log.push('cast-failure-check');
      proceed();
    },
    recordEntityActionSpend: () => log.push('turn'),
    dispatchSpellCastTriggers: () => {},
    useTargetStore: () => ({ getTargetActor: () => null }),
    getCreatureSpellBlockAbility: () => 'intelligence',
    useBonusDamageParts: () => ({
      buildCreatureSpellRollSetup: ({ spell }) => ({
        baseParts: spell.damageParts.map((part) => ({ ...part })),
        pseudoSpell: spell,
        evaluateBonusDamageParts: () => [],
      }),
    }),
    collectActiveEffects: () => [],
    calculateCreatureSpellBlockNumbers: () => ({ attackBonus: 6, saveDC: 14 }),
    getCreatureSpellMod: () => 3,
    generateId: (prefix) => `${prefix}-1`,
    SPELL_CAST_KEY_PREFIX: 'cast',
    SPELL_ATTACK_KEY: 'attack.spell',
    beginSpellCast: () => {},
    resolveTargetedAttackRoll: () => ({ mode: 'normal' }),
    buildRollBonusEvaluator: () => () => [],
    collectProjectileRollBonuses: () => new Map(),
    getCreatureSpellRollButtonText: () => 'Бросок',
    requestDamageTypeChoiceFor: () => undefined,
    buildRollSourceKey: (...parts) => parts.join(':'),
    closeRollWindow: () => false,
    useProjectileStore: () => projectileStore,
    isSpellTargetBlockedByRange: () => false,
    createProjectileCastValidator: (hasProjectiles) => {
      const session = projectileStore.sessionId;

      return () =>
        !hasProjectiles
        || (projectileStore.isActive && projectileStore.sessionId === session);
    },
    useModalManager: () => ({
      openModal: (name, props) => {
        modals.push({ name, props });

        return 'modal';
      },
    }),
    PROJECTILE_PROMPT_MODAL: 'ProjectilePromptModal',
    PROJECTILE_MODAL_KEY_PREFIX: 'projectile',
    openDiceRollWindow: (props, options) => {
      rollWindows.push({ props, options });

      return 'roll-window';
    },
    completeSpellCast: () => Promise.resolve(),
    afterSpellCast: (_pending, proceed) => proceed(),
    useChatStore: () => ({ getSocket: () => ({}) }),
    listAttackResolutionEntities: () => [MAGE],
    useWorldStore: () => ({ currentScene: { id: 'scene' } }),
    useSpellResolution: () => ({
      resolveSpellDamage: (context, options) =>
        resolutions.push({ context, options }),
      resolveSpellDamageWithParts: () => log.push('multi-part'),
    }),
    CREATURE_ACTIONS_BLOCK_LABELS: { attackRollPrefix: 'Атака: ' },
    ACTOR_SPELLS_TAB_LABELS: { noUsesTitle: 'Нет зарядов' },
  };

  // Общий выбор снарядов персонажа и существа — настоящий
  ports.requestProjectileTargets = await loadHandler(
    'src/client/composables/spellEffectTargeting.ts',
    'requestProjectileTargets',
    ports,
  );

  for (const name of [
    'applyCreatureSpellProjectiles',
    'openCreatureProjectileRoll',
    'applyCreatureSpellParts',
    'openCreatureSpellRoll',
  ]) {
    ports[name] = await loadHandler(CREATURE_SPELL_PATH, name, ports);
  }

  const start = await loadHandler(
    CREATURE_SPELL_PATH,
    'startCreatureSpellCast',
    ports,
  );

  return {
    log,
    modals,
    rollWindows,
    resolutions,
    projectileStore,
    start: (spell, placement) =>
      start(spell, placement, {
        creatureId: MAGE.id,
        spendUse: () => log.push('use'),
        refuse: (_spell, refusal) => log.push(`refuse:${refusal.title}`),
      }),
  };
}

/**
 * Подтверждает выбор снарядов — как кнопка окна выбора.
 *
 * @param {object[]} modals - открытые окна
 */
function confirmProjectiles(modals) {
  const prompt = modals.find((modal) => modal.name === 'ProjectilePromptModal');

  assert.ok(prompt, 'окно выбора снарядов открыто');
  prompt.props.onConfirm(prompt.props.availableSpellLevels[0]);
}

describe('снаряды заклинаний существа', () => {
  it('«Волшебная стрела»: выбор трёх снарядов до каста, урон каждого — разбором снарядов', async () => {
    const { log, modals, rollWindows, resolutions, start } =
      await loadCreatureCast();

    start(MAGIC_MISSILE);

    // Сначала выбор целей; проверка провала каста — только после него
    assert.deepEqual(log, ['targeting:3']);
    assert.equal(rollWindows.length, 0);

    confirmProjectiles(modals);

    assert.deepEqual(log, ['targeting:3', 'cast-failure-check']);
    assert.equal(rollWindows.length, 1);

    const [{ props, options }] = rollWindows;

    // Без броска атаки и без частей урона: формула катится на каждый снаряд
    assert.equal(props.attackModifier, undefined);
    assert.equal(props.onProjectileAttack, undefined);
    assert.equal(props.damageParts, undefined);
    assert.equal(props.onRollParts, undefined);
    assert.equal(props.skipChatMessage, true);

    // Бросок окна: проверка выбора снарядов и расход хода с применением
    assert.equal(options.validateRoll(), true);
    assert.equal(options.commit(), true);
    assert.deepEqual(log.slice(2), ['turn', 'use']);

    props.onRoll(7);

    assert.equal(resolutions.length, 1);
    assert.equal(resolutions[0].options.hasProjectiles, true);
    assert.equal(resolutions[0].options.resolvedDamageFormula, '1к4+1');
    assert.equal(resolutions[0].options.projectileAttack, undefined);
    assert.equal(resolutions[0].context.casterId, MAGE.id);
    assert.equal(resolutions[0].context.spellSaveDC, 14);
  });

  it('круг из группы статблока добавляет снаряды', async () => {
    const { log, start } = await loadCreatureCast();

    start(MAGIC_MISSILE, {
      ref: { castLevel: 3 },
      block: {},
      group: { id: 'group', mode: 'perSpell' },
    });

    assert.deepEqual(log, ['targeting:5']);
  });

  it('«Палящий луч»: серия атак — бросок попадания на каждый луч', async () => {
    const { modals, rollWindows, resolutions, start } =
      await loadCreatureCast();

    start(SCORCHING_RAY);
    confirmProjectiles(modals);

    const [{ props }] = rollWindows;

    assert.equal(props.attackModifier, 6);
    assert.equal(props.attackerId, MAGE.id);
    assert.equal(typeof props.onProjectileAttack, 'function');
    assert.equal(typeof props.evaluateProjectileBonusRollFormulas, 'function');

    props.onProjectileAttack({
      attackModifier: 6,
      rollMode: 'advantage',
      bonusDiceFormulasByTarget: new Map(),
    });

    assert.equal(resolutions.length, 1);

    const { options } = resolutions[0];

    assert.equal(options.hasProjectiles, true);
    assert.equal(options.resolvedDamageFormula, '2к6');
    assert.equal(options.projectileAttack.attackType, 'ranged');
    assert.equal(options.projectileAttack.rollMode, 'advantage');
  });

  it('окно закрыто без броска — выбор снарядов отпускается', async () => {
    const { log, modals, rollWindows, start } = await loadCreatureCast();

    start(SCORCHING_RAY);
    confirmProjectiles(modals);
    rollWindows[0].options.onClose(false);

    assert.equal(log.at(-1), 'targeting:stop');
    assert.equal(log.includes('turn'), false);
  });

  it('после броска закрытие окна выбор не трогает: его снимает разбор', async () => {
    const { log, modals, rollWindows, start } = await loadCreatureCast();

    start(MAGIC_MISSILE);
    confirmProjectiles(modals);
    rollWindows[0].props.onRoll(7);
    rollWindows[0].options.onClose(false);

    assert.equal(log.includes('targeting:stop'), false);
  });

  it('один снаряд — обычный каст: без выбора снарядов, многочастным путём', async () => {
    const { log, modals, rollWindows, start } = await loadCreatureCast();

    start(FIRE_BOLT);

    assert.deepEqual(log, ['cast-failure-check']);
    assert.equal(modals.length, 0);
    assert.equal(typeof rollWindows[0].props.onRollParts, 'function');
  });
});
