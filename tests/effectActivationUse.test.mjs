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
    useSystemToastStore: () => ({
      add: (toast) => steps.push(['toast', toast.title]),
    }),
    useChatStore: () => ({ sendMessage: (text) => steps.push(['chat', text]) }),
    applyCasterSpellEffectsToEntity: (spell) =>
      steps.push(['self', engine.getCasterSpellEffects(spell).length]),
    applySpellTargetEffects: (spell, source) =>
      steps.push(['target', source.casterId, source.spellSaveDC]),
    EFFECT_USE_LABELS: {
      noTargetTitle: 'no-target',
      noTargetText: '',
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

  assert.deepEqual(steps, [['spend'], ['self', 1]]);
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

  assert.deepEqual(steps, [['spend'], ['self', 0], ['target', 'hero', 15]]);
});

it('кнопка панели применяет предмет владельца и тратит его до нуля', async () => {
  const steps = [];

  const potion = {
    id: 'potion',
    name: 'Potion',
    type: 'equipment',
    consumable: true,
    quantity: 1,
    activeEffects: [usableEffect('Heal')],
  };

  const owner = { id: 'hero', name: 'Hero', equipment: [potion] };

  const useItem = await loadHandler(helperPath, 'applyEntityItemUse', {
    useWorldEntities: () => ({
      findCurrentDndEntity: (entityId) =>
        entityId === owner.id ? owner : undefined,
    }),
    canUseItem: engine.canUseItem,
    buildItemUseSpell: engine.buildItemUseSpell,
    spendItemUse: engine.spendItemUse,
    resolveActorStats: () => ({ spellSaveDC: 14 }),
    listAmbientEffects: () => [],
    applyEffectSource: (spell, user, saveDc, spend) => {
      steps.push(['apply', spell.name, user.id, saveDc]);
      spend();
    },
    updateEntityEquipment: (entityId, change) =>
      steps.push(['equipment', entityId, [...change(owner.equipment)]]),
  });

  useItem('hero', 'potion');

  assert.deepEqual(steps, [
    ['apply', 'Potion', 'hero', 14],
    ['equipment', 'hero', [{ ...potion, quantity: 0 }]],
  ]);

  owner.equipment = [{ ...potion, quantity: 0 }];
  useItem('hero', 'potion');
  useItem('hero', 'missing');
  useItem('ghost', 'potion');

  assert.equal(steps.length, 2, 'закончившийся и чужой предмет не применяются');
});

it('кнопка панели гаснет с причиной и показывает остаток', async () => {
  const hints = { depleted: 'закончились', missing: 'нет' };

  const toHotbarSlotState = await loadHandler(
    'src/client/macros/hotbarSlotState.ts',
    'toHotbarSlotState',
    { ITEM_ACTION_BLOCK_HINTS: hints },
  );

  assert.deepEqual(
    { ...toHotbarSlotState({ blocked: 'depleted', remaining: 0 }) },
    { disabled: true, badge: '0', hint: 'закончились' },
  );

  assert.deepEqual(
    { ...toHotbarSlotState({ remaining: 3 }) },
    {
      disabled: false,
      badge: '3',
    },
  );

  assert.deepEqual({ ...toHotbarSlotState({}) }, { disabled: false });

  const resolveItemUseSlot = await loadHandler(
    'src/client/macros/dnd5eMacros.ts',
    'resolveItemUseSlot',
    {
      useWorldEntities: () => ({
        findCurrentDndEntity: () => ({
          equipment: [
            {
              id: 'potion',
              consumable: true,
              quantity: 2,
              activeEffects: [usableEffect('Heal')],
            },
          ],
        }),
      }),
      describeItemUseAvailability: engine.describeItemUseAvailability,
      toHotbarSlotState,
    },
  );

  assert.deepEqual(
    { ...resolveItemUseSlot({ ref: 'potion', actorId: 'hero' }) },
    { disabled: false, badge: '2' },
  );

  assert.deepEqual(
    { ...resolveItemUseSlot({ ref: 'gone', actorId: 'hero' }) },
    { disabled: true, hint: 'нет' },
  );
});

it('в список наложенного не входят эффекты, которые сразу снимают себя', async () => {
  const sent = [];

  const postSpellEffectsMessage = await loadHandler(
    'src/client/composables/spellResolutionShared.ts',
    'postSpellEffectsMessage',
    {
      removesItselfOnApply: (effect) => effect.name === 'Heal',
      formatSpellEffectsMessage: (source, names, effects) =>
        `${source}: ${effects.map((effect) => effect.name).join(', ')}`,
      useChatStore: () => ({ sendMessage: (text) => sent.push(text) }),
    },
  );

  postSpellEffectsMessage('Potion', ['Hero'], [usableEffect('Heal')]);

  postSpellEffectsMessage(
    'Dust',
    ['Hero'],
    [usableEffect('Heal'), usableEffect('Invisible')],
  );

  assert.deepEqual(sent, ['Dust: Invisible']);
});
