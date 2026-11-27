import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  BLESS_CAST_ID,
  castEndingContext,
  CLERIC_ID,
  concentratingCaster,
  createActor,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Сроки эффектов по игровым часам мира (`expireTimedEffects`): ядро сообщает
 * текущее игровое время, система ставит эффекту момент окончания «сейчас +
 * срок» и снимает эффект, когда часы до него дошли. Раунд — 6 секунд, поэтому
 * «2 раунда» вне боя — это 12 игровых секунд, а «10 минут» в бою — 100 раундов.
 */

/** Игровое время, от которого считаются сценарии (секунды) */
const NOW = 1_000_000;

/** Секунд в раунде D&D 5e */
const ROUND = 6;

/** Ядро отвечает: сущность в бою */
const IN_COMBAT_CONTEXT = { isInCombat: () => true };

/** Ядро отвечает: сущность вне боя */
const OUT_OF_COMBAT_CONTEXT = { isInCombat: () => false };

/** «До конца следующего хода носителя» */
const CARRIER_TURN_END = {
  type: 'turn',
  turnAnchor: 'carrier',
  turnTiming: 'end',
};

/** Заклинатель «Ускорения» — сам себе цель */
const HASTE_CASTER_ID = 'actor_hero';

/** Каст «Ускорения» */
const HASTE_CAST_ID = 'cast_haste';

/** «Ускорение»: концентрация на минуту, накладывается действием */
const HASTE = {
  id: 'spell_haste',
  name: 'Ускорение',
  level: 3,
  concentration: true,
  castingTimeUnit: 'action',
  durationUnit: 'minute',
  durationValue: 1,
};

/** Вялость после конца «Ускорения», как в записи сайта (haste-phb) */
const HASTE_LETHARGY_TRIGGER = {
  id: 'trigger_haste_lethargy',
  event: 'castEnd',
  actions: [
    {
      type: 'applyCondition',
      flags: ['speed.zero'],
      duration: CARRIER_TURN_END,
      conditionKey: 'incapacitated',
    },
  ],
};

/**
 * Персонаж с одним эффектом.
 *
 * @param {object} duration - длительность эффекта
 * @returns {object} персонаж
 */
function heroWith(duration) {
  return withHp(createActor, 30, {
    activeEffects: [createEffect('Эффект', { duration })],
  });
}

