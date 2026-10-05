import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  change,
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  engine,
  MAX_ROLL,
  MIN_ROLL,
  PLAYER_ID,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: цена ресурсом (`docs/EFFECT_SCENARIOS.md`, раздел «Цена ресурсом»).
 * Тексты правил — из сверки мест этапа 2A (`wave2-plan/stage2A/places.json`).
 */

/** Воин 6 уровня: шесть костей к10 */
const FIGHTER = { classKey: 'fighter', level: 6, hitDie: 10 };

/** Друид 5 уровня: ячейки 4 / 3 / 2 */
const DRUID = { classKey: 'druid', level: 5, hitDie: 8, casterType: 'full' };

/** Колдун 5 уровня: две ячейки договора 3 круга */
const WARLOCK = {
  classKey: 'warlock',
  level: 5,
  hitDie: 8,
  casterType: 'pact',
};

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
 * Персонаж с классами, счётчиками и эффектами.
 *
 * @param {object} system - поля `system` поверх умолчания
 * @param {object[]} activeEffects - эффекты листа
 * @returns {object} персонаж
 */
function hero(system, activeEffects = []) {
  const actor = createActor({ activeEffects });

  actor.system = { ...actor.system, ...system };

  return actor;
}

/**
 * Оплата цены вариантами по умолчанию — как на столе, когда выбирать не из
 * чего.
 *
 * @param {object} payer - кто платит
 * @param {object[]} pay - цена
 * @param {object} context - круг каста, предмет, бросок костей
 * @returns {object} итог оплаты
 */
