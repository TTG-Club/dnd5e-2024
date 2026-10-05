import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { it } from 'vitest';

import { loadChangeEntityCombatState } from './helpers/combatWrite.mjs';
import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import { createActor, engine, withHp } from './scenarios/_fixtures.mjs';

const helperPath = 'src/client/composables/useEntityActiveEffects.ts';
const panelPath = 'src/client/ui/actor/ActiveEffectsPanel.vue';

/** Захват щупальцем: состояние с действием «вырваться» */
const GRAPPLE = {
  id: 'effect_grapple',
  name: 'Схваченный',
  changes: [],
  flags: [],
  conditionKey: 'grappled',
  escape: {
    by: 'self',
    cost: 'action',
    check: { skill: 'athletics', dc: 14 },
    onSuccess: 'removeSelf',
  },
};

/** «Ошеломлён до конца захвата»: уходит, когда снимается «Схваченный» */
const STUN = {
  id: 'effect_stun',
  name: 'Ошеломлённый',
  changes: [],
  flags: [],
  conditionKey: 'stunned',
  triggers: [
    {
      id: 'trigger_grapple_end',
      event: 'conditionLost',
      conditionKey: 'grappled',
      actions: [{ type: 'removeSelf' }],
    },
  ],
};

/**
 * Настоящие помощники вкладки эффектов с подменённым окружением.
 *
 * @param {object | undefined} entity - сущность мира, которую найдёт помощник
 * @returns {Promise<object>} помощники и журнал отправленных снимков
 */
async function loadHelpers(entity) {
  const emitted = [];

  const ports = {
    resolveEffectConditionKey: engine.resolveEffectConditionKey,
    canEscapeEffect: engine.canEscapeEffect,
    isEffectDormant: engine.isEffectDormant,
    changeEntityCombatState: await loadChangeEntityCombatState({
      findEntity: () => entity,
      emitted,
      recordCombatBaseline: engine.recordCombatBaseline,
    }),
  };

  ports.isCustomEffect = await loadHandler(helperPath, 'isCustomEffect', ports);

  ports.dropConditionEffects = await loadHandler(
    helperPath,
    'dropConditionEffects',
    ports,
  );

  return {
    emitted,
    listConditionEscapeEffects: await loadHandler(
      helperPath,
      'listConditionEscapeEffects',
      ports,
    ),
    listSelfEscapeEffects: await loadHandler(
      helperPath,
      'listSelfEscapeEffects',
      ports,
    ),
    removeEntityCondition: await loadHandler(
      helperPath,
      'removeEntityCondition',
      ports,
    ),
  };
}

it('кнопку над хотбаром получает то, из чего носитель вырывается сам', async () => {
  const { listSelfEscapeEffects } = await loadHelpers();

  const manual = engine.buildConditionActiveEffect('grappled');

  const helperOnly = {
    ...GRAPPLE,
    id: 'effect_pod',
    escape: { by: 'adjacent' },
  };

  const switchedOff = { ...GRAPPLE, id: 'effect_off', disabled: true };

  const givenToOthers = {
    ...GRAPPLE,
    id: 'effect_aura',
    aura: { applyToSelf: false },
  };

  assert.deepEqual(
    listSelfEscapeEffects([
      GRAPPLE,
      STUN,
      manual,
      helperOnly,
      switchedOff,
      givenToOthers,
    ]).map((effect) => effect.id),
    [GRAPPLE.id, manual.id],
    'захват атакой и захват, повешенный плиткой; чужая помощь, выключенный и аура для других — нет',
  );
});

it('кнопку «вырваться» получает эффект-состояние, у которого нет строки', async () => {
  const { listConditionEscapeEffects } = await loadHelpers();

  const { conditionKey: _conditionKey, ...ownEffect } = GRAPPLE;
  const wound = { ...ownEffect, id: 'effect_wound', name: 'Адская рана' };
  const template = { ...GRAPPLE, id: 'effect_use', activation: { on: 'use' } };
  const switchedOff = { ...GRAPPLE, id: 'effect_off', disabled: true };

  assert.deepEqual(
    listConditionEscapeEffects([
      GRAPPLE,
      STUN,
      wound,
      template,
      switchedOff,
    ]).map((effect) => effect.id),
    [GRAPPLE.id],
    'строка «своего эффекта» несёт кнопку сама; шаблон и выключенный — не захват',
  );
});

it('панель рисует кнопки состояний и снимает плитку боевым каналом', async () => {
  const panel = await readFile(join(systemRoot, panelPath), 'utf8');

  assert.match(panel, /v-for="\{ effect, label \} in conditionEscapeRows"/u);
  assert.match(panel, /handleConditionTile\(condition\.key\)/u);
  assert.match(panel, /removeEntityCondition\(owner\.id, key\)/u);
});

it('снятие «Схваченного» плиткой уводит и «Ошеломлённого» иллитида', async () => {
  const hero = withHp(createActor, 30, { activeEffects: [GRAPPLE, STUN] });

  const { emitted, removeEntityCondition } = await loadHelpers(hero);

  assert.equal(removeEntityCondition(hero.id, 'grappled'), true);
  assert.equal(emitted.length, 1, 'снятие ушло боевым каналом');

  const [snapshot] = emitted;

  assert.deepEqual(
    snapshot.activeEffects.map((effect) => effect.id),
    [STUN.id],
    'плитка сняла только «Схваченного»',
  );

  // Сервер принимает снимок так же, как исход «вырваться»
  const stored = structuredClone(hero);

  new engine.Dnd5eVttSystem().settleCombatState(
    stored,
    engine.pickCombatState(snapshot),
  );

  assert.deepEqual(
    stored.activeEffects,
    [],
    'срабатывание «когда снимается состояние» сняло «Ошеломлённого»',
  );
});

it('без сущности мира плитка остаётся правкой черновика листа', async () => {
  const { emitted, removeEntityCondition } = await loadHelpers(undefined);

  assert.equal(removeEntityCondition('actor_missing', 'grappled'), false);
  assert.equal(emitted.length, 0);
});
