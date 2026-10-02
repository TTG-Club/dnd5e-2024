import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { it } from 'vitest';

import { loadEngineBundle, systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Вид каста решает одна функция движка (`resolveSpellCastPlan`) на все входы.
 * Раньше горячая панель открывала окно броска у заклинания со спасброском без
 * урона: окно без формулы катило d20, и итог проверки уходил в разбор как
 * урон («Удержание личности» снимало хиты). Тест держит таблицу форм
 * заклинания, вызовы плана на листе и панели и страховку разбора.
 */

// Движок собирается один раз на файл

const engine = await loadEngineBundle(`
  export * from './src/engine/spellCastPlan.ts';
  export { getSpellAttackType } from './src/engine/spellUtils.ts';
`);

const SHEET_PATH = 'src/client/ui/actor/tabs/ActorSpellsTab.vue';
const MACRO_PATH = 'src/client/macros/dnd5eMacros.ts';
const CREATURE_PATH = 'src/client/composables/creatureSpellCast.ts';
const FLOW_PATH = 'src/client/composables/spellCastFlow.ts';

/** Эффект «на цель» без своего спасброска и урона */
const TARGET_EFFECT = {
  id: 'effect_target',
  name: 'Эффект цели',
  effectTarget: 'target',
  changes: [],
};

/** Эффект «на себя» */
const SELF_EFFECT = {
  id: 'effect_self',
  name: 'Эффект на себя',
  effectTarget: 'self',
  changes: [],
};

/**
 * Заклинание-заготовка: всё, чего форма не задаёт, — «нет».
 *
 * @param {object} fields - поля формы
 * @returns {object} заклинание
 */
function spell(fields) {
  return {
    id: fields.name,
    level: 1,
    saveType: 'none',
    deliveryType: 'self',
    damageParts: [],
    activeEffects: [],
    ...fields,
  };
}

const FIRE_BOLT = spell({
  name: 'Огненный снаряд',
  level: 0,
  deliveryType: 'ranged',
  damageParts: [{ formula: '1к10', type: 'fire' }],
});

const FIREBALL = spell({
  name: 'Огненный шар',
  level: 3,
  saveType: 'dexterity',
  deliveryType: 'area',
  areaOfEffect: { shape: 'sphere', size: 20 },
  damageParts: [{ formula: '8к6', type: 'fire' }],
});

const HOLD_PERSON = spell({
  name: 'Удержание личности',
  level: 2,
  saveType: 'wisdom',
  deliveryType: 'ranged',
  activeEffects: [TARGET_EFFECT],
});

const ENSNARING_STRIKE = spell({
  name: 'Опутывающий удар',
  saveType: 'strength',
  deliveryType: 'melee',
  activeEffects: [TARGET_EFFECT],
});

const BLESS = spell({
  name: 'Благословение',
  deliveryType: 'touch',
  activeEffects: [TARGET_EFFECT],
});

const SHIELD = spell({ name: 'Щит', activeEffects: [SELF_EFFECT] });

const CURE_WOUNDS = spell({
  name: 'Лечение ран',
  deliveryType: 'touch',
  damageParts: [{ formula: '2к8@heal' }],
});

const MAGIC_MISSILE = spell({
  name: 'Волшебная стрела',
  deliveryType: 'ranged',
  autoHit: true,
  damageParts: [{ formula: '1к4+1', type: 'force' }],
});

const ELDRITCH_BLAST = spell({
  name: 'Мистический заряд',
  level: 0,
  deliveryType: 'ranged',
  damageParts: [{ formula: '1к10', type: 'force' }],
});

const SHOCKING_TOUCH = spell({
  name: 'Касание с эффектом',
  deliveryType: 'melee',
  activeEffects: [TARGET_EFFECT],
});

/** Общие признаки каста без снарядов, бонус-урона и шаблона */
const PLAIN = {
  hasProjectiles: false,
  hasBonusDamage: false,
  isInnate: false,
  hasTemplate: false,
};

const TABLE = [
  {
    title: 'атака с уроном',
    input: { spell: FIRE_BOLT, damageParts: FIRE_BOLT.damageParts },
    expected: { window: 'roll', rollKind: 'attack', flow: 'single' },
  },
  {
    title: 'спасбросок с уроном, область',
    input: {
      spell: FIREBALL,
      damageParts: FIREBALL.damageParts,
      hasTemplate: true,
    },
    expected: {
      window: 'roll',
      rollKind: 'damage',
      flow: 'single',
      needsSave: true,
      needsTargetResolution: true,
      multiTarget: true,
    },
  },
  {
    title: 'спасбросок без урона — «Удержание личности»',
    input: { spell: HOLD_PERSON, damageParts: [] },
    expected: {
      window: 'confirm',
      flow: 'effectsOnly',
      needsSave: true,
      needsTargetResolution: true,
      hasTargetEffects: true,
    },
  },
  {
    title: 'спасбросок без урона — «Опутывающий удар»',
    input: { spell: ENSNARING_STRIKE, damageParts: [] },
    expected: {
      window: 'confirm',
      flow: 'effectsOnly',
      needsSave: true,
      hasTargetEffects: true,
    },
  },
  {
    title: 'спасбросок без урона, врождённое — без окна',
    input: { spell: HOLD_PERSON, damageParts: [], isInnate: true },
    expected: { window: 'none', flow: 'effectsOnly', needsSave: true },
  },
  {
    title: 'только эффект на цель',
    input: { spell: BLESS, damageParts: [] },
    expected: {
      window: 'confirm',
      flow: 'effectsOnly',
      needsSave: false,
      needsTargetResolution: false,
      hasTargetEffects: true,
    },
  },
  {
    title: 'только на себя — «Щит»',
    input: { spell: SHIELD, damageParts: [] },
    expected: {
      window: 'confirm',
      flow: 'effectsOnly',
      hasTargetEffects: false,
    },
  },
  {
    title: 'лечение',
    input: { spell: CURE_WOUNDS, damageParts: CURE_WOUNDS.damageParts },
    expected: { window: 'roll', rollKind: 'healing', flow: 'multiPart' },
  },
  {
    title: 'автопопадание',
    input: { spell: MAGIC_MISSILE, damageParts: MAGIC_MISSILE.damageParts },
    expected: {
      window: 'roll',
      rollKind: 'damage',
      flow: 'single',
      needsTargetResolution: true,
    },
  },
  {
    title: 'снаряды без атаки',
    input: {
      spell: MAGIC_MISSILE,
      damageParts: MAGIC_MISSILE.damageParts,
      hasProjectiles: true,
    },
    expected: {
      window: 'roll',
      flow: 'projectileAutoHit',
      needsTargetResolution: true,
      multiTarget: true,
    },
  },
  {
    title: 'снаряды с атакой',
    input: {
      spell: ELDRITCH_BLAST,
      damageParts: ELDRITCH_BLAST.damageParts,
      hasProjectiles: true,
    },
    expected: { window: 'roll', rollKind: 'attack', flow: 'projectileSeries' },
  },
  {
    title: 'заговор: ступень заменяет части записи',
    input: {
      spell: { ...FIRE_BOLT, damageParts: [] },
      damageParts: [{ formula: '2к10', type: 'fire' }],
    },
    expected: { window: 'roll', rollKind: 'attack', hasDamage: true },
  },
  {
    title: 'бонус-урон эффектов — многочастный путь',
    input: {
      spell: FIRE_BOLT,
      damageParts: FIRE_BOLT.damageParts,
      hasBonusDamage: true,
    },
    expected: { window: 'roll', flow: 'multiPart' },
  },
  {
    title: 'атака без урона с эффектом по попаданию — окно атаки',
    input: { spell: SHOCKING_TOUCH, damageParts: [] },
    expected: { window: 'roll', rollKind: 'attack', hasDamage: false },
  },
];

for (const row of TABLE) {
  it(`план каста: ${row.title}`, () => {
    const plan = engine.resolveSpellCastPlan({ ...PLAIN, ...row.input });

    for (const [key, value] of Object.entries(row.expected)) {
      assert.equal(plan[key], value, `${row.title}: ${key}`);
    }
  });
}

it('без частей урона и без атаки окна броска нет ни при каком спасброске', () => {
  for (const saveType of [
    'none',
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]) {
    for (const isInnate of [false, true]) {
      for (const level of [0, 1, 5]) {
        const plan = engine.resolveSpellCastPlan({
          ...PLAIN,
          // Доставка без броска: у «none» касание атакой не считается
          spell: { ...HOLD_PERSON, deliveryType: 'touch', saveType, level },
          damageParts: [],
          isInnate,
        });

        assert.notEqual(plan.window, 'roll', `${saveType}/${level}`);
        assert.equal(plan.rollKind, undefined);
        assert.equal(plan.flow, 'effectsOnly');
      }
    }
  }
});

it('урон окна без частей урона в разбор не идёт', () => {
  assert.equal(engine.resolvePlannedDamageTotal({ hasDamage: false }, 17), 0);
  assert.equal(engine.resolvePlannedDamageTotal({ hasDamage: true }, 17), 17);
});

/**
 * Исходник файла системы.
 *
 * @param {string} relativePath - путь от корня
 * @returns {Promise<string>} текст файла
 */
function readSource(relativePath) {
  return readFile(join(systemRoot, relativePath), 'utf8');
}

it('окно каста решает план — в общем разборе каста, своего условия окна нет нигде', async () => {
  const flow = await readSource(FLOW_PATH);

  assert.match(flow, /resolveSpellCastPlan\(/u);

  // «Бросить урон» собирается только из плана
  assert.match(flow, /SPELL_ROLL_BUTTON_LABELS\[plan\.rollKind/u);

  for (const relativePath of [SHEET_PATH, MACRO_PATH, FLOW_PATH]) {
    const source = await readSource(relativePath);

    // Прежние собственные условия окна
    assert.doesNotMatch(source, /spellHasDamage\(spell\)\s*\|\|/u);
    assert.doesNotMatch(source, /\|\|\s*spell\.saveType !== 'none'\s*\)/u);

    assert.doesNotMatch(
      source,
      /spellDamageParts\.length === 0 && !getSpellAttackType/u,
    );

    assert.doesNotMatch(source, /needsAutoResolution\(/u);
    assert.doesNotMatch(source, /castNeedsMultiPart\(/u);
    assert.doesNotMatch(source, /'Бросить урон'/u);
  }

  // Лист и горячая панель своего окна каста не собирают — зовут общий разбор
  for (const relativePath of [SHEET_PATH, MACRO_PATH]) {
    const source = await readSource(relativePath);

    assert.match(source, /startSpellCast\(/u);
    assert.doesNotMatch(source, /resolveSpellCastPlan\(/u);
  }
});

it('каст существа решает окно тем же планом, с правилом атаки существа', async () => {
  const source = await readSource(CREATURE_PATH);

  // Своего условия «без окна» у существа больше нет — решает план
  assert.match(source, /resolveSpellCastPlan\(/u);
  assert.match(source, /plan\.window !== 'roll'/u);
  assert.match(source, /forceMultiPart: true/u);

  for (const row of TABLE.filter((entry) => !entry.input.hasProjectiles)) {
    const castSpell = row.input.spell;

    // Правило существа: со спасброском или областью броска попадания нет
    const usesSaveOrArea =
      (!!castSpell.saveType && castSpell.saveType !== 'none')
      || !!castSpell.areaOfEffect;

    const attackType = usesSaveOrArea
      ? null
      : (engine.getSpellAttackType(castSpell) ?? null);

    const plan = engine.resolveSpellCastPlan({
      ...PLAIN,
      ...row.input,
      isInnate: true,
      attackType,
      forceMultiPart: true,
    });

    // Прежнее условие существа «без окна» и план совпадают
    assert.equal(
      plan.window !== 'roll',
      attackType === null && row.input.damageParts.length === 0,
      `существо и план разошлись: ${row.title}`,
    );

    if (plan.window === 'roll') {
      assert.equal(plan.flow, 'multiPart', row.title);
    }
  }
});

/**
 * Каст с открытым окном и журнал вызовов разбора целей.
 *
 * @param {object} plan - план каста
 * @returns {{ session: object, calls: number[], ports: object }} каст, журнал и порты
 */
function createRollSession(plan) {
  const calls = [];

  return {
    calls,
    session: {
      port: { casterId: 'caster' },
      plan,
      state: { spell: HOLD_PERSON, attackLanded: false, applied: false },
    },
    ports: {
      markSpellCastApplied: (session) => {
        session.state.applied = true;
      },
      resolvePlannedDamageTotal: engine.resolvePlannedDamageTotal,
      claimCastTemplate: () => null,
      finishSpellCast: () => Promise.resolve(),
      afterSpellCast: (_completion, proceed) => proceed(),
      applySpellTargetEffects() {},
      targetEffectsSourceOf: () => ({ casterId: 'caster', spellSaveDC: 13 }),
      resolveSpellTargets: (_session, damageTotal) => calls.push(damageTotal),
    },
  };
}

it('подтверждение окна: итог без частей урона уходит в разбор нулём', async () => {
  for (const [hasDamage, expected] of [
    [false, 0],
    [true, 17],
  ]) {
    const { session, calls, ports } = createRollSession({
      hasDamage,
      needsTargetResolution: true,
      needsSave: true,
      hasTargetEffects: true,
    });

    const settle = await loadHandler(FLOW_PATH, 'settleSpellRoll', ports);

    // Окно без формулы катило бы d20: 17 — итог проверки, а не урон
    settle(session, 17);
    assert.deepEqual(calls, [expected]);
    assert.equal(session.state.applied, true);
  }
});