function payDefault(payer, pay, context = {}) {
  const plan = engine.planEffectPay(payer, pay, context);

  assert.equal(plan.shortfall, null, 'цена по карману');

  return engine.settleEffectPay(
    payer,
    plan,
    engine.defaultPayPicks(plan),
    context,
  );
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

describe('каталог: цена ресурсом', () => {
  it('[PY01] Источник вдохновения: ячейка заклинания возвращает кость вдохновения', () => {
    // «Вы можете потратить ячейку заклинания (действие не требуется), чтобы
    // восстановить 1 использование кости бардовского вдохновения»
    const font = createEffect('Источник вдохновения', {
      activation: { mode: 'use' },
      pay: [{ kind: 'spellSlot' }],
      duration: { type: 'special' },
      triggers: [
        {
          id: 'trigger_restore',
          event: 'applied',
          actions: [
            {
              type: 'restore',
              what: 'counter',
              counter: 'bardic-inspiration',
            },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(font, 'feature'),
      /цена: ячейка.*возвращается ресурс «bardic-inspiration»/,
    );

    const bard = hero({
      classes: [DRUID],
      classCounters: [counter('bardic-inspiration', 0, 3)],
    });

    const plan = engine.planEffectPay(bard, font.pay);

    assert.deepEqual(
      plan.prices[0].options.map((option) => option.amount),
      [1, 2, 3],
      'круг ячейки выбирает игрок',
    );

    const settled = engine.settleEffectPay(bard, plan, [
      plan.prices[0].options[0],
    ]);

    assert.equal(settled.entity.system.spellSlotsUsed[0], 1);
  });

  it('[PY02] Мистическая кара: ячейка договора при попадании, урон по её кругу', async () => {
    // «Раз в ход при попадании оружием договора потратить ячейку договора:
    // 1к8 силовым полем + 1к8 за уровень ячейки»
    const smite = createEffect('Мистическая кара', {
      triggers: [
        {
          id: 'trigger_smite',
          event: 'attackRoll',
          role: 'attacker',
          recipient: 'other',
          condition: 'attack.landed === true',
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

    assert.match(
      authoredScenario(smite, 'feature'),
      /цена: ячейка договора, не чаще одного раза за ход/,
    );

    const warlock = hero({ classes: [WARLOCK] }, [smite]);
    const troll = withHp(createCreature, 80);
    const { requests, requestRoll, answer } = createRequestRoll();

    const result = engine.settleAttackRollTriggers(warlock, 'attacker', {
      other: troll,
      roll: {},
      landed: true,
      inCombat: true,
      requestRoll,
    });

    assert.equal(requests[0].payload.question, 'Заплатить цену?');

    answer(answered('yes'));

    const outcome = (await result.deferred[0].resolution)(warlock);

    assert.equal(warlock.system.pactSlotsUsed, 1);

    withRandom([MAX_ROLL], () => outcome.deferred[0]);

    const dealt = await outcome.deferred[0].resolution;

    withRandom([MAX_ROLL], () => dealt(troll));

    assert.equal(
      engine.resolveEntityCurrentHp(troll),
      80 - 32,
      'ячейка 3 круга: 4к8',
    );

    // Критическое попадание удваивает кости кары, как урон самой атаки: число
    // костей считается после подстановки круга ячейки
    const critWarlock = hero({ classes: [WARLOCK] }, [smite]);
    const critTroll = withHp(createCreature, 80);
    const critRequest = createRequestRoll();

    const critResult = engine.settleAttackRollTriggers(
      critWarlock,
      'attacker',
      {
        other: critTroll,
        roll: {},
        landed: true,
        critical: true,
        inCombat: true,
        requestRoll: critRequest.requestRoll,
      },
    );

    critRequest.answer(answered('yes'));

    const critOutcome = (await critResult.deferred[0].resolution)(critWarlock);
    const critDealt = await critOutcome.deferred[0].resolution;

    withRandom([MAX_ROLL], () => critDealt(critTroll));

    assert.equal(
      engine.resolveEntityCurrentHp(critTroll),
      80 - 64,
      'крит: 8к8',
    );
  });

  it('[PY03] Быстрое восстановление: две цены сразу — кость хитов и использование', () => {
    // «Бонусным действием потратить одну из своих Костей хитов, бросить её,
    // добавить модификатор Телосложения и восстановить столько хитов» — раз за
    // короткий отдых (счётчик черты)
    const recovery = createEffect('Быстрое восстановление', {
      activation: { mode: 'use' },
      pay: [
        { kind: 'hitDice' },
        { kind: 'counter', counter: 'bystroe-vosstanovlenie' },
      ],
      duration: { type: 'special' },
      triggers: [
        {
          id: 'trigger_heal',
          event: 'applied',
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '@paid.hitDiceRoll + @mod.con@heal' }],
            },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(recovery, 'feature'),
      /цена: 1 кость хитов и 1 «bystroe-vosstanovlenie»/,
    );

    const dwarf = hero({
      classes: [FIGHTER],
      classCounters: [counter('bystroe-vosstanovlenie', 1)],
    });

    const settled = withRandom([MAX_ROLL], () =>
      payDefault(dwarf, recovery.pay),
    );

    assert.deepEqual(settled.paid, {
      hitDice: 1,
      hitDie: 10,
      hitDiceRoll: 10,
      counter: 1,
    });

    const [applied] = engine.bindSourcePaid(
      { activeEffects: engine.listUseEffects([recovery]) },
      settled.paid,
    ).activeEffects;

    assert.equal(
      applied.triggers[0].actions[0].parts[0].formula,
      '10 + @mod.con@heal',
      'бросок потраченной кости — числом в формуле лечения',
    );

    assert.match(
      engine.planEffectPay(settled.entity, recovery.pay).shortfall ?? '',
      /не хватает/,
      'второй раз до отдыха — нечем',
    );
  });

  it('[PY04] Закалённая шкура: переключатель за ячейку, КД от её круга', () => {
    // «…потратить ячейку заклинания 1-го уровня или выше. До окончания формы —
    // бонус к КД, равный половине уровня ячейки (округляя вверх)»
    const hide = createEffect('Закалённая шкура', {
      activation: { mode: 'toggle' },
      disabled: true,
      pay: [{ kind: 'spellSlot' }],
      changes: [change('armorClass', 'ceil(@paid.slotLevel / 2)')],
    });

    assert.match(authoredScenario(hide, 'feature'), /цена: ячейка/);

    const druid = hero({ classes: [DRUID] }, [hide]);
    const plan = engine.planEffectPay(druid, hide.pay);

    const third = plan.prices[0].options.find((option) => option.amount === 3);

    const settled = engine.settleEffectPay(druid, plan, [third]);

    const switched = engine.activateEffectOnEntity(
      settled.entity,
      hide.id,
      (effect) => engine.stampEffectPaid(effect, settled.paid, true),
    );

    assert.equal(
      engine.resolveActorStats(switched).armorClass,
      engine.resolveActorStats(druid).armorClass + 2,
    );

    assert.equal(
      switched.activeEffects[0].changes[0].value,
      'ceil(@paid.slotLevel / 2)',
      'шаблон переключателя цел: следующее включение посчитает свой круг',
    );

    assert.match(
      engine
        .buildActiveEffectDetails(switched.activeEffects[0])
        .flatMap((section) => section.lines)
        .join('\n'),
      /Потрачено: ячейка 3 круга/,
    );
  });

  it('[PY05] Мутирующая форма: очки мутации равны кругу ячейки и заменяют прежние', () => {
    // «…вы можете потратить ячейку заклинания, чтобы получить Очки мутации,
    // равные уровню ячейки»; «Бесконечная эволюция»: плюс модификатор Мудрости
    // (минимум 1)
    const mutation = createEffect('Мутирующая форма', {
      activation: { mode: 'use' },
      pay: [{ kind: 'spellSlot' }],
      duration: { type: 'special' },
      triggers: [
        {
          id: 'trigger_points',
          event: 'applied',
          actions: [
            {
              type: 'restore',
              what: 'counter',
              counter: 'mutation-points',
              amount: '@paid.slotLevel + max(1, @mod.wis)',
              set: true,
            },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(mutation, 'feature'),
      /«mutation-points» становится круг потраченной ячейки \+ max\(1, мод\. Мудрости\)/,
    );

    const druid = hero({
      classes: [DRUID],
      classCounters: [counter('mutation-points', 6, 12)],
    });

    const [applied] = engine.bindSourcePaid(
      { activeEffects: engine.listUseEffects([mutation]) },
      { slotLevel: 2 },
    ).activeEffects;

    druid.activeEffects = [applied];

    engine.applyTriggerEffectActions(
      druid,
      {
        effect: applied,
        trigger: applied.triggers[0],
        ambient: false,
        instance: true,
        scope: applied.id,
      },
      false,
    );

    assert.equal(
      druid.system.classCounters[0].current,
      3,
      'круг 2 + минимум 1: прежние шесть очков заменены',
    );
  });

  it('[PY06] Неослабевающая охота: при 0 хитов — ячейка 4+ круга, хиты по её кругу', async () => {
    // «…потратить ячейку заклинания 4 уровня или выше. Вместо этого ваши хиты
    // становятся равны 5, умноженным на уровень потраченной ячейки»
    const hunt = createEffect('Неослабевающая охота', {
      triggers: [
        {
          id: 'trigger_stand',
          event: 'hpZero',
          pay: [{ kind: 'spellSlot', minLevel: 4 }],
          actions: [
            { type: 'setHp', value: 1, formula: '5 * @paid.slotLevel' },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(hunt, 'feature'),
      /хиты становятся 5 \* круг потраченной ячейки, цена: ячейка от 4 круга/,
    );

    const ranger = withHp(
      () => hero({ classes: [{ ...DRUID, level: 9 }] }),
      6,
      {},
      70,
    );

    ranger.activeEffects = [hunt];

    const { requests, requestRoll, answer } = createRequestRoll();
    const copy = structuredClone(ranger);

    engine.applyTargetDamage(copy, 20, false, 'slashing');

    const result = new engine.Dnd5eVttSystem().settleCombatState(
      ranger,
      engine.pickCombatState(copy),
      { requestRoll },
    );

    assert.deepEqual(
      requests[0].payload.options.map((option) => option.label),
      ['ячейка 4 круга', 'ячейка 5 круга', 'Не платить'],
    );

    answer(answered('0:5'));

    (await result.deferred[0].resolution)(ranger);

    assert.equal(engine.resolveEntityCurrentHp(ranger), 25);
    assert.equal(ranger.system.spellSlotsUsed[4], 1);
  });

  it('[PY07] Кипение крови: цена каста — кость хитов, её бросок идёт в урон заклинания', () => {
    // «…вы должны потратить одну кость хитов… Согласная цель получает урон
    // огнём, равный результату броска потраченной кости хитов»
    const price = createEffect('Кипение крови: цена', {
      effectTarget: 'self',
      pay: [{ kind: 'hitDice' }],
    });

    const cure = createEffect('Кипение крови', {
      effectTarget: 'target',
      triggers: [
        {
          id: 'trigger_cure',
          event: 'applied',
          actions: [
            { type: 'removeCondition', conditionKey: 'poisoned' },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    assert.match(authoredScenario(price, 'spell'), /цена: 1 кость хитов/);

    const spell = {
      name: 'Кипение крови',
      damageParts: [{ formula: '@paid.hitDiceRoll', type: 'fire' }],
      activeEffects: [price, cure],
    };

    assert.equal(engine.collectSourcePay(spell.activeEffects), price.pay);
    assert.equal(engine.usesPaidHitDiceRoll(spell), true);

    const caster = hero({ classes: [FIGHTER] });

    const settled = withRandom([0.5], () =>
      payDefault(caster, price.pay, { rollHitDice: true }),
    );

    const paidSpell = engine.bindSourcePaid(spell, settled.paid);

    assert.equal(paidSpell.damageParts[0].formula, '6');

    assert.deepEqual(
      paidSpell.activeEffects.map((effect) => effect.name),
      ['Кипение крови'],
      'эффект, который только называет цену, после оплаты не накладывается',
    );

    assert.equal(
      engine.labelPaidTokens('@paid.hitDiceRoll'),
      'бросок потраченных костей хитов',
      'до каста лист показывает подпись, а не сырой токен',
    );
  });

  it('[PY08] Руна кровавой погибели: число костей растёт от круга, урон бросается заново', () => {
    // «…вы должны потратить одну кость хитов (+1 за круг)… один раз в ход,
    // когда вы наносите урон нежити этим оружием… бросьте количество костей
    // хитов, потраченных на накладывание заклинания»
    const rune = createEffect('Руна кровавой погибели', {
      effectTarget: 'self',
      pay: [{ kind: 'hitDice', amount: '@castLevel' }],
      duration: { type: 'hours', value: 1 },
      triggers: [
        {
          id: 'trigger_bane',
          event: 'attackRoll',
          role: 'attacker',
          recipient: 'other',
          condition:
            'attack.landed === true && target.creatureType === "undead"',
          limit: { max: 1, per: 'turn' },
          actions: [
            {
              type: 'damage',
              parts: [
                { formula: '(@paid.hitDice)к(@paid.hitDie)', type: 'radiant' },
              ],
            },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(rune, 'spell'),
      /цена: @castLevel кости хитов/,
    );

    assert.equal(engine.payUsesCastLevel(rune.pay), true);

    const paladin = hero({ classes: [FIGHTER] });

    const settled = payDefault(paladin, rune.pay, {
      castLevel: 3,
      rollHitDice: engine.usesPaidHitDiceRoll(rune),
    });

    assert.deepEqual(settled.paid, { hitDice: 3, hitDie: 10 });
    assert.deepEqual(settled.notes, ['3 кости хитов (к10)']);

    const stamped = engine.stampEffectPaid(rune, settled.paid);

    assert.equal(
      stamped.triggers[0].actions[0].parts[0].formula,
      '3к10',
      'число и грань костей — в формуле: бросок каждый раз новый',
    );
  });

  it('[PY09] Арканная регенерация: одна или две кости на выбор, предел растёт от круга', () => {
    // «Бросьте 1 или 2 неиспользованные кости хитов и восстановите хиты,
    // равные сумме и вашему модификатору характеристики заклинателя»
    // Заклинание на себя: лечение записано в его собственных полях, а цена —
    // в эффекте без нагрузки (после оплаты он не накладывается)
    const vigor = createEffect('Арканная регенерация: цена', {
      effectTarget: 'self',
      pay: [{ kind: 'hitDice', amount: '1', max: '@castLevel' }],
    });

    assert.match(
      authoredScenario(vigor, 'spell'),
      /цена: 1–@castLevel кости хитов/,
    );

    const spell = {
      name: 'Арканная регенерация',
      damageParts: [{ formula: '@paid.hitDiceRoll + @mod.spell@heal' }],
      activeEffects: [vigor],
    };

    const paidSpell = engine.bindSourcePaid(spell, {
      hitDice: 2,
      hitDie: 10,
      hitDiceRoll: 13,
    });

    assert.equal(paidSpell.damageParts[0].formula, '13 + @mod.spell@heal');
    assert.deepEqual(paidSpell.activeEffects, []);

    const wizard = hero({ classes: [{ ...FIGHTER, hitDiceUsed: 4 }] });

    assert.deepEqual(
      engine
        .planEffectPay(wizard, vigor.pay, { castLevel: 2 })
        .prices[0].options.map((option) => option.amount),
      [1, 2],
    );

    assert.deepEqual(
      engine
        .planEffectPay(wizard, vigor.pay, { castLevel: 4 })
        .prices[0].options.map((option) => option.amount),
      [1, 2],
      'четвёртым кругом можно до четырёх, но осталось две кости',
    );
  });

  it('[PY10] Увядание и цветение: платит получатель — своими костями хитов', async () => {
    // «…одно выбранное существо в области может бросить одну из своих
    // неизрасходованных Костей Хитов и восстановить хиты… плюс ваш
    // модификатор»
    const bloom = createEffect('Цветение', {
      effectTarget: 'target',
      duration: { type: 'special' },
      triggers: [
        {
          id: 'trigger_bloom',
          event: 'applied',
          pay: [{ kind: 'hitDice', amount: '1', max: '@castLevel - 1' }],
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '@paid.hitDiceRoll + @mod.spell@heal' }],
            },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(bloom, 'spell'),
      /цена: 1–@castLevel - 1 кости хитов/,
    );

    // Наложение: круг каста и модификатор заклинателя становятся числами
    const applied = engine.bindSourceEffectFormulas(
      bloom,
      {
        ...engine.buildFormulaContext(createActor()),
        castLevel: 3,
        spellMod: 4,
      },
      { changes: false },
    );

    assert.deepEqual(applied.triggers[0].pay, [
      { kind: 'hitDice', amount: '1', max: '3 - 1' },
    ]);

    const ally = withHp(() => hero({ classes: [FIGHTER] }), 10, {}, 60);

    ally.id = 'actor_ally';
    ally.activeEffects = [{ ...applied, id: 'ae_bloom' }];

    const { requests, requestRoll, answer } = createRequestRoll();

    const result = engine.settleAppliedEvents(ally, new Set(['ae_bloom']), [], {
      requestRoll,
    });

    assert.equal(
      requests[0].entityId,
      ally.id,
      'спрашивают владельца получателя: кости — его',
    );

    assert.deepEqual(
      requests[0].payload.options.map((option) => option.label),
      ['1 кость хитов (к10)', '2 кости хитов (к10)', 'Не платить'],
    );

    answer(answered('0:2:10'));

    await withRandom([MAX_ROLL], async () => {
      (await result.deferred[0].resolution)(ally);
    });

    assert.equal(ally.system.classes[0].hitDiceUsed, 2);

    assert.ok(
      engine.resolveEntityCurrentHp(ally) >= 16,
      '2к10 + 4: не меньше шести',
    );
  });

  it('[PY11] Камень сияния: у каждого свойства своя цена в зарядах', () => {
    // «Первое слово — свет, заряд не тратит. Второе — 1 заряд. Третье — 5
    // зарядов, ослепляющий свет 30-футовым конусом»
    const words = [
      ['Свет', '0'],
      ['Ослепляющий луч', '1'],
      ['Ослепляющая вспышка', '5'],
    ].map(([label, amount]) =>
      createEffect(`Камень сияния: ${label}`, {
        // Конус — только у вспышки: луч бьёт одну цель
        activation: {
          mode: 'use',
          ...(label === 'Ослепляющая вспышка'
            ? { area: { shape: 'cone', size: 30 } }
            : {}),
        },
        variant: { group: 'Камень сияния', label },
        pay: [{ kind: 'itemUses', amount }],
        flags: ['vision.blinded'],
        effectTarget: label === 'Свет' ? 'self' : 'target',
      }),
    );

    assert.match(authoredScenario(words[2], 'item'), /цена: 5 зарядов/);
    assert.match(authoredScenario(words[0], 'item'), /цена: 0 зарядов/);

    const gem = {
      id: 'item_gem',
      name: 'Камень сияния',
      type: 'equipment',
      quantity: 1,
      equipped: true,
      uses: { max: 50, current: 3, recovery: 'never' },
      activeEffects: words,
    };

    const owner = createActor({ equipment: [gem] });

    assert.equal(engine.hasPricedItemUse(gem), true);

    const free = payDefault(owner, words[0].pay, { itemId: gem.id });

    assert.equal(free.entity.equipment[0].uses.current, 3, 'свет — бесплатно');

    const ray = payDefault(owner, words[1].pay, { itemId: gem.id });

    assert.equal(ray.entity.equipment[0].uses.current, 2);
    assert.equal(ray.paid.itemUses, 1);

    assert.match(
      engine.planEffectPay(owner, words[2].pay, { itemId: gem.id }).shortfall
        ?? '',
      /не хватает: 5 зарядов/,
      'на вспышку трёх зарядов мало',
    );

    assert.equal(
      engine.canUseItem({
        ...gem,
        uses: { ...gem.uses, current: 0 },
      }),
      true,
      'пустой камень всё ещё светит: первое слово заряда не тратит',
    );

    // Шаблон области — у выбранного варианта, а не первый заданный в группе
    const useSpell = engine.buildItemUseSpell(gem);

    const chosenArea = (label) =>
      engine.settleUseSpellArea({
        ...useSpell,
        activeEffects: useSpell.activeEffects.filter(
          (effect) => effect.variant.label === label,
        ),
      }).areaOfEffect;

    assert.equal(
      useSpell.areaOfEffect.shape,
      'cone',
      'до выбора — область группы',
    );

    assert.equal(chosenArea('Ослепляющий луч'), undefined, 'луч — одна цель');
    assert.equal(chosenArea('Свет'), undefined);

    assert.deepEqual(chosenArea('Ослепляющая вспышка'), {
      shape: 'cone',
      size: 30,
      unit: 'ft',
      resizable: false,
    });
  });

  it('[PY12] Покров крови: срок формулой — число раундов по потраченным костям', () => {
    // «…может реакцией вновь получить состояние невидимый на количество
    // раундов, равное числу Костей Хитов»
    const shroud = createEffect('Покров крови', {
      effectTarget: 'self',
      pay: [{ kind: 'hitDice', amount: '1', max: '3' }],
      duration: { type: 'minutes', value: 10 },
      triggers: [
        {
          id: 'trigger_vanish',
          event: 'conditionLost',
          conditionKey: 'invisible',
          cost: 'reaction',
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'invisible',
              durationFormula: '@paid.hitDice',
            },
          ],
        },
      ],
    });

    authoredScenario(shroud, 'spell');

    const stamped = engine.stampEffectPaid(shroud, { hitDice: 3, hitDie: 8 });
    const rogue = createActor({ activeEffects: [stamped] });

    engine.applyTriggerEffectActions(
      rogue,
      {
        effect: stamped,
        trigger: stamped.triggers[0],
        ambient: false,
        instance: true,
        scope: stamped.id,
      },
      false,
    );

    const invisible = rogue.activeEffects.find(
      (effect) => effect.conditionKey === 'invisible',
    );

    assert.deepEqual(
      { type: invisible.duration.type, value: invisible.duration.value },
      { type: 'rounds', value: 3 },
    );
  });

  it('[PY13] Черты костей хитов: максимум, «1 и 2 как 3», бесплатная первая — на отдыхе и в цене', () => {
    const tough = createEffect('Живучесть', {
      flags: [engine.HIT_DICE_MAXIMIZE_FLAG, engine.HIT_DICE_FIRST_FREE_FLAG],
    });

    authoredScenario(tough, 'feature');

    const veteran = hero({ classes: [FIGHTER] }, [tough]);

    // Короткий отдых читает те же правила, что и цена
    assert.deepEqual(engine.resolveHitDiceSpendRules(veteran), {
      maximize: true,
      lowAsThree: false,
      freeDie: true,
    });

    const settled = withRandom([MIN_ROLL], () =>
      payDefault(veteran, [{ kind: 'hitDice', amount: '2' }]),
    );

    assert.equal(settled.paid.hitDiceRoll, 20, 'максимум вместо броска');

    assert.equal(
      settled.entity.system.classes[0].hitDiceUsed,
      1,
      'первая кость после отдыха не списана',
    );

    assert.equal(
      engine.resolveHitDiceSpendRules(settled.entity).freeDie,
      false,
      'бесплатная кость одна — до следующего отдыха',
    );

    const rested = {
      ...settled.entity,
      ...engine.applyActorRest(settled.entity, 'short'),
    };

    assert.equal(
      engine.resolveHitDiceSpendRules(rested).freeDie,
      true,
      'отдых возвращает бесплатную кость',
    );

    assert.equal(engine.lowHitDiceBonus([1, 2, 3, 6]), 3, '1→3 и 2→3');
  });

  it('[PY14] Цена по желанию: ноль — «не тратить», отказ ничего не списывает', () => {
    // «…а также потратить одну из своих костей хитов, чтобы бросить её и
    // восстановить хиты» («Пьющий жизнь»: кость — по желанию)
    const optional = [{ kind: 'hitDice', amount: '0', max: '1' }];
    const warlock = hero({ classes: [WARLOCK] });
    const plan = engine.planEffectPay(warlock, optional);

    assert.deepEqual(
      plan.prices[0].options.map((option) => option.label),
      ['кости хитов не тратить', '1 кость хитов (к8)'],
    );

    const declined = engine.settleEffectPay(warlock, plan, [
      plan.prices[0].options[0],
    ]);

    assert.deepEqual(declined.paid, {});
    assert.deepEqual(declined.notes, []);
    assert.equal(declined.entity.system.classes[0].hitDiceUsed ?? 0, 0);
  });
});
