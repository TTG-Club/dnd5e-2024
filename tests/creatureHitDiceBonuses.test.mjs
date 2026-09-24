import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(
  `export * from './src/engine/creatureHitDice.ts';`,
);

/** Существо: Среднее (к8), Тел. 14 (+2), Мдр 16 (+3), бонус мастерства +2. */
function creature(hitPoints, overrides = {}) {
  return {
    id: 'creature-1',
    name: 'Отшельник',
    system: {
      size: 'medium',
      abilities: {
        strength: 10,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 16,
        charisma: 10,
      },
      proficiencyBonus: 2,
      hitPoints,
      ...overrides,
    },
  };
}

/** Свой бонус в форме строки окна. */
function bonus(kind, value = 0, ability = 'strength') {
  return { id: `bonus-${kind}-${ability}`, kind, ability, value, label: '' };
}

it('без своих бонусов формула считается только от Телосложения', () => {
  const result = engine.resolveCreatureHitPointsByRules(
    creature({ formula: '4к8', average: 18, hitDiceCount: 4 }),
  );

  assert.equal(result.bonus, 8);
  assert.equal(result.formula, '4к8 + 8');
  assert.equal(result.average, 26);
});

it('свои бонусы прибавляются к формуле один раз, а не за каждую кость', () => {
  const result = engine.resolveCreatureHitPointsByRules(
    creature({
      formula: '4к8 + 8',
      average: 26,
      hitDiceCount: 4,
      bonuses: [
        bonus('flat', 5),
        bonus('ability', 0, 'wisdom'),
        bonus('proficiency'),
      ],
    }),
  );

  // 4 × Тел(+2) + 5 + Мдр(+3) + мастерство(+2)
  assert.equal(result.bonus, 18);
  assert.equal(result.formula, '4к8 + 18');
  assert.equal(result.average, 36);
});

it('пересчёт по правилам не теряет свои бонусы при смене размера', () => {
  const bonuses = [bonus('flat', 3)];

  const result = engine.resolveCreatureHitPointsByRules(
    creature(
      { formula: '2к8 + 7', average: 16, hitDiceCount: 2, bonuses },
      { size: 'large' },
    ),
  );

  assert.deepEqual(result.bonuses, bonuses);
  assert.equal(result.formula, '2к10 + 7');
});

it('испорченная строка из записи мира выпадает, а не роняет расчёт', () => {
  const result = engine.resolveCreatureHitPointsByRules(
    creature({
      formula: '1к8',
      average: 4,
      hitDiceCount: 1,
      bonuses: [bonus('flat', 1), { kind: 'flat', value: 'много' }, null],
    }),
  );

  assert.equal(result.bonus, 3);
});

it('модификатор характеристики для бонусов учитывает свои бонусы к ней', () => {
  const context = engine.getCreatureHitDiceBonusContext(
    creature(
      { formula: '1к8', average: 4 },
      { abilityBonuses: { wisdom: [bonus('flat', 2)] } },
    ),
  );

  assert.equal(context.abilityMods.wisdom, 4);
  assert.equal(context.abilityMods.constitution, 2);
  assert.equal(context.proficiencyBonus, 2);
});

it('своё число основы заменяет Телосложение, свои бонусы идут сверху', () => {
  const result = engine.resolveCreatureHitPointsByRules(
    creature({
      formula: '4к8 + 8',
      average: 26,
      hitDiceCount: 4,
      baseBonus: 20,
      bonuses: [bonus('flat', 2)],
    }),
  );

  assert.equal(result.bonus, 22);
  assert.equal(result.formula, '4к8 + 22');
});

it('без своего числа основа снова идёт за Телосложением', () => {
  const result = engine.resolveCreatureHitPointsByRules(
    creature({
      formula: '4к8 + 20',
      average: 38,
      hitDiceCount: 4,
      baseBonus: null,
    }),
  );

  assert.equal(result.bonus, 8);
});

it('своё число основы из мира приводится к целому в пределах поля', () => {
  assert.equal(engine.parseCreatureHitPointsBaseBonus(3.6), 4);
  assert.equal(engine.parseCreatureHitPointsBaseBonus(99999), 9999);
  assert.equal(engine.parseCreatureHitPointsBaseBonus(Number.NaN), null);
  assert.equal(engine.parseCreatureHitPointsBaseBonus('5'), null);
});
