import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/effectActivation.ts'; export * from './src/engine/spellUtils.ts';",
);

const helperPath = 'src/client/composables/effectActivationUse.ts';

/**
 * Эффект применения.
 *
 * @param {string} name - имя
 * @param {object} overrides - доставка и прочее
 * @returns {object} эффект
 */
function usableEffect(name, overrides = {}) {
  return {
    id: name,
    name,
    disabled: false,
    activation: { mode: 'use' },
    changes: [],
    flags: [],
    duration: { type: 'permanent' },
    ...overrides,
  };
}

/**
 * Настоящий хелпер применения с записью шагов.
 *
 * @param {object} options - есть ли цель
 * @param {boolean} options.hasTarget - выбрана ли цель
 * @returns {Promise<object>} хелпер и журнал
 */
async function loadApply({ hasTarget }) {
  const steps = [];

  const apply = await loadHandler(helperPath, 'applyEffectSource', {
    getTargetSpellEffects: engine.getTargetSpellEffects,
    useTargetStore: () => ({
      getTargetActor: () => (hasTarget ? { id: 'goblin' } : null),
    }),
    useToast: () => ({ add: (toast) => steps.push(['toast', toast.title]) }),
    useChatStore: () => ({ sendMessage: (text) => steps.push(['chat', text]) }),
    applyCasterSpellEffectsToEntity: (spell) =>
      steps.push(['self', engine.getCasterSpellEffects(spell).length]),
    applySpellTargetEffects: (spell, source) =>
      steps.push(['target', source.casterId, source.spellSaveDC]),
    EFFECT_USE_LABELS: {
      noTargetTitle: 'no-target',
      noTargetText: '',
      chatUses: ' uses ',
    },
  });

  return { apply, steps };
}

const hero = { id: 'hero', name: 'Hero' };

it('зелье на себя: сначала расход, потом наложение', async () => {
  const { apply, steps } = await loadApply({ hasTarget: false });

  const potion = engine.buildItemUseSpell({
    id: 'potion',
    name: 'Potion',
    activeEffects: [usableEffect('Heal')],
  });

  apply(potion, hero, 13, () => steps.push(['spend']));

  assert.deepEqual(steps, [
    ['spend'],
    ['chat', 'Hero uses «Potion»'],
    ['self', 1],
  ]);
});

it('эффект на цель без цели не тратит источник', async () => {
  const { apply, steps } = await loadApply({ hasTarget: false });

  const poison = engine.buildItemUseSpell({
    id: 'poison',
    name: 'Poison',
    activeEffects: [usableEffect('Poisoned', { effectTarget: 'target' })],
  });

  apply(poison, hero, 13, () => steps.push(['spend']));

  assert.deepEqual(steps, [['toast', 'no-target']]);
});

it('эффект на цель уходит разбору цели с Сл применившего', async () => {
  const { apply, steps } = await loadApply({ hasTarget: true });

  const poison = engine.buildItemUseSpell({
    id: 'poison',
    name: 'Poison',
    activeEffects: [usableEffect('Poisoned', { effectTarget: 'target' })],
  });

  apply(poison, hero, 15, () => steps.push(['spend']));

  assert.deepEqual(steps, [
    ['spend'],
    ['chat', 'Hero uses «Poison»'],
    ['self', 0],
    ['target', 'hero', 15],
  ]);
});
