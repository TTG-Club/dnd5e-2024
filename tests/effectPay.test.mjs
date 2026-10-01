import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  engine,
  MAX_ROLL,
  MIN_ROLL,
  PLAYER_ID,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Цена ресурсом (`effectPay.ts`): разбор цены по листу, списание, токены
 * `@paid.*` и вопрос владельцу у срабатываний.
 */

/** Воин 5 уровня: пять костей к10 */
const FIGHTER = { classKey: 'fighter', level: 5, hitDie: 10 };

/** Волшебник 5 уровня: ячейки 4 / 3 / 2 */
const WIZARD = { classKey: 'wizard', level: 5, hitDie: 6, casterType: 'full' };

/** Колдун 5 уровня: две ячейки договора 3 круга */
const WARLOCK = {
  classKey: 'warlock',
  level: 5,
  hitDie: 8,
  casterType: 'pact',
};

/** Ключ счётчика «Очки удали» */
const GRIT = 'grit';

/**
 * Счётчик листа.
 *
 * @param {string} counterKey - ключ
 * @param {number} current - сколько осталось
 * @param {number} max - максимум
 * @returns {object} счётчик
 */
function counter(counterKey, current, max = current) {
  return { counterKey, classKey: 'custom', current, max };
}

/**
 * Персонаж с классами и счётчиками.
 *
 * @param {object} system - поля `system` поверх умолчания
 * @param {object} overrides - поля листа
 * @returns {object} персонаж
 */
function hero(system = {}, overrides = {}) {
  const actor = createActor(overrides);

  actor.system = { ...actor.system, ...system };

  return actor;
}

/**
 * Ответ на вопрос: выбранный вариант.
 *
 * @param {string} optionId - ключ варианта
 * @returns {object} исход запроса
 */
function answered(optionId) {
  return {
    status: 'answered',
    result: { optionId },
    respondedByUserId: PLAYER_ID,
  };
}

/** Ждёт, пока цепочка вопросов дойдёт до следующего запроса */
async function nextTick() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('цена ресурсом: схема', () => {
  it('цена переживает разбор, незнакомый платёж выбрасывается один', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('Кровавый щит', {
        pay: [
          { kind: 'hitDice', amount: 2 },
          { kind: 'mana', amount: 1 },
          { kind: 'spellSlot', minLevel: 4, pact: true },
          { kind: 'counter', counter: GRIT, amount: '1', max: '5' },
        ],
        paid: { hitDice: 2, hitDie: 10, hitDiceRoll: 11 },
      }),
    );

    assert.deepEqual(parsed.pay, [
      { kind: 'hitDice', amount: '2' },
      { kind: 'spellSlot', minLevel: 4, pact: true },
      { kind: 'counter', counter: GRIT, amount: '1', max: '5' },
    ]);

    assert.deepEqual(parsed.paid, { hitDice: 2, hitDie: 10, hitDiceRoll: 11 });
  });

  it('пустая цена не хранится, цена срабатывания разбирается так же', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('Мистическая кара', {
        pay: [{ kind: 'unknown' }],
        triggers: [
          {
            id: 'smite',
            event: 'attackRoll',
            pay: [{ kind: 'spellSlot', pact: true }],
            actions: [
              {
                type: 'damage',
                parts: [{ formula: '(1 + @paid.slotLevel)к8', type: 'force' }],
              },
            ],
          },
        ],
      }),
    );

    assert.equal(parsed.pay, undefined);

    assert.deepEqual(parsed.triggers[0].pay, [
      { kind: 'spellSlot', pact: true },
    ]);
  });

  it('старое число у «вернуть ресурс» читается формулой', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('Источник вдохновения', {
        triggers: [
          {
            id: 'restore',
            event: 'applied',
            actions: [
              { type: 'restore', what: 'counter', counter: GRIT, amount: 2 },
            ],
          },
        ],
      }),
    );

    assert.equal(parsed.triggers[0].actions[0].amount, '2');
  });
});

