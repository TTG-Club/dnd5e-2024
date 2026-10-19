import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { loadEngineBundle, systemRoot } from '../helpers/engineBundle.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/**
 * Скрытая атака, этап 3: Хитрый удар (приёмы платят костями до броска, их
 * эффекты идут к цели), признак «урон нанесён Скрытой атакой» в событии
 * броска атаки, условия подклассов (первый раунд, цель ещё не ходила,
 * наименьшая кость), эффекты по выбору с ресурсом, обновление старых листов.
 */

/** Числа носителя: уровень в классе подставлен, остальное — по месту */
function formulaContext(level = 5) {
  return {
    abilities: { dex: { value: 18, mod: 4 } },
    prof: 3,
    level,
    classLevel: level,
    movement: { walk: 30, swim: 0, fly: 0, climb: 0, burrow: 0 },
  };
}

/** Строка эффекта */
function change(key, value, condition) {
  return {
    key,
    mode: 'add',
    value,
    priority: 20,
    ...(condition ? { condition } : {}),
  };
}

/** Эффект с одной или несколькими строками */
function effect(id, changes, extra = {}) {
  return {
    id,
    name: id,
    disabled: false,
    origin: 'feature',
    transfer: false,
    duration: { type: 'permanent' },
    flags: [],
    changes,
    ...extra,
  };
}

/** Кнопка приёма Хитрого удара — как в данных компендиума */
function cunningStrike(id, cost, extra, condition) {
  return effect(
    `class-effect:rogue:${id}`,
    [change(engine.SNEAK_ATTACK_CUNNING_STRIKE_KEY, String(cost), condition)],
    {
      disabled: true,
      effectTarget: 'target',
      activation: { mode: 'use' },
      applySave: {
        ability: 'constitution',
        dc: 0,
        onSuccess: 'negate',
        dcFormula: '8 + @prof + @mod.dex',
      },
      ...(extra ?? {}),
    },
  );
}

const poison = cunningStrike(
  'effect-rogue-phb-cunning-poison',
  1,
  { conditionKey: 'poisoned' },
  `${engine.CARRIER_TOOL_CONDITION_PREFIX}"${engine.POISONERS_KIT_TOOL}"`,
);

const trip = cunningStrike('effect-rogue-phb-cunning-trip', 1, {
  conditionKey: 'prone',
});

const daze = cunningStrike('effect-rogue-phb-cunning-daze', 2);
const knockOut = cunningStrike('effect-rogue-phb-cunning-knock-out', 6);

/** Улучшенный хитрый удар: ещё один приём за удар */
const improved = effect('class-effect:rogue:effect-rogue-phb-improved', [
  change(engine.SNEAK_ATTACK_CUNNING_STRIKE_COUNT_KEY, '1'),
]);

/** Удар фехтовальным оружием с преимуществом */
function finesseRoll(extra = {}) {
  return {
    hasAdvantage: true,
    hasDisadvantage: false,
    itemId: 'dagger',
    weaponProperties: ['finesse'],
    weaponRangeType: 'melee',
    ...extra,
  };
}

/** Носитель с набором отравителя и без */
const withKit = { self: { toolKeys: [engine.POISONERS_KIT_TOOL] } };
const withoutKit = { self: { toolKeys: [] } };

/** Id выбранных приёмов */
function ids(options) {
  return options.map((option) => option.id);
}

