import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Срабатывания «после отдыха»: цена ресурсом и вопрос владельцу работают тем
 * же порядком, что на остальных путях (разбор цены → отказ при нехватке →
 * вопрос → списание → действия), а выполняются они на уже отдохнувшей
 * сущности — после возврата костей хитов и снятия степени Истощения.
 */

/** Отметка, которую ставит срабатывание отдыха */
const BLOOD_TAG = 'freshBlood';

/** Максимум хитов героя */
const HERO_MAX_HP = 60;

/** Воин 8 уровня, потративший две кости хитов */
const FIGHTER = { classKey: 'fighter', level: 8, hitDie: 10, hitDiceUsed: 2 };

/** Цена «половина оставшихся Костей Хитов» */
const HALF_HIT_DICE_PAY = [
  { kind: 'hitDice', amount: 'ceil(@hitDice.left / 2)' },
];

/**
 * Эффект со срабатыванием «после продолжительного отдыха».
 *
 * @param {object} trigger - цена, вопрос и действия срабатывания
 * @returns {object} эффект
 */
function restEffect(trigger) {
  return createEffect('Свежая кровь', {
    triggers: [
      {
        id: 'trigger_rest',
        event: 'rest',
        restType: 'long',
        actions: [{ type: 'applyTag', tag: BLOOD_TAG }],
        ...trigger,
      },
    ],
  });
}

/**
 * Герой в надетом и настроенном доспехе с эффектом.
 *
 * @param {object} effect - постоянный эффект доспеха
 * @param {object} overrides - поля героя сверх умолчания
 * @returns {object} герой
 */
function armoredHero(effect, overrides = {}) {
  const hero = withHp(
    createActor,
    30,
    {
      equipment: [
        {
          id: 'item_armor',
          name: 'Живая каменная кожа',
          type: 'equipment',
          equipped: true,
          magicAttunement: 'required',
          isAttuned: true,
          activeEffects: [effect],
        },
      ],
      ...overrides,
    },
    HERO_MAX_HP,
  );

  hero.system = { ...hero.system, classes: [{ ...FIGHTER }] };

  return hero;
}

/**
 * Владелец, отвечающий на вопросы срабатываний отдыха.
 *
 * @param {Function} pick - какой вариант выбрать по вопросу; `null` — отказ
 * @returns {{ ask: Function, questions: object[] }} двойник плашки стола
 */
function createOwner(pick) {
  const questions = [];

  return {
    questions,
    ask: (payload) => {
      questions.push(payload);

      return Promise.resolve({ optionId: pick(payload) });
    },
  };
}

/**
 * Согласие на любой вопрос «да / нет».
 *
 * @returns {string} ключ ответа «да»
 */
const agree = () => engine.EFFECT_PROMPT_CONFIRM.yes;

/**
 * Продолжительный отдых героя так, как его делает лист: вопросы владельцу,
 * затем отдых с ответами и сводкой.
 *
 * @param {object} hero - герой
 * @param {object} owner - владелец (`createOwner`)
 * @returns {Promise<{ after: object, notes: string[] }>} герой после отдыха и строки сводки
 */
async function longRest(hero, owner) {
  const triggerAnswers = await engine.askRestTriggers(hero, 'long', owner.ask);
  const triggerReport = { notes: [], results: [] };

  const patch = engine.applyActorRest(hero, 'long', {
    triggerAnswers,
    triggerReport,
  });

  return { after: { ...hero, ...patch }, notes: triggerReport.notes };
}

/**
 * Стоит ли на сущности отметка срабатывания отдыха.
 *
 * @param {object} entity - сущность
 * @returns {boolean} `true`, если срабатывание выполнилось
 */
function hasBloodTag(entity) {
  return (entity.activeEffects ?? []).some(
    (effect) => effect.tag === BLOOD_TAG,
  );
}