describe('цена ресурсом: разбор по листу', () => {
  it('счётчик: количество от и до, не больше остатка', () => {
    const plan = engine.planEffectPay(
      hero({ classCounters: [counter(GRIT, 3, 6)] }),
      [{ kind: 'counter', counter: GRIT, amount: '1', max: '5' }],
    );

    assert.equal(plan.shortfall, null);

    assert.deepEqual(
      plan.prices[0].options.map((option) => option.amount),
      [1, 2, 3],
    );

    assert.equal(engine.payNeedsChoice(plan), true);
  });

  it('не хватает ресурса — цена не по карману, с причиной', () => {
    const plan = engine.planEffectPay(
      hero({ classCounters: [counter(GRIT, 2, 6)] }),
      [{ kind: 'counter', counter: GRIT, amount: '6' }],
    );

    assert.match(plan.shortfall ?? '', /не хватает: 6 «grit»/);
    assert.equal(engine.defaultPayPicks(plan), null);
  });

  it('кости хитов: варианты по граням, потраченные не предлагаются', () => {
    const plan = engine.planEffectPay(
      hero({
        classes: [{ ...FIGHTER, hitDiceUsed: 4 }, WIZARD],
      }),
      [{ kind: 'hitDice', amount: '1', max: '2' }],
    );

    assert.deepEqual(
      plan.prices[0].options.map((option) => option.label),
      ['1 кость хитов (к10)', '1 кость хитов (к6)', '2 кости хитов (к6)'],
    );
  });

  it('количество формулой от круга каста', () => {
    const plan = engine.planEffectPay(
      hero({ classes: [FIGHTER] }),
      [{ kind: 'hitDice', amount: '1 + (@castLevel - 1)' }],
      { castLevel: 3 },
    );

    assert.deepEqual(
      plan.prices[0].options.map((option) => option.amount),
      [3],
    );
  });

  it('ячейка: круги с остатком в пределах цены, договора — отдельно', () => {
    const caster = hero({
      classes: [WIZARD, WARLOCK],
      spellSlotsUsed: [0, 3, 0],
    });

    const any = engine.planEffectPay(caster, [{ kind: 'spellSlot' }]);

    assert.deepEqual(
      any.prices[0].options.map((option) => option.label),
      ['ячейка 1 круга', 'ячейка 3 круга', 'ячейка договора 3 круга'],
    );

    const pactOnly = engine.planEffectPay(caster, [
      { kind: 'spellSlot', pact: true },
    ]);

    assert.deepEqual(
      pactOnly.prices[0].options.map((option) => option.id),
      ['0:3:pact'],
    );

    const high = engine.planEffectPay(caster, [
      { kind: 'spellSlot', minLevel: 4 },
    ]);

    assert.match(high.shortfall ?? '', /ячейка от 4 круга/);
  });

  it('у существа ячейка и кости не списываются, счётчиком оно не платит', () => {
    const creature = createCreature();

    creature.system.hitPoints = {
      ...creature.system.hitPoints,
      hitDie: 8,
      hitDiceCount: 3,
    };

    const plan = engine.planEffectPay(creature, [
      { kind: 'spellSlot', minLevel: 2, maxLevel: 3 },
      { kind: 'hitDice', amount: '2' },
    ]);

    assert.equal(plan.shortfall, null);
    assert.equal(plan.prices[0].options.length, 2);
    assert.equal(plan.prices[1].options[0].die, 8);

    const counterPlan = engine.planEffectPay(creature, [
      { kind: 'counter', counter: GRIT },
    ]);

    assert.notEqual(counterPlan.shortfall, null);
  });

  it('заряды предмета: своя цена свойства, ноль — бесплатно', () => {
    const gem = {
      id: 'item_gem',
      name: 'Камень сияния',
      type: 'equipment',
      quantity: 1,
      uses: { max: 50, current: 3, recovery: 'never' },
    };

    const owner = hero({}, { equipment: [gem] });

    const free = engine.planEffectPay(
      owner,
      [{ kind: 'itemUses', amount: '0' }],
      { itemId: gem.id },
    );

    assert.equal(free.shortfall, null);

    const costly = engine.planEffectPay(
      owner,
      [{ kind: 'itemUses', amount: '5' }],
      { itemId: gem.id },
    );

    assert.match(costly.shortfall ?? '', /5 зарядов/);
  });
});

