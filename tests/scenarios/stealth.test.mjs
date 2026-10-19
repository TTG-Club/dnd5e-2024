import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  MIN_ROLL,
  strikeEntity,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: засада, поиск и «Невидимость» 2024 (`docs/EFFECT_SCENARIOS.md`,
 * раздел «Засада и невидимость», этап 2 скрытности).
 */

/** Кто нанёс урон в сценариях «Невидимости» */
const DEALER_ID = 'actor_dealer';

/**
 * Сущность в засаде с Сл поиска.
 *
 * @param {number} searchDc - итог проверки Скрытности
 * @returns {object} персонаж и его эффект засады
 */
function hiddenHero(searchDc = 17) {
  const hidden = engine.buildHiddenEffect(searchDc);
  const hero = withHp(createActor, 20, { activeEffects: [hidden] });

  return { hero, hidden };
}

/**
 * Есть ли на сущности засада.
 *
 * @param {object} entity - сущность
 * @returns {boolean} в засаде ли
 */
function isHidden(entity) {
  return engine.findHiddenEffect(entity) !== undefined;
}

/**
 * «Невидимость» 2024 на цели: кончается, когда цель атакует, наносит урон или
 * накладывает заклинание (данные сайта после выпуска — скрипт этапа 2).
 *
 * @returns {object} эффект
 */
function invisibilitySpell() {
  return createEffect('Невидимый', {
    origin: 'condition',
    conditionKey: 'invisible',
    flags: [
      'attack.advantage',
      'attacksAgainst.disadvantage',
      'initiative.advantage',
      'vision.invisible',
    ],
    consumeOn: 'carrierAttack',
    triggers: [
      {
        id: 'invisibility.spellCast',
        event: 'spellCast',
        actions: [{ type: 'removeSelf' }],
      },
      {
        id: 'invisibility.damageDealt',
        event: 'damageDealt',
        actions: [{ type: 'removeSelf' }],
      },
    ],
  });
}

