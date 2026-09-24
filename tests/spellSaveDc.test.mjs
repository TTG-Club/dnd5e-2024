import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  change,
  createActor,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Сл спасброска конкретного заклинания: своя Сл заклинания, характеристика
 * заклинания и настройка листа.
 */

/** Мудрость 16 (+3), Харизма 14 (+2), Интеллект 10 */
const ABILITIES = {
  ...engine.DEFAULT_ACTOR.system.abilities,
  wisdom: 16,
  charisma: 14,
  intelligence: 10,
};

/** Своя Сл листа в «Настроить заклинательство» */
const SHEET_BASE_SETTINGS = {
  saveDC: { base: 15, bonuses: [] },
  attack: { base: null, bonuses: [] },
};

/**
 * Заклинатель с характеристиками {@link ABILITIES} и полями системы.
 *
 * @param {object} system - поля системы поверх умолчания
 * @param {object[]} activeEffects - эффекты персонажа
 * @returns {object} персонаж
 */
function createCaster(system = {}, activeEffects = []) {
  return createActor({
    activeEffects,
    system: {
      ...structuredClone(engine.DEFAULT_ACTOR.system),
      abilities: ABILITIES,
      ...system,
    },
  });
}

/**
 * Сл заклинания у персонажа.
 *
 * @param {object} actor - персонаж
 * @param {object} spell - поля заклинания, от которых зависит Сл
 * @returns {number} Сл
 */
function spellDc(actor, spell = {}) {
  return engine.resolveSpellSaveDC(
    actor,
    spell,
    engine.resolveActorStats(actor),
  );
}

describe('сл спасброска заклинания', () => {
  it('без класса и настроек Сл нет', () => {
    assert.equal(spellDc(createCaster()), 0);
  });

  it('своя Сл листа доходит до заклинания', () => {
    assert.equal(
      spellDc(createCaster({ spellcastingSettings: SHEET_BASE_SETTINGS })),
      15,
    );
  });

  it('характеристика листа без класса: 8 + мастерство + модификатор', () => {
    assert.equal(spellDc(createCaster({ spellcastingAbility: 'wisdom' })), 13);
  });

  it('у листа без заклинательства характеристика заклинания даёт полную Сл, а не разницу модификаторов', () => {
    assert.equal(
      spellDc(createCaster(), { spellcastingAbility: 'charisma' }),
      12,
    );
  });

  it('класс по Мудрости, заклинание по Харизме — меняется модификатор', () => {
    const actor = createCaster({
      classes: [
        { classKey: 'cleric', level: 1, spellcastingAbility: 'wisdom' },
      ],
    });

    assert.equal(spellDc(actor), 13);
    assert.equal(spellDc(actor, { attackAbility: 'charisma' }), 12);
  });

  it('своё число листа — это число: от характеристики заклинания не меняется', () => {
    const actor = createCaster({
      classes: [
        { classKey: 'cleric', level: 1, spellcastingAbility: 'wisdom' },
      ],
      spellcastingSettings: SHEET_BASE_SETTINGS,
    });

    assert.equal(spellDc(actor, { spellcastingAbility: 'charisma' }), 15);
  });

  it('прибавка эффектов к Сл листа достаётся и заклинанию со своей характеристикой', () => {
    const rod = createEffect('rod', {
      name: 'Жезл договора',
      changes: [change('spellSaveDC', '1')],
    });

    const actor = createCaster(
      {
        classes: [
          { classKey: 'warlock', level: 1, spellcastingAbility: 'charisma' },
        ],
      },
      [rod],
    );

    assert.equal(spellDc(actor), 13);
    assert.equal(spellDc(actor, { attackAbility: 'wisdom' }), 14);
  });

  it('своя Сл заклинания главнее персонажа', () => {
    const actor = createCaster({
      classes: [
        { classKey: 'cleric', level: 5, spellcastingAbility: 'wisdom' },
      ],
    });

    assert.equal(spellDc(actor, { saveDC: 15, attackAbility: 'charisma' }), 15);
    assert.equal(spellDc(createCaster(), { saveDC: 15 }), 15);
  });

  it('своя Сл — только целое число от 1', () => {
    assert.equal(engine.readSpellOwnSaveDC({ saveDC: 14.6 }), 15);
    assert.equal(engine.readSpellOwnSaveDC({ saveDC: 0 }), undefined);
    assert.equal(engine.readSpellOwnSaveDC({ saveDC: Number.NaN }), undefined);
    assert.equal(engine.readSpellOwnSaveDC({}), undefined);
  });
});
