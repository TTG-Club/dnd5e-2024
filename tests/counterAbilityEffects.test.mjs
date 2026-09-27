import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const { resolveCounterMax } = await loadEngineBundle(`
export { resolveCounterMax } from './src/engine/counterResource.ts';
`);

/**
 * Бард 1 уровня с Харизмой 14 и повышением +2 от предыстории. Повышение живёт
 * эффектом `ability.charisma`, а не в самом значении характеристики.
 * @param {string} maxFormula - Формула максимума вдохновения.
 * @returns {{ actor: object, counter: object }} Лист и его счётчик.
 */
function createBardWithBackgroundBoost(maxFormula) {
  const actor = {
    id: 'actor-bard',
    type: 'character',
    name: 'Бард',
    activeEffects: [
      {
        id: 'effect-background',
        name: 'Предыстория: Артист',
        disabled: false,
        origin: 'feature',
        originId: 'background:entertainer',
        transfer: false,
        duration: { type: 'permanent' },
        changes: [
          { key: 'ability.charisma', mode: 'add', value: '2', priority: 10 },
        ],
        flags: [],
      },
    ],
    system: {
      abilities: {
        strength: 10,
        dexterity: 14,
        constitution: 12,
        intelligence: 12,
        wisdom: 10,
        charisma: 14,
      },
      classes: [
        {
          key: 'bard',
          name: 'Бард',
          level: 1,
          spellcastingAbility: 'charisma',
        },
      ],
      classCounters: [],
      features: [],
      equipment: [],
      proficiencies: { skills: [] },
    },
  };

  const counter = {
    key: 'bardic-inspiration',
    name: 'Бардовское вдохновение',
    max: 2,
    current: 2,
    min: 1,
    maxFormula,
    classKey: 'bard',
  };

  return { actor, counter };
}

it('максимум ресурса по Харизме учитывает повышение от предыстории', () => {
  const { actor, counter } = createBardWithBackgroundBoost('@mod.cha');

  assert.equal(resolveCounterMax(actor, counter), 3);
});

it('`@mod.spell` тоже берёт заклинательную характеристику с эффектами', () => {
  const { actor, counter } = createBardWithBackgroundBoost('@mod.spell');

  assert.equal(resolveCounterMax(actor, counter), 3);
});

it('`@prof` берёт бонус мастерства с эффектами, как плитка листа', () => {
  const { actor, counter } = createBardWithBackgroundBoost('@prof');

  const boostedActor = {
    ...actor,
    activeEffects: [
      ...actor.activeEffects,
      {
        id: 'effect-proficiency',
        name: 'Бонус мастерства +1',
        disabled: false,
        origin: 'feature',
        transfer: false,
        duration: { type: 'permanent' },
        changes: [
          { key: 'proficiencyBonus', mode: 'add', value: '1', priority: 10 },
        ],
        flags: [],
      },
    ],
  };

  assert.equal(resolveCounterMax(boostedActor, counter), 3);
});
