import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/effectActivation.ts'; export * from './src/engine/spellUtils.ts';",
);

const helperPath = 'src/client/composables/effectActivationUse.ts';
const chooserPath = 'src/client/composables/effectUseTargetChoice.ts';

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
 * @param {object} options - кого выберут получателем
 * @param {string | null} options.chosenTargetId - выбранный; `null` — плашку
 *   закрыли или рядом никого
 * @returns {Promise<object>} хелпер и журнал
 */
async function loadApply({ chosenTargetId }) {
  const steps = [];

  const apply = await loadHandler(helperPath, 'applyEffectSource', {
    getTargetSpellEffects: engine.getTargetSpellEffects,
    chooseUseTarget: (spell, user, proceed) => {
      steps.push(['choose', user.id]);

      if (chosenTargetId) {
        proceed(chosenTargetId);
      }
    },
    createChosenEffectTargets: (spell, casterId, entityIds) => ({
      entityIds,
    }),
    applyCasterSpellEffectsToEntity: (spell) =>
      steps.push(['self', engine.getCasterSpellEffects(spell).length]),
    applySpellTargetEffects: (spell, source, targets) =>
      steps.push([
        'target',
        source.casterId,
        source.spellSaveDC,
        [...targets.entityIds],
      ]),
  });

  return { apply, steps };
}

const hero = { id: 'hero', name: 'Hero' };

it('зелье на себя: сначала расход, потом наложение', async () => {
  const { apply, steps } = await loadApply({ chosenTargetId: null });

  const potion = engine.buildItemUseSpell({
    id: 'potion',
    name: 'Potion',
    activeEffects: [usableEffect('Heal')],
  });

  apply(potion, hero, 13, () => steps.push(['spend']));

  assert.deepEqual(steps, [['spend'], ['self', 1]]);
});

it('эффект на цель без выбранного получателя не тратит источник', async () => {
  const { apply, steps } = await loadApply({ chosenTargetId: null });

  const poison = engine.buildItemUseSpell({
    id: 'poison',
    name: 'Poison',
    activeEffects: [usableEffect('Poisoned', { effectTarget: 'target' })],
  });

  apply(poison, hero, 13, () => steps.push(['spend']));

  assert.deepEqual(steps, [['choose', 'hero']]);
});

it('эффект на цель уходит выбранному получателю с Сл применившего', async () => {
  const { apply, steps } = await loadApply({ chosenTargetId: 'goblin' });

  const poison = engine.buildItemUseSpell({
    id: 'poison',
    name: 'Poison',
    activeEffects: [usableEffect('Poisoned', { effectTarget: 'target' })],
  });

  apply(poison, hero, 15, () => steps.push(['spend']));

  assert.deepEqual(steps, [
    ['choose', 'hero'],
    ['spend'],
    ['self', 0],
    ['target', 'hero', 15, ['goblin']],
  ]);
});

/**
 * Настоящий выбор получателя на выдуманной сцене: выбор на карте подменён
 * журналом, щелчок по фишке — вызовом его проверки.
 *
 * @param {object} options - сцена
 * @param {Array<object>} options.tokens - фишки: id, actorId, hidden
 * @param {string | null} options.targetTokenId - цель, выбранная заранее
 * @param {boolean} options.hasUserToken - стоит ли на сцене применивший
 * @param {string} options.gmVerdict - что ответит ведущий на просьбу
 * @returns {Promise<object>} выбор, журнал, выбор на карте и сцена
 */
async function loadChooser({
  tokens,
  targetTokenId = null,
  hasUserToken = true,
  gmVerdict = 'approved',
}) {
  const steps = [];
  const scene = { tokens };

  const entities = new Map(
    tokens.map((token) => [
      token.actorId,
      { id: token.actorId, name: token.actorId },
    ]),
  );

  const targeting = {
    validator: null,
    picked: [],
    startTargeting: (distribution, max, validator) => {
      steps.push(['targeting', distribution, max]);
      targeting.validator = validator;
    },
    toggleTarget: (tokenId) => {
      if (targeting.validator(tokenId)) {
        targeting.picked.push(tokenId);
      }
    },
    sessionId: 7,
  };

  const ports = {
    useWorldStore: () => ({ currentScene: scene, isGM: false }),
    useWorldEntities: () => ({
      findCurrentDndEntity: (entityId) => entities.get(entityId),
    }),
    useTargetStore: () => ({
      targetTokenId,
      getTargetActor: () => (targetTokenId ? { id: 'marked' } : null),
    }),
    useProjectileStore: () => targeting,
    useSystemToastStore: () => ({
      add: (toast) => steps.push(['toast', toast.title]),
    }),
    generateId: (prefix) => prefix,
    useModalManager: () => ({
      openModal: (name, props) => steps.push(['modal', name, props]),
    }),
    EFFECT_USE_TARGET_LABELS: {
      noTargetTitle: 'no-target',
      movedAwayTitle: 'moved',
    },
    EFFECT_USE_TARGET_COUNT: 1,
    EFFECT_USE_TARGET_MODAL_KEY_PREFIX: 'use-target',
    hasUserToken: () => hasUserToken,
    formatUseGmQuestion: (spell, user, target) =>
      `${user.name} → ${target.name}`,
    requestGmApproval: (request, parties) => {
      steps.push(['ask-gm', request.question, { ...parties }]);

      return Promise.resolve(gmVerdict);
    },
    notifyGmRefusal: (verdict) => steps.push(['refused', verdict]),
  };

  ports.canPickUseTarget = await loadHandler(
    chooserPath,
    'canPickUseTarget',
    ports,
  );

  ports.resolveTokenEntity = await loadHandler(
    chooserPath,
    'resolveTokenEntity',
    ports,
  );

  const choose = await loadHandler(chooserPath, 'chooseUseTarget', ports);

  return { choose, steps, targeting, scene };
}

