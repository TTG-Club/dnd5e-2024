import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { it } from 'vitest';

import { loadEngineBundle, systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle(
  `export * from './src/engine/attackUtils.ts'; export * from './src/engine/effectPipeline.ts'; export * from './src/engine/formulaParser.ts'; export { rollEffectSavingThrow } from './src/engine/turnEffects.ts'; export { DEFAULT_ACTOR, MAX_ROLL_BONUS_DICE, MAX_ROLL_BONUS_DIE_SIDES } from './src/engine/consts.ts';`,
);

const normalContext = { hasAdvantage: false, hasDisadvantage: false };

const abilityKeys = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

const attackKeys = ['attack.melee', 'attack.ranged', 'attack.spell'];

const blessKeys = [
  ...attackKeys,
  ...abilityKeys.map((ability) => `save.${ability}`),
];

/** Создаёт бонус эффекта в форме PROD-редактора. */
function change(key, value = '1d4', condition = '') {
  return { key, mode: 'add', value, priority: 20, condition };
}

/** Создаёт эффект с заданными модификаторами. */
function effect(changes, disabled = false) {
  return {
    id: 'bless',
    name: 'Благословение',
    disabled,
    origin: 'spell',
    transfer: false,
    duration: { type: 'minutes', value: 1 },
    changes,
    flags: [],
  };
}

/** Создаёт ответ роллера с независимой d20 и бонусной костью. */
function rolled(natural, bonus, modifier = 5) {
  return {
    formula: '1к20+5+1d4',
    total: natural + bonus + modifier,
    details: '',
    dice: [
      {
        count: 1,
        sides: 20,
        values: [natural],
        dropped: [],
        critSuccesses: [],
        critFailures: [],
      },
      {
        count: 1,
        sides: 4,
        values: [bonus],
        dropped: [],
        critSuccesses: [],
        critFailures: [],
      },
    ],
  };
}

it('pROD Bless modifiers leave sheet numbers stable and add one d4 to each attack/save only', () => {
  const actor = structuredClone(engine.DEFAULT_ACTOR);
  const baseline = engine.resolveActorStats(actor);

  actor.activeEffects = [effect(blessKeys.map((key) => change(key)))];

  const resolved = engine.resolveActorStats(actor);

  assert.deepEqual(resolved.saves, baseline.saves);
  assert.deepEqual(resolved.attackBonuses, baseline.attackBonuses);

  const effects = engine.collectActiveEffects(actor);

  for (const key of blessKeys) {
    assert.deepEqual(
      engine.collectBonusRollFormulas(effects, key, normalContext),
      ['1d4'],
    );
  }

  for (const key of [
    'skill.arcana',
    'initiative',
    'armorClass',
    'damage.spell',
  ]) {
    assert.deepEqual(
      engine.collectBonusRollFormulas(effects, key, normalContext),
      [],
    );
  }
});

it('conditional dice are counted once, numeric bonuses stay numeric, disabled/unsupported changes do not contribute', () => {
  const effects = [
    effect([
      change('attack.melee', '1d4'),
      change('attack.melee', '2'),
      change('attack.melee', '1d6', 'roll.hasAdvantage === true'),
      { ...change('attack.melee', '1d8'), mode: 'override' },
    ]),
    effect([change('attack.melee', '1d10')], true),
  ];

  assert.deepEqual(
    engine.collectBonusRollFormulas(effects, 'attack.melee', normalContext),
    ['1d4'],
  );

  const advantage = { hasAdvantage: true, hasDisadvantage: false };

  assert.deepEqual(
    engine.collectBonusRollFormulas(effects, 'attack.melee', advantage),
    ['1d4', '1d6'],
  );

  assert.equal(
    engine.evaluateConditionalBonuses(effects, 'attack.melee', advantage),
    0,
  );
});

it('roll bonuses normalize Russian dice, signed penalties and actor formula variables', () => {
  const actor = structuredClone(engine.DEFAULT_ACTOR);

  const formulas = engine.collectBonusRollFormulas(
    [
      effect([
        change('save.wisdom', 'к4 + @prof'),
        change('save.wisdom', '-1д4'),
      ]),
    ],
    'save.wisdom',
    normalContext,
    engine.buildFormulaContext(actor),
  );

  assert.deepEqual(formulas, ['1d4+2', '-1d4']);

  assert.equal(
    engine.buildAttackFormula(3, 'normal', formulas),
    '1к20+3+1d4+2-1d4',
  );
});

for (const [natural, bonus, expectedCritical, expectedMiss] of [
  [20, 4, true, false],
  [16, 4, false, false],
  [1, 4, false, true],
]) {
  it(`attack natural ${natural} stays natural with +${bonus} bonus die`, () => {
    const result = engine.performTwoStageAttack(
      {
        attackFormula: '1к20+5+1d4',
        attackModifier: 5,
        targetAc: 10,
        weaponName: 'меч',
        targetName: 'цель',
      },
      () => rolled(natural, bonus),
    );

    assert.equal(result.attackResult.naturalRoll, natural);
    assert.equal(result.attackResult.isCriticalHit, expectedCritical);
    assert.equal(result.attackResult.isCriticalMiss, expectedMiss);
    assert.equal(result.attackResult.isHit, !expectedMiss);
  });
}

it('advantage/disadvantage use the kept d20 instead of the first die or the bonus', () => {
  for (const dropped of [[0], [1]]) {
    const result = rolled(4, 4);

    result.dice[0] = { ...result.dice[0], count: 2, values: [4, 19], dropped };
    assert.equal(engine.getNaturalD20Roll(result), dropped[0] === 0 ? 19 : 4);
  }
});

it('a foreign roll without a single kept d20 is reported as unknown instead of throwing', () => {
  const valid = rolled(12, 3);

  assert.equal(engine.parseNaturalD20Roll(valid), 12);

  for (const malformed of [
    {},
    { dice: [] },
    { dice: [{ ...valid.dice[0], sides: 6 }] },
    { dice: [{ sides: 20, values: [7] }] },
    { dice: [{ ...valid.dice[0], values: [4, 19], dropped: [] }] },
  ]) {
    assert.equal(engine.parseNaturalD20Roll(malformed), undefined);
  }

  assert.throws(() => engine.getNaturalD20Roll({ dice: [] }));
});

it('critical attack doubles damage dice only and preserves crit immunity', () => {
  const formulas = [];

  const execute = (targetFlags) =>
    engine.performTwoStageAttack(
      {
        attackFormula: '1к20+5+1d4',
        attackModifier: 5,
        targetAc: 100,
        weaponName: 'меч',
        targetName: 'цель',
        damageFormula: '1к8+3',
        targetFlags,
      },
      (formula) => {
        formulas.push(formula);

        return formula.includes('20')
          ? rolled(20, 4)
          : { formula, total: 9, dice: [], details: '' };
      },
    );

  assert.equal(execute(new Set()).attackResult.isCriticalHit, true);
  assert.deepEqual(formulas, ['1к20+5+1d4', '2к8+3']);
  formulas.length = 0;

  assert.equal(
    execute(new Set(['defense.critImmunity'])).attackResult.isCriticalHit,
    false,
  );

  assert.deepEqual(formulas, ['1к20+5+1d4', '1к8+3']);
});

it('actual save modal reports natural d20 and complete bonus without adding d4 to damage', async () => {
  const formulas = [];
  const checks = [];

  const ports = {
    props: {
      modifier: 5,
      rollLabel: 'Спасбросок',
      skipChatMessage: true,
      onCheckRoll: (result) => checks.push(result),
    },
    bonusValue: { value: 0 },
    currentConditionalBonuses: { value: { attackBonus: 0, damageBonus: 0 } },
    attackRollMode: { value: 'advantage' },
    resolvedDamageType: { value: undefined },
    effectiveFormula: { value: undefined },
    targetStore: {},
    buildAttackFormula: engine.buildAttackFormula,
    getNaturalD20Roll: engine.getNaturalD20Roll,
    diceRollerStore: {
      parseAndRoll: (formula) => {
        formulas.push(formula);

        return rolled(16, 4);
      },
    },
  };

  const performSimpleRoll = await loadHandler(
    'src/client/ui/actor/DiceRollModal.vue',
    'performSimpleRoll',
    ports,
  );

  assert.equal(performSimpleRoll(['1d4']), 25);
  assert.equal(formulas[0], '2к20kh1+5+1d4');
  assert.equal(checks[0].natural, 16);
  assert.equal(checks[0].modifier, 9);
  ports.props.formula = '1к8+3';
  ports.effectiveFormula.value = '1к8+3';
  performSimpleRoll(['1d4']);
  assert.equal(formulas[1], '1к8+3');
  assert.equal(checks.length, 1);
});

it('actual cast snapshots attack dice before consumeOn and forwards them to projectile resolution', async () => {
  const bonuses = { value: ['1d4'] };

  let received;

  const performRoll = await loadHandler(
    'src/client/ui/actor/DiceRollModal.vue',
    'performRoll',
    {
      console,
      hasRolled: false,
      props: {
        attackModifier: 5,
        attackerId: 'hero',
        evaluateProjectileBonusRollFormulas: () =>
          new Map([['target', bonuses.value]]),
        onProjectileAttack: (context) => {
          received = context;
        },
      },
      announceAttackRoll: () => {
        bonuses.value = [];
      },
      selectedSpellLevel: { value: 1 },
      consumeSpellSlot: { value: true },
      usePactSlot: { value: false },
      hasSpellCast: { value: false },
      rollType: { value: 'public' },
      attackRollMode: { value: 'normal' },
      bonusValue: { value: 0 },
      currentConditionalBonuses: { value: { attackBonus: 0, damageBonus: 0 } },
      currentBonusRollFormulas: bonuses,
      isOpen: { value: true },
      chatStore: { isPrivateRoll: false, isGmOnlyRoll: false },
      DICE_ROLL_LOG_PREFIX: 'test-roll',
    },
  );

  performRoll();

  assert.deepEqual(
    [...received.bonusDiceFormulasByTarget.get('target')],
    ['1d4'],
  );

  assert.deepEqual(bonuses.value, []);
});

it('host parser and real dice serialization keep Bless separate from advantage and disadvantage', async () => {
  const hostRequire = createRequire(
    join(systemRoot, '../vttg/packages/client/package.json'),
  );

  const { DiceRoller } = hostRequire('@ttg-club/dice-roller-parser');
  const hostPath = '../vttg/packages/client/src/stores/diceRollerStore.ts';

  const collectDiceGroups = await loadHandler(
    hostPath,
    'collectDiceGroups',
    {},
  );

  const extractDiceGroups = await loadHandler(hostPath, 'extractDiceGroups', {
    collectDiceGroups,
  });

  const parseAndRoll = await loadHandler(hostPath, 'parseAndRoll', {
    roller: new DiceRoller(),
    extractDiceGroups,
    renderDetails: () => '',
    lastRollResult: { value: undefined },
  });

  for (const mode of ['normal', 'advantage', 'disadvantage']) {
    for (let rollIndex = 0; rollIndex < 12; rollIndex++) {
      const result = parseAndRoll(engine.buildAttackFormula(5, mode, ['1d4']));
      const natural = engine.getNaturalD20Roll(result);

      assert.equal(result.dice[1].sides, 4);
      assert.equal(result.total, natural + 5 + result.dice[1].values[0]);

      if (mode === 'advantage') {
        assert.equal(natural, Math.max(...result.dice[0].values));
      }

      if (mode === 'disadvantage') {
        assert.equal(natural, Math.min(...result.dice[0].values));
      }
    }
  }
});

it('negative actor variables work at the start and end of an additive dice bonus', () => {
  const actor = structuredClone(engine.DEFAULT_ACTOR);

  actor.system.abilities.strength = 8;

  const formulaContext = engine.buildFormulaContext(actor);

  for (const [value, expected] of [
    ['@mod.str+1d4', '-1+1d4'],
    ['1d4+@mod.str', '1d4-1'],
    ['-@mod.str+1d4', '+1+1d4'],
  ]) {
    assert.deepEqual(
      engine.collectBonusRollFormulas(
        [effect([change('attack.melee', value)])],
        'attack.melee',
        normalContext,
        formulaContext,
      ),
      [expected],
    );
  }
});

it('roll bonuses reject unsafe counts, sides and numeric terms before any dice are rolled', () => {
  const values = [
    `${engine.MAX_ROLL_BONUS_DICE + 1}d4`,
    `${'9'.repeat(400)}d4`,
    `1d${'9'.repeat(400)}`,
    `1d${engine.MAX_ROLL_BONUS_DIE_SIDES + 1}`,
    `1d4+${'9'.repeat(400)}`,
    `${engine.MAX_ROLL_BONUS_DICE}d4+1d6`,
  ];

  for (const value of values) {
    assert.deepEqual(
      engine.collectBonusRollFormulas(
        [effect([change('save.wisdom', value)])],
        'save.wisdom',
        normalContext,
      ),
      [],
    );
  }

  const allowed = `${engine.MAX_ROLL_BONUS_DICE}d${engine.MAX_ROLL_BONUS_DIE_SIDES}`;

  assert.deepEqual(
    engine.collectBonusRollFormulas(
      [effect([change('save.wisdom', allowed)])],
      'save.wisdom',
      normalContext,
    ),
    [allowed],
  );
});

it('roll bonus dice share one budget across terms, changes and effects, including penalties', () => {
  const limit = engine.MAX_ROLL_BONUS_DICE;
  const firstCount = Math.floor(limit / 2);
  const remainingCount = limit - firstCount;
  const first = `${firstCount}d4`;
  const overflowingPenalty = `-${remainingCount + 1}d4`;
  const remaining = `${remainingCount - 1}d6+1d8`;

  const formulas = engine.collectBonusRollFormulas(
    [
      effect([change('attack.melee', first)]),
      effect([
        change('attack.melee', overflowingPenalty),
        change('attack.melee', remaining),
      ]),
      effect([change('attack.melee', '1d4')]),
    ],
    'attack.melee',
    normalContext,
  );

  assert.deepEqual(formulas, [first, remaining]);
});

it('server saving throws enforce the shared bonus budget before manual dice loops', () => {
  const actor = structuredClone(engine.DEFAULT_ACTOR);
  const stats = engine.resolveActorStats(actor);
  const previousRandom = Math.random;

  let randomCalls = 0;

  Math.random = () => {
    randomCalls += 1;

    return 0.5;
  };

  try {
    const result = engine.rollEffectSavingThrow('wisdom', 1, stats, {
      effects: [
        effect([change('save.wisdom', '600d4')]),
        effect([change('save.wisdom', '600d4')]),
        effect([change('save.wisdom', '400d6')]),
      ],
      formulaContext: engine.buildFormulaContext(actor),
      self: engine.buildCarrierContext(actor),
    });

    assert.equal(randomCalls, engine.MAX_ROLL_BONUS_DICE + 1);
    assert.equal(result.roll, 11);
    assert.equal(result.total, 11 + stats.saves.wisdom + 600 * 3 + 400 * 4);
  } finally {
    Math.random = previousRandom;
  }
});