describe('срабатывания «после отдыха»: цена и вопрос', () => {
  it('срабатывание с ценой без ответа владельца не выполняется — и это видно', () => {
    const hero = armoredHero(restEffect({ pay: HALF_HIT_DICE_PAY }));
    const triggerReport = { notes: [], results: [] };
    const patch = engine.applyActorRest(hero, 'long', { triggerReport });

    assert.equal(hasBloodTag(patch), false, 'бесплатно действия не идут');

    assert.equal(
      patch.system.classes[0].hitDiceUsed,
      0,
      'цена не списана: кости вернул отдых',
    );

    assert.deepEqual(triggerReport.notes, [
      `Свежая кровь: ${engine.TRIGGER_ASK_CHAT_NOTES.declined}`,
    ]);
  });

  it('по согласию цена списывается с уже отдохнувшего листа, действия идут', async () => {
    const hero = armoredHero(restEffect({ pay: HALF_HIT_DICE_PAY }));
    const owner = createOwner(agree);
    const { after, notes } = await longRest(hero, owner);

    assert.equal(owner.questions.length, 1);
    assert.equal(owner.questions[0].question, engine.TRIGGER_ASK_QUESTIONS.pay);
    assert.equal(owner.questions[0].sourceName, 'Свежая кровь');

    // Отдых вернул обе потраченные кости: осталось 8, половина — 4
    assert.equal(after.system.classes[0].hitDiceUsed, 4);
    assert.equal(hasBloodTag(after), true);
    assert.match(notes.join('\n'), /Свежая кровь — цена: 4 /);

    // Лист из стора не тронут: отдых считался на копии
    assert.equal(hero.system.classes[0].hitDiceUsed, 2);
  });

  it('отказ и закрытая плашка отменяют срабатывание, цена остаётся', async () => {
    for (const refuse of [() => engine.EFFECT_PROMPT_CONFIRM.no, () => null]) {
      const hero = armoredHero(restEffect({ pay: HALF_HIT_DICE_PAY }));
      const { after, notes } = await longRest(hero, createOwner(refuse));

      assert.equal(hasBloodTag(after), false);
      assert.equal(after.system.classes[0].hitDiceUsed, 0);

      assert.deepEqual(notes, [
        `Свежая кровь: ${engine.TRIGGER_ASK_CHAT_NOTES.declined}`,
      ]);
    }
  });

  it('цена не по карману: вопроса нет, срабатывание отменено со строкой в сводку', async () => {
    const hero = armoredHero(restEffect({ pay: [{ kind: 'inspiration' }] }));
    const owner = createOwner(agree);
    const { after, notes } = await longRest(hero, owner);

    assert.equal(owner.questions.length, 0, 'спрашивать не о чем');
    assert.equal(hasBloodTag(after), false);
    assert.equal(notes.length, 1);

    assert.ok(
      notes[0].startsWith(
        `Свежая кровь: ${engine.TRIGGER_ASK_CHAT_NOTES.unaffordable}`,
      ),
    );
  });

  it('цена с выбором: владелец выбирает, сколько платить', async () => {
    const hero = armoredHero(
      restEffect({ pay: [{ kind: 'hitDice', amount: '1', max: '3' }] }),
    );

    // Варианты — одна, две или три кости; последним идёт отказ платить
    const owner = createOwner((payload) => payload.options[1].id);
    const { after } = await longRest(hero, owner);

    assert.equal(
      owner.questions[0].question,
      engine.TRIGGER_ASK_QUESTIONS.payChoice,
    );

    assert.equal(after.system.classes[0].hitDiceUsed, 2);
    assert.equal(hasBloodTag(after), true);
  });

  it('галочка «спрашивать» без цены: вопрос задан, согласие пускает срабатывание', async () => {
    const hero = armoredHero(restEffect({ ask: true }));

    assert.equal(
      hasBloodTag(engine.applyActorRest(hero, 'long')),
      false,
      'без ответа срабатывание не идёт',
    );

    const owner = createOwner(agree);
    const { after } = await longRest(hero, owner);

    assert.equal(
      owner.questions[0].question,
      engine.TRIGGER_ASK_QUESTIONS.plain,
    );

    assert.equal(hasBloodTag(after), true);
  });

  it('срабатывание без цены и вопроса идёт как прежде', () => {
    const hero = armoredHero(restEffect({}));

    assert.equal(hasBloodTag(engine.applyActorRest(hero, 'long')), true);
  });

  it('существо: срабатывание отдыха с вопросом ждёт ответа владельца', async () => {
    const wolf = withHp(createCreature, 10, {
      activeEffects: [restEffect({ ask: true })],
    });

    assert.equal(hasBloodTag(engine.applyCreatureRest(wolf, 'long')), false);

    const triggerAnswers = await engine.askRestTriggers(
      wolf,
      'long',
      createOwner(agree).ask,
    );

    assert.equal(
      hasBloodTag(engine.applyCreatureRest(wolf, 'long', { triggerAnswers })),
      true,
    );
  });
});

