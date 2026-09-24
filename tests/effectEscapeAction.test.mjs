import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/**
 * Настоящий обработчик «вырваться» с записью открытого окна броска.
 *
 * @returns {Promise<object>} обработчик и журнал окон
 */
async function loadEscape() {
  const opened = [];
  const bonusKeys = [];

  const runEffectEscape = await loadHandler(
    'src/client/composables/effectEscapeAction.ts',
    'runEffectEscape',
    {
      getSkillCheckBonusKeys: engine.getSkillCheckBonusKeys,
      canEscapeEffect: engine.canEscapeEffect,
      formatEffectEscapeLabel: engine.formatEffectEscapeLabel,
      getSkillSetting: engine.getSkillSetting,
      getSkillSettingAbility: engine.getSkillSettingAbility,
      listEffectEscapeRemovals: engine.listEffectEscapeRemovals,
      resolveAbilityCheckRollMode: engine.resolveAbilityCheckRollMode,
      resolveEffectEscapeDc: engine.resolveEffectEscapeDc,
      SKILLS_LABELS: engine.SKILLS_LABELS,
      resolveActorStats: () => ({ skills: { athletics: 3 } }),
      buildRollBonusEvaluator: (_getEntity, keys) => {
        bonusKeys.push(keys);

        return () => [];
      },
      useModalManager: () => ({
        openModal: (name, props) => opened.push({ name, props }),
      }),
      EFFECT_ESCAPE_LABELS: {
        titleSeparator: ' — ',
        rollButton: 'roll',
      },
      EFFECT_ESCAPE_MODAL_KEY_PREFIX: 'effect-escape:',
    },
  );

  return { runEffectEscape, opened, bonusKeys };
}

/**
 * Эффект с действием «вырваться» проверкой Атлетики.
 *
 * @param {object} overrides - поля эффекта
 * @returns {object} эффект
 */
function grappled(overrides = {}) {
  return {
    id: 'grappled',
    name: 'Схвачен',
    disabled: false,
    changes: [],
    flags: [],
    duration: { type: 'permanent' },
    escape: { check: { skill: 'athletics', dc: 13 } },
    ...overrides,
  };
}

const hero = { id: 'hero', name: 'Hero', system: {}, activeEffects: [] };

it('из выключенного эффекта не вырываются', async () => {
  const { runEffectEscape, opened } = await loadEscape();

  const started = runEffectEscape({
    entity: hero,
    effect: grappled({ disabled: true }),
    flags: new Set(),
    onEscaped: () => assert.fail('выключенный эффект не снимается'),
  });

  assert.equal(started, false);
  assert.equal(opened.length, 0, 'окно броска не открылось');
});

it('общая помеха на проверки (Отравлен) даёт помеху и «вырваться»', async () => {
  const { runEffectEscape, opened } = await loadEscape();

  runEffectEscape({
    entity: hero,
    effect: grappled(),
    flags: new Set(['abilityCheck.disadvantage']),
    onEscaped: () => {},
  });

  assert.equal(opened.length, 1);
  assert.equal(opened[0].props.initialRollMode, 'disadvantage');
  assert.equal(opened[0].props.targetDc, 13);
});

it('навык на другой характеристике читает флаги по ней', async () => {
  const { runEffectEscape, opened } = await loadEscape();

  const tough = {
    ...hero,
    system: {
      skillSettings: {
        skills: { athletics: { ability: 'constitution', bonuses: [] } },
      },
    },
  };

  runEffectEscape({
    entity: tough,
    effect: grappled(),
    flags: new Set(['abilityCheck.advantage.constitution']),
    onEscaped: () => {},
  });

  assert.equal(opened[0].props.initialRollMode, 'advantage');
});

it('кость к навыку («Наставление» на Атлетику) катается и во «вырваться»', async () => {
  const { runEffectEscape, bonusKeys } = await loadEscape();

  runEffectEscape({
    entity: hero,
    effect: grappled(),
    flags: new Set(),
    onEscaped: () => {},
  });

  assert.deepEqual(bonusKeys, [['abilityCheck', 'skill.athletics']]);
});
