import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  PLAYER_ID,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Данные события у срабатывания, которое сперва спрашивает человека (цена
 * «реакция», галочка «спрашивать», цена ресурсом): после согласия оно
 * выполняется тем же, чем выполнилось бы без вопроса, — тип урона события,
 * Сл от урона события и защиты получателя не теряются по дороге.
 */

/** Кто ударил героя — другая сторона события урона */
const ATTACKER_ID = 'creature_attacker';

/** Максимум хитов героя */
const HERO_MAX_HP = 40;

/** Максимум хитов ударившего: по ним видно, каким типом пришёл ответ */
const ATTACKER_MAX_HP = 60;

/** Урон ответного срабатывания: плоское число, чтобы не зависеть от костей */
const REDIRECT_DAMAGE = 10;

/** Урон «того же типа, что получен» */
const REDIRECT_ACTIONS = [
  {
    type: 'damage',
    parts: [{ formula: `${REDIRECT_DAMAGE}@dmg.event` }],
  },
];

/**
 * Запрос ядра, на который человек сразу соглашается: вопрос срабатывания —
 * «да», выбор цели — первый кандидат.
 *
 * @returns {{ requestRoll: Function, requests: object[] }} двойник
 */
function createAgreeingRequestRoll() {
  const requests = [];

  return {
    requests,
    requestRoll: (request) => {
      requests.push(request);

      const { candidates } = request.payload ?? {};

      return Promise.resolve({
        status: 'answered',
        result: candidates
          ? { chosenIds: [candidates[0].id] }
          : { optionId: engine.EFFECT_PROMPT_CONFIRM.yes },
        respondedByUserId: PLAYER_ID,
      });
    },
  };
}

/**
 * Доводит отложенные срабатывания до конца — как ядро: каждое применяется к
 * своей живой сущности, вложенные встают в ту же очередь.
 *
 * @param {object[] | undefined} deferred - отложенные срабатывания итога
 * @param {object[]} entities - живые сущности мира
 * @returns {Promise<object[]>} исходы по порядку применения
 */
async function settleDeferred(deferred, entities) {
  const queue = [...(deferred ?? [])];
  const outcomes = [];

  while (queue.length > 0) {
    const next = queue.shift();
    const apply = await next.resolution;
    const live = entities.find((entity) => entity.id === next.entityId);

    assert.ok(live, `Нет живой сущности ${next.entityId}`);

    const outcome = apply?.(live);

    if (outcome) {
      outcomes.push(outcome);
      queue.push(...(outcome.deferred ?? []));
    }
  }

  return outcomes;
}

/**
 * Герой с одним срабатыванием «получил урон».
 *
 * @param {object} trigger - поля срабатывания сверх события
 * @param {object} sheet - поля листа героя (чем платить цену)
 * @returns {object} герой
 */
function createHero(trigger, sheet = {}) {
  const hero = withHp(createActor, HERO_MAX_HP, {
    activeEffects: [
      createEffect('redirect', {
        triggers: [
          { id: 'trigger_redirect', event: 'damageTaken', ...trigger },
        ],
      }),
    ],
  });

  hero.system = { ...hero.system, ...sheet };

  return hero;
}

/**
 * Маг с иммунитетом к холоду: по нему видно, холодом ли пришёл ответ.
 *
 * @returns {object} существо
 */
function createIceMage() {
  return withHp(createCreature, ATTACKER_MAX_HP, {
    id: ATTACKER_ID,
    activeEffects: [createEffect('ice', { flags: ['immunity.cold'] })],
  });
}

/**
 * Удар атакующего по герою и все ответы на вопросы срабатывания.
 *
 * @param {object} hero - герой (мутируется)
 * @param {object} attacker - кто бьёт (мутируется)
 * @param {object} strike - удар
 * @param {number} strike.amount - урон удара
 * @param {string} strike.damageType - тип урона удара
 * @param {boolean} strike.canAsk - умеет ли ядро спросить человека
 * @returns {Promise<{ questions: number, saveDcs: number[] }>} число вопросов и Сл спасбросков
 */