describe('сроки эффектов по игровым часам', () => {
  it('раунд системы — 6 секунд', () => {
    assert.equal(new engine.Dnd5eVttSystem().secondsPerRound, ROUND);
  });

  it('новый эффект получает момент окончания: раунды по 6 с, минуты, дни', () => {
    const system = new engine.Dnd5eVttSystem();

    const cases = [
      [{ type: 'rounds', value: 2, remaining: 2 }, 2 * ROUND],
      [{ type: 'minutes', value: 10, remaining: 100 }, 600],
      [{ type: 'hours', value: 1, remaining: 600 }, 3600],
      [{ type: 'days', value: 1 }, 86_400],
      [{ type: 'minutes', value: 1 }, 60],
    ];

    for (const [duration, seconds] of cases) {
      const hero = heroWith(duration);

      assert.deepEqual(system.expireTimedEffects(hero, NOW, {}), {
        changed: true,
        chatSummary: null,
      });

      assert.equal(hero.activeEffects[0].duration.expiresAt, NOW + seconds);
    }
  });

  it('остаток раундов, уже идущий, точнее исходного срока', () => {
    const system = new engine.Dnd5eVttSystem();

    // «10 минут», из которых в бою прошло 40 раундов
    const hero = heroWith({ type: 'minutes', value: 10, remaining: 60 });

    system.expireTimedEffects(hero, NOW, {});
    assert.equal(hero.activeEffects[0].duration.expiresAt, NOW + 60 * ROUND);
  });

  it('эффект снимается, когда часы дошли до момента окончания', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = heroWith({ type: 'rounds', value: 2, remaining: 2 });

    system.expireTimedEffects(hero, NOW, {});

    assert.deepEqual(system.expireTimedEffects(hero, NOW + 11, {}), {
      changed: false,
      chatSummary: null,
    });

    assert.equal(hero.activeEffects.length, 1);

    system.expireTimedEffects(hero, NOW + 12, {});
    assert.equal(hero.activeEffects.length, 0);
  });

  it('бессрочный эффект и «до конца хода» в бою часы не трогают', () => {
    const system = new engine.Dnd5eVttSystem();

    for (const duration of [
      { type: 'permanent' },
      { type: 'special' },
      { type: 'turn', turnAnchor: 'carrier', turnTiming: 'end' },
    ]) {
      const hero = heroWith(duration);
      const effects = hero.activeEffects;

      assert.deepEqual(
        system.expireTimedEffects(hero, NOW, IN_COMBAT_CONTEXT),
        { changed: false, chatSummary: null },
      );

      assert.equal(hero.activeEffects, effects);
    }
  });

  it('«до конца хода» вне боя кончается через раунд, с пропуском хода — через два', () => {
    const system = new engine.Dnd5eVttSystem();

    for (const [turnSkipFirst, seconds] of [
      [false, ROUND],
      [true, 2 * ROUND],
    ]) {
      const hero = heroWith({ ...CARRIER_TURN_END, turnSkipFirst });

      system.expireTimedEffects(hero, NOW, OUT_OF_COMBAT_CONTEXT);
      assert.equal(hero.activeEffects[0].duration.expiresAt, NOW + seconds);

      system.expireTimedEffects(hero, NOW + seconds, OUT_OF_COMBAT_CONTEXT);
      assert.equal(hero.activeEffects.length, 0);
    }
  });

  it('переключатель «до хода» часы не ведут: его выключает граница хода', () => {
    const system = new engine.Dnd5eVttSystem();

    const hero = withHp(createActor, 30, {
      activeEffects: [
        createEffect('Ярость', {
          duration: CARRIER_TURN_END,
          activation: { mode: 'toggle' },
        }),
      ],
    });

    assert.equal(
      system.expireTimedEffects(hero, NOW, OUT_OF_COMBAT_CONTEXT).changed,
      false,
    );
  });

  it('в бою момент окончания с часов снимается, после боя срок идёт заново', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = heroWith(CARRIER_TURN_END);

    system.expireTimedEffects(hero, NOW, OUT_OF_COMBAT_CONTEXT);

    // Бой начался: эффект ждёт конца хода носителя, часы его не снимают
    system.expireTimedEffects(hero, NOW + ROUND, IN_COMBAT_CONTEXT);
    assert.equal(hero.activeEffects.length, 1);
    assert.equal(hero.activeEffects[0].duration.expiresAt, undefined);

    assert.equal(
      system.expireTimedEffects(hero, NOW + 2 * ROUND, IN_COMBAT_CONTEXT)
        .changed,
      false,
      'без работы сущность не пишется',
    );

    // Бой кончился, так и не дойдя до хода: раунд по часам с этого момента
    const combatEnd = NOW + 10 * ROUND;

    system.expireTimedEffects(hero, combatEnd, OUT_OF_COMBAT_CONTEXT);
    assert.equal(hero.activeEffects[0].duration.expiresAt, combatEnd + ROUND);
  });

  describe('вялость «Ускорения»', () => {
    /**
     * Заклинатель с «Ускорением» на себе и меткой концентрации.
     *
     * @param {number} hasteSeconds - через сколько истекает эффект, секунды
     * @returns {object} заклинатель
     */
    function hastedHero(hasteSeconds) {
      return withHp(createActor, 30, {
        activeEffects: [
          engine.buildConcentrationEffect({
            spell: HASTE,
            casterId: HASTE_CASTER_ID,
            castId: HASTE_CAST_ID,
          }),
          createEffect('Ускорение', {
            origin: 'spell',
            castId: HASTE_CAST_ID,
            sourceActorId: HASTE_CASTER_ID,
            duration: { type: 'minutes', value: 1, expiresAt: hasteSeconds },
            triggers: [HASTE_LETHARGY_TRIGGER],
          }),
        ],
      });
    }

    /**
     * Отказ повторному касту «Ускорения».
     *
     * @param {object} hero - заклинатель
     * @returns {string | null} причина отказа
     */
    function hasteCastBlock(hero) {
      return engine.resolveSpellCastBlock(hero, HASTE);
    }

    it('метка и эффект истекают одним проходом — вялость ложится, через раунд уходит', () => {
      const system = new engine.Dnd5eVttSystem();
      const hero = hastedHero(NOW + 60);
      const { context, ended } = castEndingContext(OUT_OF_COMBAT_CONTEXT);

      // Метка концентрации получает срок; эффект его уже несёт
      system.expireTimedEffects(hero, NOW, context);
      system.expireTimedEffects(hero, NOW + 60, context);

      assert.deepEqual(ended, [[HASTE_CASTER_ID, [HASTE_CAST_ID]]]);

      assert.deepEqual(
        hero.activeEffects.map((effect) => effect.conditionKey),
        ['incapacitated'],
      );

      assert.equal(hasteCastBlock(hero), 'Действие недоступно: Недееспособный');

      // Срок вялости поставлен тем же проходом
      assert.equal(hero.activeEffects[0].duration.expiresAt, NOW + 60 + ROUND);

      system.expireTimedEffects(hero, NOW + 60 + ROUND, context);
      assert.equal(hero.activeEffects.length, 0);
      assert.equal(hasteCastBlock(hero), null);
    });

    it('эффект истёк раньше метки — вялость всё равно ложится', () => {
      const system = new engine.Dnd5eVttSystem();
      const hero = hastedHero(NOW + 30);
      const { context } = castEndingContext(OUT_OF_COMBAT_CONTEXT);

      system.expireTimedEffects(hero, NOW, context);
      system.expireTimedEffects(hero, NOW + 30, context);

      assert.ok(
        hero.activeEffects.some(
          (effect) => effect.conditionKey === 'incapacitated',
        ),
      );
    });

    it('в бою вялость держится до конца хода носителя', () => {
      const system = new engine.Dnd5eVttSystem();
      const hero = hastedHero(NOW + 60);
      const { context } = castEndingContext(IN_COMBAT_CONTEXT);

      system.expireTimedEffects(hero, NOW, context);
      system.expireTimedEffects(hero, NOW + 60, context);

      const [lethargy] = hero.activeEffects;

      assert.equal(lethargy.conditionKey, 'incapacitated');
      assert.equal(lethargy.duration.expiresAt, undefined);

      // Раунд боя сдвинул часы — вялость ждёт хода, а не часов
      system.expireTimedEffects(hero, NOW + 60 + 3 * ROUND, context);
      assert.equal(hero.activeEffects.length, 1);

      const participants = new Set([HASTE_CASTER_ID]);

      system.expireTurnEffects(hero, 'creature_other', 'end', participants);
      assert.equal(hero.activeEffects.length, 1, 'чужой ход не снимает');

      system.expireTurnEffects(hero, HASTE_CASTER_ID, 'end', participants);
      assert.equal(hero.activeEffects.length, 0);
    });
  });

  it('новый раунд не снимает эффект со сроком по часам — только уменьшает остаток', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = heroWith({ type: 'rounds', value: 1, remaining: 1 });

    system.expireTimedEffects(hero, NOW, {});
    system.decrementEffectDurations(hero, {});

    assert.equal(hero.activeEffects.length, 1);
    assert.equal(hero.activeEffects[0].duration.remaining, 1);

    // Снимают часы: новый раунд сдвинул их на 6 секунд
    system.expireTimedEffects(hero, NOW + ROUND, {});
    assert.equal(hero.activeEffects.length, 0);
  });

  it('эффект без срока по часам раунд снимает как раньше', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = heroWith({ type: 'rounds', value: 1, remaining: 1 });

    system.decrementEffectDurations(hero, {});
    assert.equal(hero.activeEffects.length, 0);
  });

  it('копии эффекта не делят момент окончания с оригиналом', () => {
    const system = new engine.Dnd5eVttSystem();
    const duration = { type: 'minutes', value: 1, remaining: 10 };
    const hero = heroWith(duration);
    const copy = heroWith(duration);

    system.expireTimedEffects(hero, NOW, {});

    assert.equal(duration.expiresAt, undefined);
    assert.equal(copy.activeEffects[0].duration.expiresAt, undefined);
  });

  it('остаток по часам: секунды, минуты, часы, дни; у раундов — и раунды', () => {
    assert.equal(engine.formatGameTimeLeft(45), '45 с');
    assert.equal(engine.formatGameTimeLeft(580), '9:40');
    assert.equal(engine.formatGameTimeLeft(2 * 3600 + 5 * 60), '2 ч 05 мин');
    assert.equal(engine.formatGameTimeLeft(3 * 86_400 + 4 * 3600), '3 дн. 4 ч');

    assert.equal(
      engine.describeEffectTimeLeft(
        { type: 'rounds', value: 2, expiresAt: NOW + 12 },
        NOW,
      ),
      '12 с (2 раунда)',
    );

    assert.equal(
      engine.describeEffectTimeLeft(
        { type: 'minutes', value: 10, expiresAt: NOW + 580 },
        null,
      ),
      null,
    );
  });

  it('карточка эффекта показывает остаток по часам вместо раундов', () => {
    const effect = createEffect('Щит веры', {
      duration: {
        type: 'minutes',
        value: 10,
        remaining: 100,
        expiresAt: NOW + 580,
      },
    });

    const lines = engine
      .buildActiveEffectDetails(effect, NOW)
      .flatMap((section) => section.lines);

    assert.ok(lines.includes('Осталось 9:40'));
    assert.ok(!lines.some((line) => line.includes('раундов')));

    const withoutClock = engine
      .buildActiveEffectDetails(effect)
      .flatMap((section) => section.lines);

    assert.ok(withoutClock.includes('Осталось 100 раундов'));
  });

  it('истёкшая по часам концентрация заканчивает каст', () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = concentratingCaster(40);
    const { context, ended } = castEndingContext();

    // «Благословение» — концентрация на минуту
    system.expireTimedEffects(caster, NOW, context);
    assert.deepEqual(ended, []);

    system.expireTimedEffects(caster, NOW + 60, context);
    assert.deepEqual(ended, [[CLERIC_ID, [BLESS_CAST_ID]]]);
  });
});
