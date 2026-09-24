import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Спасбросок эффекта спрашивают только у цели, на которую эффект может лечь:
 * «Изгнание нежити» не заставляет гоблина бросать Мудрость.
 */

const resolutionPath = 'src/client/composables/useTargetEffectResolution.ts';

/** Изгнание нежити: спасбросок Мудрости, ложится только на нежить */
const TURN_UNDEAD = createEffect('Изгнание нежити', {
  effectTarget: 'target',
  conditionKey: 'frightened',
  landingCondition: 'self.creatureType === "undead"',
  applySave: { ability: 'wisdom', dc: 0, onSuccess: 'negate' },
});

/**
 * Настоящий отбор эффектов со спасброском для цели.
 *
 * @returns {Promise<Function>} отбор
 */
async function loadSaveFilter() {
  const listEffectsWithOwnSave = await loadHandler(
    resolutionPath,
    'listEffectsWithOwnSave',
    { getTargetSpellEffects: engine.getTargetSpellEffects },
  );

  return loadHandler(resolutionPath, 'listLandingEffectsWithOwnSave', {
    listEffectsWithOwnSave,
    isDndSceneEntity: engine.isDndSceneEntity,
    passesLandingCondition: engine.passesLandingCondition,
    buildLandingContext: () => ({ source: createActor() }),
  });
}

it('цель, которую условие наложения не пропускает, спасбросок не бросает', async () => {
  const listSaves = await loadSaveFilter();

  const spell = engine.buildEffectUseSpell({
    ...TURN_UNDEAD,
    activation: { mode: 'use' },
  });

  const zombie = createCreature({ name: 'Зомби' });

  zombie.system.type = 'undead';

  const goblin = createCreature({ name: 'Гоблин' });

  goblin.system.type = 'fey';

  assert.deepEqual(
    listSaves({ spell, entity: zombie, spellSaveDC: 13 }).map(
      (effect) => effect.name,
    ),
    ['Изгнание нежити'],
    'нежить бросает спасбросок',
  );

  assert.deepEqual(
    listSaves({ spell, entity: goblin, spellSaveDC: 13 }),
    [],
    'гоблину бросать незачем: эффект на него не ляжет',
  );
});
