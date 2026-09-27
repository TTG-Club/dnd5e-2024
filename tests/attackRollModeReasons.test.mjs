import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/** Контекст броска без условий — эффекты «только в бросках» не срабатывают. */
const rollContext = { hasAdvantage: false, hasDisadvantage: false };

/** Эффект с флагами и именем — как состояние мира. */
function effectWithFlags(name, flags) {
  return { id: name, name, changes: [], flags };
}

/** Причины при заданных эффектах атакующего и цели. */
function explain({
  attackerEffects = [],
  attackerFlags = [],
  targetEffects = [],
  targetFlags = [],
  isBeyondNormalRange = false,
  attackType = 'melee',
}) {
  return engine.explainAttackRollMode({
    attackType,
    attackerFlags: new Set(attackerFlags),
    attackerEffects,
    rollContext,
    targetFlags: new Set(targetFlags),
    targetEffects,
    isBeyondNormalRange,
  });
}

it('помеха от состояния называется именем состояния', () => {
  const poisoned = effectWithFlags('Отравлен', ['attack.disadvantage']);

  const reasons = explain({
    attackerEffects: [poisoned],
    attackerFlags: ['attack.disadvantage'],
  });

  assert.deepEqual(reasons.disadvantage, ['Отравлен']);
  assert.deepEqual(reasons.advantage, []);
});

it('общая помеха без эффекта — это доспех без владения', () => {
  const reasons = explain({ attackerFlags: ['attack.disadvantage'] });

  assert.deepEqual(reasons.disadvantage, ['доспех без владения']);
});

it('дальность и эффект цели попадают в причины', () => {
  const dodge = effectWithFlags('Уклонение', ['attacksAgainst.disadvantage']);

  const reasons = explain({
    attackType: 'ranged',
    targetEffects: [dodge],
    targetFlags: ['attacksAgainst.disadvantage'],
    isBeyondNormalRange: true,
  });

  assert.deepEqual(reasons.disadvantage, [
    'дальше нормальной дистанции',
    'Уклонение (у цели)',
  ]);
});

it('профильный флаг другого вида атаки причиной не считается', () => {
  const prone = effectWithFlags('Лежит ничком', [
    'attacksAgainst.melee.advantage',
    'attacksAgainst.ranged.disadvantage',
  ]);

  const reasons = explain({
    attackType: 'melee',
    targetEffects: [prone],
    targetFlags: [
      'attacksAgainst.melee.advantage',
      'attacksAgainst.ranged.disadvantage',
    ],
  });

  assert.deepEqual(reasons.advantage, ['Лежит ничком (у цели)']);
  assert.deepEqual(reasons.disadvantage, []);
});

it('объяснение пишет обе стороны и что они гасятся', () => {
  const lines = engine.formatAttackRollModeReasons({
    advantage: ['Безрассудная атака'],
    disadvantage: ['Отравлен', 'доспех без владения'],
  });

  assert.deepEqual(lines, [
    'Преимущество: Безрассудная атака',
    'Помеха: Отравлен, доспех без владения',
    'Преимущество и помеха гасят друг друга — бросок обычный',
  ]);
});

it('режим и причины читают один список флагов', () => {
  const mode = engine.resolveAttackRollMode({
    attackerFlags: new Set(['attack.spell.disadvantage']),
    attackType: 'melee',
  });

  assert.equal(mode, 'normal');
});