describe('цена ресурсом: списание', () => {
  it('две цены сразу: кость хитов и счётчик', () => {
    const payer = hero({
      classes: [FIGHTER],
      classCounters: [counter(GRIT, 2)],
    });

    const plan = engine.planEffectPay(payer, [
      { kind: 'hitDice' },
      { kind: 'counter', counter: GRIT },
    ]);

    const settled = engine.settleEffectPay(
      payer,
      plan,
      engine.defaultPayPicks(plan),
      {},
      () => MAX_ROLL,
    );

    assert.equal(settled.entity.system.classes[0].hitDiceUsed, 1);
    assert.equal(settled.entity.system.classCounters[0].current, 1);

    assert.deepEqual(settled.paid, {
      hitDice: 1,
      hitDie: 10,
      hitDiceRoll: 10,
      counter: 1,
    });

    assert.equal(
      payer.system.classCounters[0].current,
      2,
      'исходный лист не меняется',
    );
  });

  it('ячейка договора тратит счётчик договора, обычная — свой круг', () => {
    const caster = hero({ classes: [WIZARD, WARLOCK] });
    const plan = engine.planEffectPay(caster, [{ kind: 'spellSlot' }]);

    const pact = engine.settleEffectPay(caster, plan, [
      plan.prices[0].options.find((option) => option.pact),
    ]);

    assert.equal(pact.entity.system.pactSlotsUsed, 1);
    assert.equal(pact.paid.slotLevel, 3);

    const second = engine.settleEffectPay(caster, plan, [
      plan.prices[0].options.find((option) => option.amount === 2),
    ]);

    assert.equal(second.entity.system.spellSlotsUsed[1], 1);
    assert.equal(second.paid.slotLevel, 2);
  });

  it('кости только как цена не бросаются', () => {
    const payer = hero({ classes: [FIGHTER] });

    const plan = engine.planEffectPay(payer, [
      { kind: 'hitDice', amount: '2' },
    ]);

    const settled = engine.settleEffectPay(
      payer,
      plan,
      engine.defaultPayPicks(plan),
      { rollHitDice: false },
    );

    assert.deepEqual(settled.paid, { hitDice: 2, hitDie: 10 });
    assert.deepEqual(settled.notes, ['2 кости хитов (к10)']);
  });

  it('черты костей хитов: максимум вместо броска и «1–2 как 3»', () => {
    assert.deepEqual(
      engine.rollSpentHitDice(
        8,
        2,
        new Set([engine.HIT_DICE_MAXIMIZE_FLAG]),
        () => MIN_ROLL,
      ).values,
      [8, 8],
    );

    assert.deepEqual(
      engine.rollSpentHitDice(
        8,
        2,
        new Set([engine.HIT_DICE_LOW_AS_THREE_FLAG]),
        () => MIN_ROLL,
      ).values,
      [3, 3],
    );
  });

  it('первая кость после отдыха не тратится — один раз', () => {
    const payer = hero(
      { classes: [FIGHTER] },
      {
        activeEffects: [
          createEffect('Живучий', { flags: [engine.HIT_DICE_FIRST_FREE_FLAG] }),
        ],
      },
    );

    const plan = engine.planEffectPay(payer, [
      { kind: 'hitDice', amount: '2' },
    ]);

    const first = engine.settleEffectPay(
      payer,
      plan,
      engine.defaultPayPicks(plan),
    );

    assert.equal(first.entity.system.classes[0].hitDiceUsed, 1);
    assert.equal(first.paid.hitDice, 2, 'эффект — от двух костей');

    const second = engine.settleEffectPay(
      first.entity,
      engine.planEffectPay(first.entity, [{ kind: 'hitDice', amount: '2' }]),
      engine.defaultPayPicks(plan),
    );

    assert.equal(second.entity.system.classes[0].hitDiceUsed, 3);
  });
});

describe('цена ресурсом: токены @paid.*', () => {
  it('потраченное вписывается во все формулы наложенного эффекта', () => {
    const effect = createEffect('Кровавое возмездие', {
      pay: [{ kind: 'hitDice', amount: '5' }],
      damageParts: [{ formula: '@paid.hitDiceRoll + 2', type: 'necrotic' }],
      durationFormula: '@paid.hitDice',
      changes: [
        {
          key: 'armorClass',
          mode: 'add',
          value: 'ceil(@paid.slotLevel / 2)',
          priority: 20,
        },
      ],
      triggers: [
        {
          id: 'heal',
          event: 'attackRoll',
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '(@paid.hitDice)к(@paid.hitDie)@heal' }],
            },
            {
              type: 'restore',
              what: 'counter',
              counter: GRIT,
              amount: '@paid.slotLevel',
            },
            { type: 'setHp', value: 1, formula: '5 * @paid.slotLevel' },
          ],
        },
      ],
    });

    const stamped = engine.stampEffectPaid(effect, {
      hitDice: 5,
      hitDie: 10,
      hitDiceRoll: 27,
      slotLevel: 3,
    });

    assert.equal(
      stamped.pay,
      undefined,
      'наложенная копия второй раз не платит',
    );

    assert.equal(stamped.damageParts[0].formula, '27 + 2');
    assert.equal(stamped.durationFormula, '5');
    assert.equal(stamped.changes[0].value, 'ceil(3 / 2)');

    const [heal, restore, setHp] = stamped.triggers[0].actions;

    assert.equal(heal.parts[0].formula, '5к10@heal');
    assert.equal(restore.amount, '3');
    assert.equal(setHp.formula, '5 * 3');
  });

  it('переключатель хранит шаблон, числа читаются из paid', () => {
    const hide = createEffect('Закалённая шкура', {
      activation: { mode: 'toggle' },
      pay: [{ kind: 'spellSlot' }],
      changes: [
        {
          key: 'armorClass',
          mode: 'add',
          value: 'ceil(@paid.slotLevel / 2)',
          priority: 20,
        },
      ],
    });

    const switched = engine.stampEffectPaid(hide, { slotLevel: 3 }, true);

    assert.equal(switched.changes[0].value, 'ceil(@paid.slotLevel / 2)');
    assert.deepEqual(switched.paid, { slotLevel: 3 });

    const druid = createActor({ activeEffects: [switched] });
    const base = createActor();

    assert.equal(
      engine.resolveActorStats(druid).armorClass,
      engine.resolveActorStats(base).armorClass + 2,
      'КД + половина круга ячейки, вверх',
    );
  });

  it('платёж, которого не было, — ноль, а не сломанная формула', () => {
    assert.equal(
      engine.bindPaidFormula('1 + @paid.slotLevel', { hitDice: 2 }),
      '1 + 0',
    );
  });
});

