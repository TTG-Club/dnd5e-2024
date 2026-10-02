import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { it } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import { createActor, createEffect, engine } from './scenarios/_fixtures.mjs';

const helperPath = 'src/client/composables/actionSpend.ts';

/** «Психическая плеть Таши»: провоцированных атак нет */
const LASHED = createEffect('Психическая плеть Таши', {
  flags: ['actions.noOpportunityAttack'],
});

/**
 * Настоящий выбор цены удара оружием с журналом предупреждений.
 *
 * @param {boolean} isOwnTurn - идёт ли ход бьющего
 * @returns {Promise<object>} обработчик и журналы
 */
async function loadWeaponAttack(isOwnTurn) {
  const toasts = [];
  const order = [];
  const hero = createActor({ activeEffects: [LASHED] });

  const ports = {
    planWeaponAttack: engine.planWeaponAttack,
    resolveOpportunityAttackWarning: engine.resolveOpportunityAttackWarning,
    isEntityOwnTurn: () => isOwnTurn,
    listAmbientEffects: () => [],
    useWorldEntities: () => ({ findCurrentDndEntity: () => hero }),
    useSystemToastStore: () => ({
      add: (toast) => {
        order.push('toast');
        toasts.push(toast);
      },
    }),
    OPPORTUNITY_ATTACK_WARNING_LABELS: { title: 'вне хода', suffix: '.' },
  };

  ports.warnOpportunityAttack = await loadHandler(
    helperPath,
    'warnOpportunityAttack',
    ports,
  );

  const run = await loadHandler(helperPath, 'runWithWeaponAttackCost', ports);

  return { run, hero, toasts, order };
}

it('удар вне своего хода предупреждает до окна броска', async () => {
  const { run, hero, toasts, order } = await loadWeaponAttack(false);
  const costs = [];

  run(
    hero,
    'Меч',
    () => assert.fail('удар не запрещён'),
    (cost) => {
      order.push('window');
      costs.push(cost);
    },
  );

  assert.deepEqual(costs, ['reaction'], 'вне своего хода удар — реакция');
  assert.deepEqual(order, ['toast', 'window'], 'сначала предупреждение');

  assert.equal(
    toasts[0].description,
    'Провоцированные атаки недоступны: Психическая плеть Таши.',
  );
});

it('в свой ход предупреждения нет', async () => {
  const { run, hero, toasts } = await loadWeaponAttack(true);

  run(
    hero,
    'Меч',
    () => {},
    () => {},
  );

  assert.equal(toasts.length, 0);
});

it('лист и горячая панель второй раз после броска не предупреждают', async () => {
  // Лист и горячая панель бьют общим путём удара
  for (const path of [
    'src/client/composables/weaponAttackRoll.ts',
    'src/client/ui/actor/tabs/ActorEquipmentTab.vue',
    'src/client/macros/dnd5eMacros.ts',
  ]) {
    const source = await readFile(join(systemRoot, path), 'utf8');

    assert.doesNotMatch(
      source,
      /recordEntityActionSpend\([^)]*attackCost, true\);\s*warnOpportunityAttack/u,
      path,
    );
  }
});
