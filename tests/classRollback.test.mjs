import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const { diffProficiencyHoldings, rollbackClassProficiencies } =
  await loadEngineBundle(`
    export {
      diffProficiencyHoldings,
      rollbackClassProficiencies,
    } from './src/client/ui/actor/class/classRollback.ts';
  `);

/**
 * Владения источника с пустыми списками по умолчанию.
 * @param {Record<string, string[]>} holdings - Заполненные списки.
 * @returns {Record<string, string[]>} Полный набор списков.
 */
function holdingsOf(holdings) {
  return {
    armor: [],
    weapons: [],
    tools: [],
    savingThrows: [],
    skills: [],
    ...holdings,
  };
}

/** Воин с предысторией «Солдат»: навыки и инструмент предыстории — не класса. */
const fighterSheet = {
  armor: ['leather', 'chain-mail', 'shield'],
  weapons: ['longsword', 'dagger'],
  weaponMasteries: ['longsword'],
  tools: ['gaming-set'],
  languages: ['common'],
  savingThrows: ['strength', 'constitution'],
  skills: {
    athletics: 'proficient',
    intimidation: 'proficient',
    perception: 'expertise',
    survival: 'proficient',
  },
};

const fighterHoldings = holdingsOf({
  armor: ['leather', 'chain-mail', 'shield'],
  weapons: ['longsword', 'dagger'],
  savingThrows: ['strength', 'constitution'],
  skills: ['perception', 'survival'],
});

const soldierHoldings = holdingsOf({
  tools: ['gaming-set'],
  skills: ['athletics', 'intimidation'],
});

it('удаление последнего класса оставляет владения предыстории и вида', () => {
  const result = rollbackClassProficiencies(
    fighterSheet,
    fighterHoldings,
    [],
    [soldierHoldings, holdingsOf({ weapons: ['dagger'] })],
  );

  assert.deepEqual(result.skills, {
    athletics: 'proficient',
    intimidation: 'proficient',
  });

  assert.deepEqual(result.tools, ['gaming-set']);
  assert.deepEqual(result.weapons, ['dagger']);
  assert.deepEqual(result.armor, []);
  assert.deepEqual(result.savingThrows, []);
  assert.deepEqual(result.languages, ['common']);
  assert.deepEqual(result.weaponMasteries, ['longsword']);
});

it('навык класса остаётся, если им владеет и другой источник', () => {
  const result = rollbackClassProficiencies(
    fighterSheet,
    fighterHoldings,
    [],
    [holdingsOf({ skills: ['perception'] })],
  );

  assert.deepEqual(result.skills, {
    athletics: 'proficient',
    intimidation: 'proficient',
    perception: 'expertise',
  });
});

it('оставшийся класс становится основным и получает свои владения', () => {
  const result = rollbackClassProficiencies(
    fighterSheet,
    fighterHoldings,
    [
      holdingsOf({
        weapons: ['dagger', 'quarterstaff'],
        savingThrows: ['intelligence', 'wisdom'],
        skills: ['survival'],
      }),
    ],
    [soldierHoldings],
  );

  assert.deepEqual(result.weapons, ['dagger', 'quarterstaff']);
  assert.deepEqual(result.savingThrows, ['intelligence', 'wisdom']);
  assert.deepEqual(result.armor, []);

  assert.deepEqual(result.skills, {
    athletics: 'proficient',
    intimidation: 'proficient',
    survival: 'proficient',
  });
});

it('исходные владения откатом не меняются', () => {
  const snapshot = JSON.stringify(fighterSheet);

  rollbackClassProficiencies(fighterSheet, fighterHoldings, [], []);

  assert.equal(JSON.stringify(fighterSheet), snapshot);
});

it('владения источника — то, что ушло бы с его откатом', () => {
  const holdings = diffProficiencyHoldings(fighterSheet, {
    ...fighterSheet,
    tools: [],
    skills: { perception: 'expertise', survival: 'proficient' },
  });

  assert.deepEqual(holdings, soldierHoldings);
});