async function strikeHero(hero, attacker, { amount, damageType, canAsk }) {
  const double = createAgreeingRequestRoll();

  const result = engine.settleDamageEvents(
    hero,
    [{ amount, types: [damageType], critical: false, sourceId: ATTACKER_ID }],
    {
      hpBefore: HERO_MAX_HP,
      ...(canAsk ? { requestRoll: double.requestRoll } : {}),
      getEntity: (entityId) =>
        entityId === ATTACKER_ID ? attacker : undefined,
      listEntitiesInArea: () => [attacker],
    },
  );

  const outcomes = await settleDeferred(result.deferred, [hero, attacker]);

  return {
    questions: double.requests.length,
    saveDcs: [
      ...result.related.flatMap((related) => related.saveOutcomes),
      ...outcomes.flatMap((outcome) => outcome.saveOutcomes),
    ].map((save) => save.dc),
  };
}

describe('данные события после вопроса человеку', () => {
  /**
   * Ответ героя «тем же типом» на удар мага.
   *
   * @param {string} damageType - тип урона удара
   * @param {object} patch - вопрос срабатывания; пусто — без вопроса
   * @param {object} sheet - поля листа героя
   * @returns {Promise<{ mageHp: number, questions: number }>} хиты мага и число вопросов
   */
  const redirect = async (damageType, patch = {}, sheet = {}) => {
    const mage = createIceMage();

    const hero = createHero(
      { recipient: 'other', actions: REDIRECT_ACTIONS, ...patch },
      sheet,
    );

    const { questions } = await strikeHero(hero, mage, {
      amount: 6,
      damageType,
      canAsk: true,
    });

    return { mageHp: engine.resolveEntityCurrentHp(mage), questions };
  };

  it('без вопроса тип урона события видят защиты получателя', async () => {
    assert.deepEqual(await redirect('cold'), {
      mageHp: ATTACKER_MAX_HP,
      questions: 0,
    });

    assert.deepEqual(await redirect('fire'), {
      mageHp: ATTACKER_MAX_HP - REDIRECT_DAMAGE,
      questions: 0,
    });
  });

  it('удар двумя типами: отвечают тем типом, что прошёл условие', async () => {
    // Жало скорпиона: колющий и яд одним броском. «Перенаправление энергии»
    // слушает яд — и отвечать должно ядом, а не первым типом удара
    const redirectMixed = async (condition, immunity) => {
      const attacker = withHp(createCreature, ATTACKER_MAX_HP, {
        id: ATTACKER_ID,
        activeEffects: [createEffect('ward', { flags: [immunity] })],
      });

      const hero = createHero({
        recipient: 'other',
        actions: REDIRECT_ACTIONS,
        ...(condition ? { condition } : {}),
      });

      const result = engine.settleDamageEvents(
        hero,
        [
          {
            amount: 6,
            types: ['piercing', 'poison'],
            critical: false,
            sourceId: ATTACKER_ID,
          },
        ],
        {
          hpBefore: HERO_MAX_HP,
          getEntity: (entityId) =>
            entityId === ATTACKER_ID ? attacker : undefined,
          listEntitiesInArea: () => [attacker],
        },
      );

      await settleDeferred(result.deferred, [hero, attacker]);

      return engine.resolveEntityCurrentHp(attacker);
    };

    const poisonOnly = 'damage.type === "poison, fire"';

    assert.equal(
      await redirectMixed(poisonOnly, 'immunity.poison'),
      ATTACKER_MAX_HP,
      'ответ идёт ядом — иммунитет к яду его гасит',
    );

    assert.equal(
      await redirectMixed(poisonOnly, 'immunity.piercing'),
      ATTACKER_MAX_HP - REDIRECT_DAMAGE,
      'колющим ответ не идёт',
    );

    // Без условия — первый тип удара, как раньше
    assert.equal(
      await redirectMixed(undefined, 'immunity.piercing'),
      ATTACKER_MAX_HP,
    );
  });

  it('после согласия тип урона события тот же: реакция, «спрашивать», цена ресурсом', async () => {
    const asking = [
      { patch: { cost: 'reaction' }, sheet: {} },
      { patch: { ask: true }, sheet: {} },
      {
        patch: { pay: [{ kind: 'inspiration' }] },
        sheet: { inspiration: true },
      },
    ];

    for (const { patch, sheet } of asking) {
      const label = JSON.stringify(patch);

      assert.deepEqual(
        await redirect('cold', patch, sheet),
        { mageHp: ATTACKER_MAX_HP, questions: 1 },
        `${label}: ответ холодом гасит иммунитет мага`,
      );

      assert.deepEqual(
        await redirect('fire', patch, sheet),
        { mageHp: ATTACKER_MAX_HP - REDIRECT_DAMAGE, questions: 1 },
        `${label}: ответ огнём проходит целиком`,
      );
    }
  });

  it('тип урона события проходит оба вопроса: согласие, затем выбор цели', async () => {
    const mage = createIceMage();

    const hero = createHero({
      cost: 'reaction',
      recipient: 'choice',
      choice: { radius: 60 },
      actions: REDIRECT_ACTIONS,
    });

    const { questions } = await strikeHero(hero, mage, {
      amount: 6,
      damageType: 'cold',
      canAsk: true,
    });

    assert.equal(questions, 2, 'согласие и выбор цели');
    assert.equal(engine.resolveEntityCurrentHp(mage), ATTACKER_MAX_HP);
  });

  it('сл от урона события у спасброска получателя после согласия та же', async () => {
    /**
     * Удар на 30 по герою, чьё срабатывание требует спасбросок от ударившего.
     *
     * @param {object} patch - вопрос срабатывания; пусто — без вопроса
     * @returns {Promise<number[]>} Сл спасбросков ударившего
     */
    const saveDcsAfter = async (patch) => {
      const asks = Object.keys(patch).length > 0;

      const hero = createHero({
        recipient: 'other',
        save: {
          ability: 'dexterity',
          dc: 10,
          dcFormula: engine.CONCENTRATION_SAVE_DC_FORMULA,
        },
        actions: [
          {
            type: 'damage',
            parts: [{ formula: '1', type: 'fire' }],
            on: 'failed',
          },
        ],
        ...patch,
      });

      const attacker = withHp(createCreature, ATTACKER_MAX_HP, {
        id: ATTACKER_ID,
      });

      // Без запроса ядра спросить некого — это и есть путь без вопроса
      const { saveDcs } = await strikeHero(hero, attacker, {
        amount: 30,
        damageType: 'slashing',
        canAsk: asks,
      });

      return saveDcs;
    };

    assert.deepEqual(await saveDcsAfter({}), [15], 'без вопроса — пол-урона');
    assert.deepEqual(await saveDcsAfter({ ask: true }), [15], 'после согласия');
  });

  it('ауры вокруг субъекта чужому получателю защит не дают', async () => {
    const hero = withHp(createActor, HERO_MAX_HP);

    const orc = withHp(createCreature, ATTACKER_MAX_HP, { id: ATTACKER_ID });

    const source = {
      effect: createEffect('redirect'),
      trigger: {
        id: 'trigger_redirect',
        event: 'damageTaken',
        recipient: 'other',
        actions: [
          {
            type: 'damage',
            parts: [{ formula: String(REDIRECT_DAMAGE), type: 'fire' }],
          },
        ],
      },
      ambient: false,
      instance: false,
      scope: 'redirect',
    };

    const outcome = engine.settleTriggerRecipients(hero, source, [orc], {
      ambientEffects: [createEffect('ward', { flags: ['immunity.fire'] })],
    });

    await settleDeferred(outcome.deferred, [hero, orc]);

    assert.equal(
      engine.resolveEntityCurrentHp(orc),
      ATTACKER_MAX_HP - REDIRECT_DAMAGE,
      'аура вокруг героя орка не защищает',
    );
  });
});
