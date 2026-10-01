import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

const helperPath = 'src/client/composables/effectEscapeAction.ts';

/**
 * Настоящее действие «вырваться» с записью окон, вопросов и исходов.
 *
 * @param {object} options - что подменить
 * @param {Set<string>} options.flags - действующие флаги бросающего
 * @param {Set<string>} options.holderFlags - действующие флаги наложившего
 * @param {number} options.pick - какой вариант выбрать в вопросе
 * @returns {Promise<object>} действие и журналы
 */
async function loadEscape({ flags = new Set(), holderFlags, pick = 0 } = {}) {
  const opened = [];
  const questions = [];
  const settled = [];
  const bonusKeys = [];
  const toasts = [];

  const ports = {
    getSkillCheckBonusKeys: engine.getSkillCheckBonusKeys,
    canEscapeEffect: engine.canEscapeEffect,
    describeEscapeUnavailable: engine.describeEscapeUnavailable,
    escapeAllowsRole: engine.escapeAllowsRole,
    listEscapeChecks: engine.listEscapeChecks,
    resolveEscapeRollMode: engine.resolveEscapeRollMode,
    // Вне боя трата хода не пишется
    recordEntityActionSpend: () => {},
    formatEffectEscapeLabel: engine.formatEffectEscapeLabel,
    getSkillSetting: engine.getSkillSetting,
    getSkillSettingAbility: engine.getSkillSettingAbility,
    resolveAbilityCheckRollMode: engine.resolveAbilityCheckRollMode,
    SKILLS_LABELS: engine.SKILLS_LABELS,
    listAmbientEffects: () => [],
    resolveActorStats: (entity) => ({
      skills: { athletics: 3, acrobatics: 5, medicine: 1 },
      activeFlags: entity.id === 'holder' ? holderFlags : flags,
    }),
    buildRollBonusEvaluator: (_getEntity, keys) => {
      bonusKeys.push(keys);

      return () => [];
    },
    useModalManager: () => ({
      openModal: (name, props) => {
        if (name === 'EffectQuestionPromptModal') {
          questions.push(props);
          props.onAnswer(String(pick));

          return;
        }

        opened.push({ name, props });
      },
    }),
    useWorldEntities: () => ({
      findCurrentDndEntity: (entityId) =>
        entityId === 'holder' && holderFlags
          ? { id: 'holder', name: 'Holder' }
          : undefined,
    }),
    useSystemToastStore: () => ({ add: (toast) => toasts.push(toast) }),
    settleEscape: (carrierId, effect, succeeded) =>
      settled.push([carrierId, effect.id, succeeded]),
    EFFECT_ESCAPE_LABELS: {
      titleSeparator: ' — ',
      rollButton: 'roll',
      hint: 'hint',
      unavailablePrefix: 'нельзя: ',
    },
    EFFECT_ESCAPE_PROMPT_LABELS: {
      skillQuestion: 'Каким навыком?',
      modifierPrefix: ' (',
      modifierSuffix: ')',
    },
    EFFECT_ESCAPE_MODAL_KEY_PREFIX: 'effect-escape:',
  };

  ports.chooseOne = await loadHandler(helperPath, 'chooseOne', ports);
  ports.formatModifier = await loadHandler(helperPath, 'formatModifier', ports);

  // Окно проверки навыка — общее с Сл от проверки (`skillCheckRoll.ts`)
  ports.openSkillCheckModal = await loadHandler(
    'src/client/composables/skillCheckRoll.ts',
    'openSkillCheckModal',
    { ...ports, SKILL_ROLL_LABEL_SEPARATOR: ' — ' },
  );

  ports.rollEscapeCheck = await loadHandler(
    helperPath,
    'rollEscapeCheck',
    ports,
  );

  const runEscapeAs = await loadHandler(helperPath, 'runEscapeAs', ports);

  return { runEscapeAs, opened, questions, settled, bonusKeys, toasts };
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
const friend = { id: 'friend', name: 'Friend', system: {}, activeEffects: [] };

/** Действует сам носитель */
const AS_SELF = { entity: hero, role: 'self' };

it('из выключенного эффекта не вырываются', async () => {
  const { runEscapeAs, opened, toasts } = await loadEscape();

  const started = runEscapeAs(hero, grappled({ disabled: true }), AS_SELF);

  assert.equal(started, false);
  assert.equal(opened.length, 0, 'окно броска не открылось');
  assert.match(toasts[0].description, /эффект выключен/);
});

it('общая помеха на проверки (Отравлен) даёт помеху и «вырваться»', async () => {
  const { runEscapeAs, opened } = await loadEscape({
    flags: new Set(['abilityCheck.disadvantage']),
  });

  runEscapeAs(hero, grappled(), AS_SELF);

  assert.equal(opened.length, 1);
  assert.equal(opened[0].props.initialRollMode, 'disadvantage');
  assert.equal(opened[0].props.targetDc, 13);
});

it('навык на другой характеристике читает флаги по ней', async () => {
  const { runEscapeAs, opened } = await loadEscape({
    flags: new Set(['abilityCheck.advantage.constitution']),
  });

  const tough = {
    ...hero,
    system: {
      skillSettings: {
        skills: { athletics: { ability: 'constitution', bonuses: [] } },
      },
    },
  };

  runEscapeAs(tough, grappled(), { entity: tough, role: 'self' });

  assert.equal(opened[0].props.initialRollMode, 'advantage');
});

it('кость к навыку («Наставление» на Атлетику) катается и во «вырваться»', async () => {
  const { runEscapeAs, bonusKeys } = await loadEscape();

  runEscapeAs(hero, grappled(), AS_SELF);

  assert.deepEqual(bonusKeys, [['abilityCheck', 'skill.athletics']]);
});

it('два навыка на выбор: спрашивают, каким бросать, и бросают выбранным', async () => {
  const { runEscapeAs, opened, questions } = await loadEscape({ pick: 1 });

  runEscapeAs(
    hero,
    grappled({
      escape: {
        check: {
          skill: 'athletics',
          dc: 14,
          skills: [{ skill: 'athletics' }, { skill: 'acrobatics' }],
        },
      },
    }),
    AS_SELF,
  );

  assert.deepEqual(
    questions[0].options.map((option) => option.label),
    ['Атлетика Сл 14 (+3)', 'Акробатика Сл 14 (+5)'],
  );

  assert.equal(opened[0].props.modifier, 5, 'бросок — Акробатикой');
  assert.deepEqual(opened[0].props.rollLabel, 'Акробатика — Hero');
});

it('помощник бросает свой навык, а исход достаётся носителю', async () => {
  const { runEscapeAs, opened, settled } = await loadEscape();

  const net = grappled({
    id: 'net',
    escape: { by: 'any', check: { skill: 'athletics', dc: 10 } },
  });

  runEscapeAs(hero, net, { entity: friend, role: 'adjacent' });

  assert.equal(opened[0].props.title.endsWith('Friend'), true);

  opened[0].props.onCheckRoll({ total: 12 });
  opened[0].props.onCheckRoll({ total: 4 });

  assert.deepEqual(settled, [
    ['hero', 'net', true],
    ['hero', 'net', false],
  ]);
});

it('сосед не действует там, где вырваться может только носитель', async () => {
  const { runEscapeAs, opened } = await loadEscape();

  assert.equal(
    runEscapeAs(hero, grappled(), { entity: friend, role: 'adjacent' }),
    false,
  );

  assert.equal(opened.length, 0);
});

it('режим из эффекта, флаг вырывающегося и флаг того, кто держит', async () => {
  // Мимик: проверки для освобождения — с помехой
  const sticky = await loadEscape();

  sticky.runEscapeAs(
    hero,
    grappled({
      conditionKey: 'grappled',
      escape: { check: { skill: 'athletics', dc: 13, mode: 'disadvantage' } },
    }),
    AS_SELF,
  );

  assert.equal(sticky.opened[0].props.initialRollMode, 'disadvantage');

  // Голиаф: преимущество, чтобы избавиться от состояния «Схваченный»
  const goliath = await loadEscape({
    flags: new Set(['escape.advantage.grappled']),
  });

  goliath.runEscapeAs(hero, grappled({ conditionKey: 'grappled' }), AS_SELF);
  goliath.runEscapeAs(hero, grappled({ conditionKey: 'restrained' }), AS_SELF);

  assert.deepEqual(
    goliath.opened.map((entry) => entry.props.initialRollMode),
    ['advantage', 'normal'],
    'флаг «из захвата» не касается опутывания',
  );

  // «Железная хватка»: из захвата владельца черты вырываются с помехой
  const ironGrip = await loadEscape({
    holderFlags: new Set(['grapple.escapeDisadvantage']),
  });

  ironGrip.runEscapeAs(
    hero,
    grappled({ conditionKey: 'grappled', sourceActorId: 'holder' }),
    AS_SELF,
  );

  assert.equal(ironGrip.opened[0].props.initialRollMode, 'disadvantage');
});

it('действие без проверки снимает эффект сразу', async () => {
  const { runEscapeAs, opened, settled } = await loadEscape();

  runEscapeAs(hero, grappled({ escape: {} }), AS_SELF);

  assert.equal(opened.length, 0);
  assert.deepEqual(settled, [['hero', 'grappled', true]]);
});