describe('цена ресурсом: срабатывания', () => {
  /**
   * «Мистическая кара»: при попадании — ячейка договора, урон по кругу.
   *
   * @returns {object} эффект
   */
  function eldritchSmite() {
    return createEffect('Мистическая кара', {
      triggers: [
        {
          id: 'smite',
          event: 'attackRoll',
          role: 'attacker',
          recipient: 'other',
          limit: { max: 1, per: 'turn' },
          pay: [{ kind: 'spellSlot', pact: true }],
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '(1 + @paid.slotLevel)к8', type: 'force' }],
            },
          ],
        },
      ],
    });
  }

  it('цена на броске атаки: вопрос владельцу, по согласию — ячейка и урон цели', async () => {
    const warlock = hero(
      { classes: [WARLOCK] },
      { activeEffects: [eldritchSmite()] },
    );

    const ogre = withHp(createCreature, 60);
    const { requests, requestRoll, answer } = createRequestRoll();

    const result = engine.settleAttackRollTriggers(warlock, 'attacker', {
      other: ogre,
      roll: {},
      landed: true,
      inCombat: true,
      requestRoll,
      getEntity: (entityId) => (entityId === ogre.id ? ogre : undefined),
    });

    assert.equal(result.deferred.length, 1, 'срабатывание ждёт ответа');
    assert.equal(requests[0].payload.question, 'Заплатить цену?');
    assert.match(requests[0].payload.effectSummary, /Цена: ячейка договора/);

    assert.equal(
      warlock.system.effectUsage,
      undefined,
      '«раз в ход» до согласия не тратится',
    );

    answer(answered('yes'));

    const outcome = (await result.deferred[0].resolution)(warlock);

    assert.equal(warlock.system.pactSlotsUsed, 1);

    assert.match(
      outcome.notes[0],
      /Мистическая кара — цена: ячейка договора 3 круга/,
    );

    assert.notEqual(warlock.system.effectUsage, undefined, 'лимит потрачен');

    // Урон цели уходит ядру вложенным срабатыванием — у него своя живая запись
    const [nested] = outcome.deferred;

    assert.equal(nested.entityId, ogre.id);

    const dealt = (await nested.resolution)(ogre);

    assert.equal(dealt.damageOutcomes.length, 1);

    assert.ok(
      engine.resolveEntityCurrentHp(ogre) <= 56,
      '4к8 силовым полем: не меньше четырёх',
    );
  });

  it('отказ ничего не тратит', async () => {
    const warlock = hero(
      { classes: [WARLOCK] },
      { activeEffects: [eldritchSmite()] },
    );

    const ogre = withHp(createCreature, 60);
    const { requestRoll, answer } = createRequestRoll();

    const result = engine.settleAttackRollTriggers(warlock, 'attacker', {
      other: ogre,
      roll: {},
      landed: true,
      inCombat: true,
      requestRoll,
    });

    answer(answered('no'));

    const outcome = (await result.deferred[0].resolution)(warlock);

    assert.equal(outcome.changed, false);
    assert.equal(warlock.system.pactSlotsUsed ?? 0, 0);
    assert.equal(warlock.system.effectUsage, undefined);
  });

  it('платить нечем — вопроса нет, срабатывание молчит', () => {
    const warlock = hero(
      { classes: [WARLOCK], pactSlotsUsed: 2 },
      { activeEffects: [eldritchSmite()] },
    );

    const { requests, requestRoll } = createRequestRoll();

    const result = engine.settleAttackRollTriggers(warlock, 'attacker', {
      other: withHp(createCreature, 60),
      roll: {},
      landed: true,
      inCombat: true,
      requestRoll,
    });

    assert.equal(requests.length, 0);
    assert.equal(result.deferred.length, 0);
  });

  it('выбор круга ячейки: вопрос с вариантами, хиты формулой по кругу', async () => {
    const hunt = createEffect('Неослабевающая охота', {
      triggers: [
        {
          id: 'stand',
          event: 'hpZero',
          pay: [{ kind: 'spellSlot', minLevel: 2 }],
          actions: [
            { type: 'setHp', value: 1, formula: '5 * @paid.slotLevel' },
          ],
        },
      ],
    });

    const ranger = withHp(() => hero({ classes: [WIZARD] }), 4, {}, 60);

    ranger.activeEffects = [hunt];

    const { requests, requestRoll, answer } = createRequestRoll();
    const system = new engine.Dnd5eVttSystem();
    const copy = structuredClone(ranger);

    engine.applyTargetDamage(copy, 10, false, 'slashing');

    const result = system.settleCombatState(
      ranger,
      engine.pickCombatState(copy),
      { requestRoll },
    );

    assert.equal(requests[0].payload.question, 'Чем заплатить?');

    assert.deepEqual(
      requests[0].payload.options.map((option) => option.label),
      ['ячейка 2 круга', 'ячейка 3 круга', 'Не платить'],
    );

    answer(answered('0:3'));

    await nextTick();

    (await result.deferred[0].resolution)(ranger);

    assert.equal(engine.resolveEntityCurrentHp(ranger), 15);
    assert.equal(ranger.system.spellSlotsUsed[2], 1);
  });

  it('кнопка «При действии» с ценой: списывает и сообщает в сводку', () => {
    const surge = createEffect('Быстрое восстановление', {
      triggers: [
        {
          id: 'recover',
          event: 'activate',
          cost: 'bonus',
          pay: [{ kind: 'hitDice' }, { kind: 'counter', counter: GRIT }],
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '@paid.hitDiceRoll + 2@heal' }],
            },
            { type: 'notify', text: 'Потрачено костей: @paid.hitDice' },
          ],
        },
      ],
    });

    const dwarf = withHp(
      () => hero({ classes: [FIGHTER], classCounters: [counter(GRIT, 1)] }),
      10,
      {},
      40,
    );

    dwarf.activeEffects = [surge];

    const report = { notes: [], results: [] };

    const acted = engine.runEffectActiveAction(dwarf, surge.id, undefined, {
      report,
    });

    assert.equal(acted.system.classes[0].hitDiceUsed, 1);
    assert.equal(acted.system.classCounters[0].current, 0);

    assert.ok(
      engine.resolveEntityCurrentHp(acted) >= 13,
      'к10 + 2, не меньше 3',
    );

    assert.match(
      report.notes[0],
      /Быстрое восстановление — цена: 1 кость хитов \(к10\)/,
    );

    assert.match(report.notes.at(-1), /Потрачено костей: 1/);

    // Второй раз платить нечем: счётчик пуст
    const again = engine.runEffectActiveAction(acted, surge.id);

    assert.equal(again.system.classes[0].hitDiceUsed, 1);
  });

  it('«вернуть ресурс»: формулой и установкой в число', () => {
    const mutation = createEffect('Мутирующая форма', {
      triggers: [
        {
          id: 'points',
          event: 'activate',
          pay: [{ kind: 'spellSlot' }],
          actions: [
            {
              type: 'restore',
              what: 'counter',
              counter: 'mutation',
              amount: '@paid.slotLevel + max(1, @mod.wis)',
              set: true,
            },
          ],
        },
      ],
    });

    const druid = hero(
      { classes: [WIZARD], classCounters: [counter('mutation', 5, 10)] },
      { activeEffects: [mutation] },
    );

    const plan = engine.planEffectPay(druid, mutation.triggers[0].pay);
    const third = plan.prices[0].options.find((option) => option.amount === 3);

    const acted = engine.runEffectActiveAction(druid, mutation.id, undefined, {
      payPickIds: new Set([third.id]),
    });

    assert.equal(
      acted.system.classCounters[0].current,
      4,
      'очки не прибавились к прежним, а заменены: круг 3 + минимум 1',
    );

    assert.equal(acted.system.spellSlotsUsed[2], 1);
  });
});
