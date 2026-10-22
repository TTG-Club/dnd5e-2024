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

  it('бессрочный эффект и «до конца хода» часы не трогают', () => {
    const system = new engine.Dnd5eVttSystem();

    for (const duration of [
      { type: 'permanent' },
      { type: 'special' },
      { type: 'turn', turnAnchor: 'carrier', turnTiming: 'end' },
    ]) {
      const hero = heroWith(duration);
      const effects = hero.activeEffects;

      assert.deepEqual(system.expireTimedEffects(hero, NOW, {}), {
        changed: false,
        chatSummary: null,
      });

      assert.equal(hero.activeEffects, effects);
    }
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