describe('хитрый удар: выбор и цена', () => {
  it('[CS01] приёмы — кнопки со строкой цены; цена убирает кости до броска', () => {
    const effects = [poison, trip, daze];

    const options = engine.listSneakAttackOptions(
      effects,
      finesseRoll(withKit),
      formulaContext(),
    );

    assert.deepEqual(
      options.map((option) => [option.id, option.cost, option.cunningStrike]),
      [
        [poison.id, 1, true],
        [trip.id, 1, true],
        [daze.id, 2, true],
      ],
    );

    const picked = engine.pickSneakAttackOptions(options, [trip.id], 3, 1);

    assert.deepEqual(ids(picked), [trip.id]);

    assert.equal(
      engine.addDiceToFormula('3к6', -engine.sumSneakAttackOptionCost(picked)),
      '2к6',
    );

    assert.equal(engine.formatSneakAttackDice('3к6', 2), '2к6');
  });

  it('[CS01] на приём не хватает костей — его не выбрать', () => {
    const options = engine.listSneakAttackOptions(
      [knockOut],
      finesseRoll(),
      formulaContext(),
    );

    assert.equal(
      engine.canAddSneakAttackOption([], options[0], 3, 1),
      false,
      '6к6 при 3к6 Скрытой атаки',
    );

    assert.deepEqual(
      engine.pickSneakAttackOptions(options, [knockOut.id], 3, 1),
      [],
    );
  });

  it('[CS02] один приём за удар; «Улучшенный хитрый удар» — два, повтор нельзя', () => {
    const options = engine.listSneakAttackOptions(
      [trip, daze],
      finesseRoll(),
      formulaContext(11),
    );

    assert.equal(
      engine.resolveCunningStrikeLimit([], finesseRoll(), formulaContext()),
      1,
    );

    assert.deepEqual(
      ids(engine.pickSneakAttackOptions(options, [trip.id, daze.id], 6, 1)),
      [trip.id],
      'второй сверх лимита отброшен',
    );

    const limit = engine.resolveCunningStrikeLimit(
      [improved],
      finesseRoll(),
      formulaContext(11),
    );

    assert.equal(limit, 2);

    assert.deepEqual(
      ids(engine.pickSneakAttackOptions(options, [trip.id, daze.id], 6, limit)),
      [trip.id, daze.id],
    );

    assert.equal(
      engine.canAddSneakAttackOption(options.slice(0, 1), options[0], 6, 2),
      false,
      'тот же приём дважды',
    );
  });

  it('[CS02] костей стало меньше — снимаются выбранные последними', () => {
    const options = engine.listSneakAttackOptions(
      [trip, daze],
      finesseRoll(),
      formulaContext(11),
    );

    assert.deepEqual(
      ids(engine.pickSneakAttackOptions(options, [daze.id, trip.id], 2, 2)),
      [daze.id],
    );
  });

  it('[CS03] «Отравить» — только с набором отравителя в снаряжении', () => {
    const available = (context) =>
      ids(
        engine.listSneakAttackOptions(
          [poison, trip],
          finesseRoll(context),
          formulaContext(),
        ),
      );

    assert.deepEqual(available(withKit), [poison.id, trip.id]);
    assert.deepEqual(available(withoutKit), [trip.id]);

    const carrier = engine.buildCarrierContext({
      id: 'rogue',
      type: 'actor',
      system: { classes: [] },
      equipment: [{ id: 'kit', type: 'tool', baseToolType: 'poisoners-kit' }],
    });

    assert.deepEqual(carrier.toolKeys, ['poisoners-kit']);
  });

  it('[CS04] крит удваивает кости, оставшиеся после цены приёма', () => {
    const afterCost = engine.addDiceToFormula('3к6', -1);

    assert.equal(engine.doubleDiceInFormula(afterCost), '4к6');
  });

  it('[CS01] без Скрытой атаки приёмов нет: окно выбирает их только под включённым переключателем', () => {
    const modal = readFileSync(
      join(systemRoot, 'src/client/ui/actor/DiceRollModal.vue'),
      'utf8',
    );

    assert.match(
      modal,
      /if \(!preview \|\| !isSneakAttackApplied\.value\) \{\s*return \[\];/u,
    );
  });
});

describe('хитрый удар: эффект приёма на цели', () => {
  it('[CS05] кнопка становится эффектом на цель: без применения и без строк Скрытой атаки', () => {
    const target = engine.buildSneakAttackOptionTargetEffect(poison);

    assert.equal(target.activation, undefined);
    assert.equal(target.disabled, false);
    assert.equal(target.effectTarget, 'target');
    assert.deepEqual(target.changes, []);
    assert.equal(target.applySave.dcFormula, '8 + @prof + @mod.dex');
    assert.equal(target.conditionKey, 'poisoned');
    assert.equal(poison.activation.mode, 'use', 'кнопка на листе не тронута');
  });

  it('[CS05] эффекты приёмов едут в части Скрытой атаки к оркестратору удара', () => {
    const shared = readFileSync(
      join(systemRoot, 'src/client/composables/spellResolutionShared.ts'),
      'utf8',
    );

    const orchestrator = readFileSync(
      join(systemRoot, 'src/client/composables/useSpellDamageWithParts.ts'),
      'utf8',
    );

    assert.match(shared, /export function withPartTargetEffects\(/u);

    assert.match(
      orchestrator,
      /withSpellActionId\(withPartTargetEffects\(rawContext, parts\)\)/u,
    );
  });
});

describe('событие «урон нанесён Скрытой атакой»', () => {
  const sneakCondition = engine.SNEAK_ATTACK_APPLIED_CONDITION;
  const rogue = { id: 'rogue', type: 'actor', system: {}, activeEffects: [] };

  it('[CS06] признак едет в событии броска атаки — только у попавшего', () => {
    const event = engine.buildAttackRollEvent(
      'rogue',
      ['goblin'],
      'advantage',
      true,
      false,
      true,
    );

    assert.equal(event.sneakAttack, true);
    assert.equal(engine.parseSystemClientEvent(event)?.sneakAttack, true);

    const missed = engine.buildAttackRollEvent(
      'rogue',
      ['goblin'],
      'advantage',
      false,
      false,
      true,
    );

    assert.equal(missed.sneakAttack, undefined);
  });

  it('[CS06] условие срабатывания читает признак; без него не выполняется', () => {
    const met = (attack) =>
      engine.isTriggerConditionMet(
        rogue,
        { condition: sneakCondition },
        { attack },
      );

    assert.equal(met({ kinds: [], landed: true, sneakAttack: true }), true);
    assert.equal(met({ kinds: [], landed: true }), false);
  });

  it('[CS06] такое срабатывание выполняет сервер — клиент бросает свои до урона', () => {
    assert.equal(
      engine.isClientAttackRollTrigger({
        id: 'rend',
        event: 'attackRoll',
        condition: sneakCondition,
        actions: [{ type: 'removeSelf' }],
      }),
      false,
    );

    assert.equal(
      engine.isClientAttackRollTrigger({
        id: 'plain',
        event: 'attackRoll',
        actions: [{ type: 'removeSelf' }],
      }),
      true,
    );
  });
});

describe('подклассы', () => {
  it('[CS07] Убийца: первый раунд и цель, которая ещё не ходила', () => {
    const condition = `${engine.COMBAT_ROUND_CONDITION_PREFIX}1 && ${engine.TARGET_NOT_ACTED_CONDITION}`;

    const holds = (combatRound, hasActed) =>
      engine.evaluateCondition(condition, {
        hasAdvantage: false,
        hasDisadvantage: false,
        ...(combatRound === undefined ? {} : { combatRound }),
        target: {
          currentHp: 10,
          maxHp: 10,
          ...(hasActed === undefined ? {} : { hasActed }),
        },
      });

    assert.equal(holds(1, false), true);
    assert.equal(holds(1, true), false, 'цель уже ходила');
    assert.equal(holds(2, true), false, 'второй раунд');
    assert.equal(holds(undefined, undefined), false, 'вне боя');
  });

  it('[CS07] Убийца: урон уровня плута, если в первом раунде идёт Скрытая атака', () => {
    const surprising = effect('class-effect:rogue:surprising', [
      change(
        'damage.all',
        '@classLevel',
        `${engine.SNEAK_ATTACK_APPLIED_CONDITION} && ${engine.COMBAT_ROUND_CONDITION_PREFIX}1`,
      ),
    ]);

    const matches = (sneakAttack, combatRound) =>
      engine.collectRollTimeChanges([surprising], 'damage.all', {
        hasAdvantage: true,
        hasDisadvantage: false,
        sneakAttack,
        combatRound,
      }).length;

    assert.equal(matches(true, 1), 1);
    assert.equal(matches(false, 1), 0);
    assert.equal(matches(true, 2), 0);
  });

  it('[CS08] Наследник Троих: 1 и 2 на костях Скрытой атаки — за 3', () => {
    const killingIntent = effect('class-effect:rogue:killing-intent', [
      change(engine.SNEAK_ATTACK_MIN_DIE_KEY, '3'),
    ]);

    assert.equal(
      engine.resolveSneakAttackMinDie(
        [killingIntent],
        finesseRoll(),
        formulaContext(17),
      ),
      3,
    );

    assert.equal(
      engine.resolveSneakAttackMinDie([], finesseRoll(), formulaContext()),
      undefined,
    );

    assert.deepEqual(engine.raiseDiceToMinimum(9, [1, 2, 6], 3), {
      amount: 12,
      values: [3, 3, 6],
    });
  });

  it('[CS08] Наследник Троих: доп. урон по окровавленной цели при Скрытой атаке', () => {
    const bloodthirst = effect('class-effect:rogue:bloodthirst', [
      change(
        'damage.all',
        'ceil(@classLevel / 2)',
        `${engine.SNEAK_ATTACK_APPLIED_CONDITION} && target.hp.value <= (target.hp.max / 2)`,
      ),
    ]);

    const matches = (currentHp) =>
      engine.collectRollTimeChanges([bloodthirst], 'damage.all', {
        hasAdvantage: true,
        hasDisadvantage: false,
        sneakAttack: true,
        target: { currentHp, maxHp: 20 },
      }).length;

    assert.equal(matches(10), 1);
    assert.equal(matches(11), 0);
  });

  it('[CS09] Клинок души: «Раздирание разума» — эффект по выбору, не приём Хитрого удара', () => {
    const rendMind = effect(
      'class-effect:rogue:effect-soulknife-phb-rend-mind',
      [change(engine.SNEAK_ATTACK_RIDER_KEY, '0')],
      {
        disabled: true,
        effectTarget: 'target',
        conditionKey: 'stunned',
        activation: { mode: 'use', counter: 'rend-mind' },
      },
    );

    const options = engine.listSneakAttackOptions(
      [trip, rendMind],
      finesseRoll(),
      formulaContext(17),
    );

    assert.deepEqual(
      options.map((option) => [option.id, option.cost, option.cunningStrike]),
      [
        [trip.id, 1, true],
        [rendMind.id, 0, false],
      ],
    );

    assert.deepEqual(
      ids(engine.pickSneakAttackOptions(options, [trip.id, rendMind.id], 9, 1)),
      [trip.id, rendMind.id],
      'в число приёмов за удар не входит',
    );
  });

  it('[CS10] Агент Дома: «Ошеломляющее предательство» ценой 4к6 — с 9-го уровня (5к6)', () => {
    const betrayal = cunningStrike(
      'effect-house-agent-uauo-stunning-betrayal',
      4,
    );

    const options = engine.listSneakAttackOptions(
      [betrayal],
      finesseRoll(),
      formulaContext(9),
    );

    assert.equal(engine.canAddSneakAttackOption([], options[0], 5, 1), true);
    assert.equal(engine.canAddSneakAttackOption([], options[0], 3, 1), false);
  });
});

describe('обновление старых листов', () => {
  const sneak = effect('class-effect:rogue:effect-rogue-phb-sneak-attack', [
    change(
      engine.SNEAK_ATTACK_DAMAGE_KEY,
      engine.SNEAK_ATTACK_DICE_FORMULA,
      engine.SNEAK_ATTACK_CONDITION,
    ),
  ]);

  const legacyMinus = effect(
    'class-effect:rogue:effect-rogue-phb-sneak-attack-minus-1',
    [],
    { disabled: true, activation: { mode: 'use' }, effectTarget: 'target' },
  );

  const legacyPoison = { ...poison, changes: [] };

  const legacySurprising = effect(
    'class-effect:rogue:effect-rogue-assassin-phb-surprising-strikes',
    [],
    { disabled: true, activation: { mode: 'use' }, effectTarget: 'target' },
  );

  const homebrewButton = effect('class-effect:rogue:my-button', [], {
    activation: { mode: 'use' },
  });

  it('[CS11] кнопки «−Nк6» и подклассов снимаются, приём — заменяется новым; повтор ничего не меняет', () => {
    const sheet = [
      sneak,
      legacyMinus,
      legacyPoison,
      legacySurprising,
      homebrewButton,
    ];

    const definition = [sneak, poison, improved];

    const migrated = engine.migrateStage3SneakAttackEffects(sheet, definition);

    assert.deepEqual(
      migrated?.map((entry) => entry.id),
      [sneak.id, poison.id, homebrewButton.id, improved.id],
    );

    assert.equal(
      migrated?.find((entry) => entry.id === poison.id)?.changes[0]?.key,
      engine.SNEAK_ATTACK_CUNNING_STRIKE_KEY,
    );

    assert.equal(
      engine.migrateStage3SneakAttackEffects(migrated ?? [], definition),
      undefined,
    );
  });

  it('[CS11] определение ещё старое — лист не трогается', () => {
    const oldDefinition = [
      effect('class-effect:rogue:effect-rogue-phb-sneak-attack', [], {
        activation: { mode: 'use' },
      }),
      legacyMinus,
    ];

    assert.equal(
      engine.migrateStage3SneakAttackEffects(
        [legacyMinus, legacyPoison],
        oldDefinition,
      ),
      undefined,
    );
  });

  it('[CS11] id сравнивается точно: похожая кнопка не снимается', () => {
    const lookalike = effect(
      'class-effect:rogue:effect-rogue-phb-sneak-attack-minus-1-homebrew',
      [],
      { activation: { mode: 'use' } },
    );

    assert.equal(
      engine.migrateStage3SneakAttackEffects([sneak, lookalike], [sneak]),
      undefined,
    );
  });
});

describe('пробелы этапа 3', () => {
  it.todo(
    '[CS12] Смертельный удар Убийцы: удвоение урона атаки при проваленном спасброске',
  );

  it.todo('[CS13] Воровские рефлексы: два хода в первом раунде');
  it.todo('[CS14] Отступить: перемещение без провоцированных атак');
});