const potionSpell = { name: 'Potion' };

/**
 * Даёт доиграть ожиданию ответа ведущего.
 *
 * @returns {Promise<void>} после всех отложенных шагов
 */
function settle() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

it('дать другому: получателя выбирают на карте, заранее отмеченный уже выбран', async () => {
  const { choose, steps, targeting } = await loadChooser({
    tokens: [
      { id: 't-hero', actorId: 'hero' },
      { id: 't-ally', actorId: 'ally' },
    ],
    targetTokenId: 't-ally',
  });

  choose(potionSpell, hero, () => steps.push(['proceed']));

  const [targetingStep, [kind, modalName, props]] = steps;

  assert.deepEqual(targetingStep, ['targeting', 'distinct', 1]);
  assert.equal(kind, 'modal');
  assert.equal(modalName, 'EffectUseTargetPromptModal');
  assert.equal(props.userId, 'hero');
  assert.equal(props.targetingSessionId, 7);
  assert.deepEqual(targeting.picked, ['t-ally']);
});

it('на цели при применении: себя и дальнюю можно, скрытую нельзя', async () => {
  const { choose, targeting } = await loadChooser({
    tokens: [
      { id: 't-hero', actorId: 'hero' },
      { id: 't-far', actorId: 'far' },
      { id: 't-ghost', actorId: 'ghost', hidden: true },
    ],
  });

  choose(potionSpell, hero, () => undefined);

  assert.equal(targeting.validator('t-hero'), true, 'зелье выпивают сами');
  assert.equal(targeting.validator('t-ghost'), false, 'скрытую не выбрать');
  assert.equal(targeting.validator('t-far'), true, 'расстояние решает плашка');
  assert.equal(targeting.validator('t-missing'), false);
});

it('дать другому: подтверждённая фишка отдаёт свою сущность', async () => {
  const { choose, steps, scene } = await loadChooser({
    tokens: [
      { id: 't-hero', actorId: 'hero' },
      { id: 't-ally', actorId: 'ally' },
    ],
  });

  choose(potionSpell, hero, (targetId) => steps.push(['proceed', targetId]));

  const [, , props] = steps[1];

  props.onConfirm('t-ally', false);
  scene.tokens = [scene.tokens[0]];
  props.onConfirm('t-ally', false);

  assert.deepEqual(steps.slice(2), [
    ['proceed', 'ally'],
    ['toast', 'moved'],
  ]);
});

it('дать другому: дальше касания — только с разрешения ведущего', async () => {
  const approved = await loadChooser({
    tokens: [
      { id: 't-hero', actorId: 'hero' },
      { id: 't-far', actorId: 'far' },
    ],
  });

  approved.choose(potionSpell, hero, (targetId) =>
    approved.steps.push(['proceed', targetId]),
  );

  const [, , approvedProps] = approved.steps[1];

  approvedProps.onConfirm('t-far', true);
  await settle();

  assert.deepEqual(approved.steps.slice(2), [
    ['ask-gm', 'Hero → far', { aboutEntityId: 'far', fromEntityId: 'hero' }],
    ['proceed', 'far'],
  ]);

  const denied = await loadChooser({
    tokens: [
      { id: 't-hero', actorId: 'hero' },
      { id: 't-far', actorId: 'far' },
    ],
    gmVerdict: 'denied',
  });

  denied.choose(potionSpell, hero, (targetId) =>
    denied.steps.push(['proceed', targetId]),
  );

  const [, , deniedProps] = denied.steps[1];

  deniedProps.onConfirm('t-far', true);
  await settle();

  assert.deepEqual(
    denied.steps.slice(3),
    [['refused', 'denied']],
    'без разрешения предмет не применяется и не тратится',
  );
});

it('дать другому: без своей фишки на сцене годится отмеченная цель', async () => {
  const marked = await loadChooser({
    tokens: [{ id: 't-ally', actorId: 'ally' }],
    targetTokenId: 't-ally',
    hasUserToken: false,
  });

  marked.choose(potionSpell, hero, (targetId) =>
    marked.steps.push(['proceed', targetId]),
  );

  assert.deepEqual(marked.steps, [['proceed', 'marked']]);

  const unmarked = await loadChooser({
    tokens: [],
    hasUserToken: false,
  });

  unmarked.choose(potionSpell, hero, () => unmarked.steps.push(['proceed']));

  assert.deepEqual(unmarked.steps, [['toast', 'no-target']]);
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