describe('каталог: засада и невидимость', () => {
  it('[H01] Засада: Скрытность Сл 15, «В засаде» с Сл поиска — без невидимости для союзников', () => {
    assert.equal(engine.isHideSuccess(14), false, 'ниже 15 — неудача');
    assert.equal(engine.isHideSuccess(15), true);

    const { hero, hidden } = hiddenHero(18);

    assert.equal(hidden.conditionKey, engine.HIDDEN_CONDITION_KEY);
    assert.equal(hidden.name, 'В засаде');
    assert.equal(hidden.searchDc, 18, 'итог проверки — Сл поиска');

    assert.equal(
      hidden.flags.includes('vision.invisible'),
      false,
      'ядро прячет фишку с этим флагом от всех игроков — союзники должны видеть',
    );

    assert.notEqual(hidden.name, 'Невидимый', 'по имени ядро тоже прячет');

    const flags = engine.resolveActorStats(hero).activeFlags;

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: flags,
        attackType: 'melee',
        targetFlags: new Set(),
      }),
      'advantage',
    );

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: new Set(),
        attackType: 'ranged',
        targetFlags: flags,
      }),
      'disadvantage',
    );

    assert.equal(engine.resolveInitiativeRollMode(flags), 'advantage');

    assert.equal(
      engine.ActiveEffectSchema.parse(hidden).searchDc,
      18,
      'Сл поиска переживает схему эффекта — боевой канал её не срежет',
    );

    assert.deepEqual(
      engine.ActiveEffectSchema.parse(hidden).triggers?.map(
        (trigger) => trigger.event,
      ),
      ['spellCast'],
      'новое событие проходит схему срабатываний',
    );
  });

  it('[H02] Цена засады: действие, с «Хитрым действием» — выбор действие или бонусное', () => {
    assert.deepEqual(engine.listHideCosts(new Set(), false), ['action']);

    assert.deepEqual(
      engine.listHideCosts(new Set([engine.HIDE_AS_BONUS_FLAG]), false),
      ['bonus', 'action'],
      'выбирает игрок: бонусное может быть нужно на другое',
    );

    assert.deepEqual(
      engine.listHideCosts(new Set([engine.HIDE_AS_BONUS_FLAG]), true),
      ['action'],
      'бонусное под запретом («Замедление») — прячутся действием',
    );
  });

  it('[H03] Своя атака: преимущество засады в этом броске, после него засада снята', () => {
    const { hero } = hiddenHero();
    const flags = engine.resolveActorStats(hero).activeFlags;

    // Режим считается до расхода — окно фиксирует его при открытии
    const mode = engine.resolveAttackRollMode({
      attackerFlags: flags,
      attackType: 'melee',
      targetFlags: new Set(),
    });

    const result = engine.runAttackRollTriggers(hero, 'attacker', {
      roll: { hasAdvantage: mode === 'advantage', hasDisadvantage: false },
    });

    assert.equal(mode, 'advantage');
    assert.equal(result.changed, true);
    assert.equal(isHidden(hero), false, 'атака снимает засаду');

    const { hero: target } = hiddenHero();

    engine.runAttackRollTriggers(target, 'target', {});

    assert.equal(
      isHidden(target),
      true,
      'атака ПО спрятавшемуся засаду не снимает',
    );
  });

  it('[H04] Заклинание с вербальным компонентом снимает засаду, без него — нет', () => {
    const { hero: silent } = hiddenHero();

    engine.runSpellCastTriggers(silent, { spell: { verbal: false } });
    assert.equal(isHidden(silent), true, 'без V — засада держится');

    const { hero: loud } = hiddenHero();

    engine.runSpellCastTriggers(loud, { spell: { verbal: true } });
    assert.equal(isHidden(loud), false, 'с V — засада снята');

    assert.equal(
      engine.isVerbalSpellCast({ components: { verbal: true } }, true),
      false,
      'статблок, колдующий без вербальных компонентов, засаду не выдаёт',
    );

    assert.equal(
      engine.isVerbalSpellCast({ components: { verbal: true } }),
      true,
    );

    assert.equal(engine.isVerbalSpellCast({}), false);
  });

  it('[H05] Поиск: Внимательность против Сл поиска; находка снимает засаду', () => {
    assert.equal(engine.isSearchSuccess(16, 17), false);
    assert.equal(engine.isSearchSuccess(17, 17), true, 'равно Сл — нашёл');

    const { hero, hidden } = hiddenHero();
    const kept = createEffect('Благословение');

    assert.deepEqual(
      engine
        .withoutHiddenEffects([...hero.activeEffects, kept])
        .map((effect) => effect.id),
      [kept.id],
    );

    const payload = {
      entityId: hero.id,
      effectId: hidden.id,
      searchDc: 17,
    };

    assert.deepEqual(
      engine.parseHideFollowUp(engine.serializeHideFollowUp(payload)),
      payload,
      'кнопки под сообщением читают ровно то, что записано',
    );

    const hides = [
      { entityId: 'a', effectId: 'ea', searchDc: 12 },
      { entityId: 'b', effectId: 'eb', searchDc: 18 },
      { entityId: 'c', effectId: 'ec', searchDc: 15 },
    ];

    assert.deepEqual(
      engine.pickFoundHides(15, hides).map((hide) => hide.entityId),
      ['a', 'c'],
      'один бросок — все засады, чья Сл не выше итога',
    );

    assert.deepEqual(engine.pickFoundHides(11, hides), []);

    assert.equal(engine.parseHideFollowUp('{"entityId":1}'), null);
    assert.equal(engine.parseHideFollowUp('не json'), null);
  });

  it('[H06] Одна причина преимущества: «В засаде», а не ещё «цель не видит атакующего»', () => {
    const { hidden } = hiddenHero();

    const reasons = engine.explainAttackRollMode({
      attackType: 'melee',
      attackerFlags: new Set(hidden.flags),
      attackerEffects: [hidden],
      rollContext: { hasAdvantage: false, hasDisadvantage: false },
      targetFlags: new Set(),
      targetEffects: [],
      isBeyondNormalRange: false,
      isAttackerUnseen: true,
    });

    assert.deepEqual(reasons.advantage, ['В засаде']);
  });

  it('[H07] «Невидимость» 2024: снимается атакой, заклинанием и нанесённым уроном', () => {
    const attacker = withHp(createActor, 20, {
      activeEffects: [invisibilitySpell()],
    });

    engine.runAttackRollTriggers(attacker, 'attacker', {});
    assert.deepEqual(attacker.activeEffects, [], 'атака');

    const caster = withHp(createActor, 20, {
      activeEffects: [invisibilitySpell()],
    });

    engine.runSpellCastTriggers(caster, { spell: { verbal: false } });
    assert.deepEqual(caster.activeEffects, [], 'любое заклинание, даже без V');

    const system = new engine.Dnd5eVttSystem();

    const dealer = withHp(createActor, 20, {
      id: DEALER_ID,
      activeEffects: [invisibilitySpell()],
    });

    const victim = withHp(createCreature, 30, { id: 'creature_victim' });

    const result = withRandom([MIN_ROLL], () =>
      strikeEntity(system, victim, 5, 'fire', {
        details: { critical: false, sourceId: DEALER_ID },
        context: {
          getEntity: (id) => (id === DEALER_ID ? dealer : undefined),
        },
      }),
    );

    assert.deepEqual(
      dealer.activeEffects,
      [],
      'нанёс урон — невидимость кончилась',
    );

    assert.deepEqual(
      result.related?.map((related) => related.entity.id),
      [DEALER_ID],
      'правка нанёсшего уходит в мир «другой стороной» снимка раненого',
    );
  });

  it('[H08] «Нанёс урон» молчит без нанёсшего и при уроне себе', () => {
    const system = new engine.Dnd5eVttSystem();

    const dealer = withHp(createActor, 20, {
      id: DEALER_ID,
      activeEffects: [invisibilitySpell()],
    });

    const getEntity = (id) => (id === DEALER_ID ? dealer : undefined);
    const victim = withHp(createCreature, 30, { id: 'creature_victim' });

    withRandom([MIN_ROLL], () =>
      strikeEntity(system, victim, 5, 'fire', {
        details: { critical: false },
        context: { getEntity },
      }),
    );

    assert.equal(dealer.activeEffects.length, 1, 'урон без источника');

    withRandom([MIN_ROLL], () =>
      strikeEntity(system, dealer, 5, 'fire', {
        details: { critical: false, sourceId: DEALER_ID },
        context: { getEntity },
      }),
    );

    assert.equal(
      dealer.activeEffects.some(
        (effect) => effect.conditionKey === 'invisible',
      ),
      true,
      'урон себе нанесённым другим не считается',
    );
  });

  it('[H09] Застигнутый врасплох: помеха на инициативу, снимается в начале своего хода', () => {
    const surprised = engine.buildConditionActiveEffect(
      engine.SURPRISED_CONDITION_KEY,
    );

    const hero = withHp(createActor, 20, { activeEffects: [surprised] });

    assert.equal(
      engine.resolveInitiativeRollMode(
        engine.resolveActorStats(hero).activeFlags,
      ),
      'disadvantage',
    );

    engine.processTurnEffects(hero, 'startOfTurn');

    assert.deepEqual(
      hero.activeEffects,
      [],
      'к первому ходу инициатива брошена',
    );
  });

  it('[H10] Инициатива сервера читает флаги: засада — преимущество, врасплох — помеха', () => {
    const system = new engine.Dnd5eVttSystem();
    const { hero } = hiddenHero();

    const surprised = withHp(createActor, 20, {
      activeEffects: [
        engine.buildConditionActiveEffect(engine.SURPRISED_CONDITION_KEY),
      ],
    });

    const high = 0.95;
    const low = 0.05;

    const advantage = withRandom([low, high], () =>
      system.rollInitiative(hero),
    );

    const disadvantage = withRandom([low, high], () =>
      system.rollInitiative(surprised),
    );

    assert.equal(advantage.roll, 20, 'большая из двух');
    assert.equal(disadvantage.roll, 2, 'меньшая из двух');

    const formulas = [];

    system.rollInitiative(hero, (formula) => {
      formulas.push(formula);

      return { total: 12, rolls: [] };
    });

    assert.deepEqual(formulas, ['2к20kh1']);
  });

  it('[H12] «Нанёс урон» — один раз на действие, сколько бы целей оно ни задело', () => {
    const system = new engine.Dnd5eVttSystem();

    const dealer = withHp(createActor, 20, {
      id: DEALER_ID,
      activeEffects: [
        createEffect('Тяга к крови', {
          triggers: [
            {
              id: 'trigger_dealt',
              event: 'damageDealt',
              actions: [{ type: 'applyCondition', conditionKey: 'exhaustion' }],
            },
          ],
        }),
      ],
    });

    const getEntity = (id) => (id === DEALER_ID ? dealer : undefined);

    const strike = (victimId, actionId) =>
      withRandom([MIN_ROLL], () =>
        strikeEntity(
          system,
          withHp(createCreature, 30, { id: victimId }),
          5,
          'fire',
          {
            details: { critical: false, sourceId: DEALER_ID, actionId },
            context: { getEntity },
          },
        ),
      );

    // Одно действие («Огненный шар») по трём целям — три снимка
    strike('creature_a', 'action_fireball');
    strike('creature_b', 'action_fireball');
    strike('creature_c', 'action_fireball');

    assert.equal(
      engine.getEntityExhaustionLevel(dealer.activeEffects),
      1,
      'наложение одно — на первом снимке действия',
    );

    strike('creature_a', 'action_second');

    assert.equal(
      engine.getEntityExhaustionLevel(dealer.activeEffects),
      2,
      'новое действие — новое срабатывание',
    );
  });

  it.todo(
    '[H11] Засада против того, кто видит спрятавшегося — пробел (особые чувства у ядра)',
  );

  it.todo(
    '[H13] Урон зоны и срабатываний сервера снимает «Невидимость» — пробел (нет нанёсшего у удара)',
  );

  it.todo(
    '[H14] «Подсознательное заклинание» не выдаёт засаду — пробел (метамагия в касте)',
  );

  it.todo(
    '[H15] Заклинание со свитка или из жезла — каст для засады — пробел (применение предмета)',
  );
});