describe('срабатывания «после отдыха»: порядок', () => {
  it('истощение, наложенное срабатыванием отдыха, этот же отдых не снимает', () => {
    const tiring = restEffect({
      actions: [{ type: 'applyCondition', conditionKey: 'exhaustion' }],
    });

    const fresh = engine.applyActorRest(armoredHero(tiring), 'long');

    assert.equal(engine.getEntityExhaustionLevel(fresh.activeEffects), 1);

    // Отдых снимает одну из двух прежних степеней, срабатывание кладёт новую
    const tired = armoredHero(tiring, {
      activeEffects: engine.withExhaustionLevel([], 2),
    });

    assert.equal(
      engine.getEntityExhaustionLevel(
        engine.applyActorRest(tired, 'long').activeEffects,
      ),
      2,
    );
  });

  it('урон срабатывания после продолжительного отдыха остаётся', () => {
    const hero = armoredHero(
      restEffect({
        actions: [
          { type: 'damage', parts: [{ formula: '5', type: 'necrotic' }] },
        ],
      }),
    );

    assert.equal(
      engine.applyActorRest(hero, 'long').system.hitPoints.current,
      HERO_MAX_HP - 5,
      'хиты поднял отдых, урон пришёл после',
    );
  });

  it('короткий отдых: цена срабатывания берётся после костей, потраченных в окне', async () => {
    const hero = armoredHero(
      restEffect({ restType: 'short', pay: [{ kind: 'hitDice' }] }),
    );

    // Окно короткого отдыха потратило ещё одну кость и вылечило 7 хитов
    const windowResult = {
      hitPointsCurrent: 37,
      classes: [{ ...FIGHTER, hitDiceUsed: 3 }],
    };

    const triggerAnswers = await engine.askRestTriggers(
      engine.spendShortRestHitDice(hero, windowResult),
      'short',
      createOwner(agree).ask,
    );

    const patch = engine.applyShortRestWithHitDice(hero, windowResult, {
      triggerAnswers,
    });

    assert.equal(patch.system.classes[0].hitDiceUsed, 4);
    assert.equal(patch.system.hitPoints.current, 37);
    assert.equal(hasBloodTag(patch), true);
  });

  it('отдых без пользы: срабатывание идёт и цену берёт с того, что есть', async () => {
    const hero = armoredHero(restEffect({ pay: [{ kind: 'hitDice' }] }), {
      activeEffects: [
        createEffect('Проклятие бессонницы', {
          flags: ['rest.noBenefit.long'],
        }),
      ],
    });

    const { after } = await longRest(hero, createOwner(agree));

    assert.equal(
      after.system.classes[0].hitDiceUsed,
      3,
      'кости отдых не вернул, цена — сверху',
    );

    assert.equal(after.system.hitPoints.current, 30, 'хиты отдых не поднял');
    assert.equal(hasBloodTag(after), true);
  });
});
