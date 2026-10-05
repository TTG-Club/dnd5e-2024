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
 * @param {number} options.pick - какой навык выбрать в плашке
 * @param {number} options.askedDc - какую Сл назвать в плашке
 * @param {string[]} options.offTurn - кто в бою и сейчас не ходит
 * @returns {Promise<object>} действие и журналы
 */
async function loadEscape({
  flags = new Set(),
  holderFlags,
  pick = 0,
  askedDc,
  offTurn = [],
} = {}) {
  const opened = [];
  const questions = [];
  const prompts = [];
  const settled = [];
  const bonusKeys = [];
  const toasts = [];

  const ports = {
    getSkillCheckBonusKeys: engine.getSkillCheckBonusKeys,
    formatSignedNumber: (value) =>
      value < 0 ? `−${Math.abs(value)}` : `+${value}`,
    canEscapeEffect: engine.canEscapeEffect,
    describeEscapeUnavailable: engine.describeEscapeUnavailable,
    escapeAllowsRole: engine.escapeAllowsRole,
    listEscapeChecks: engine.listEscapeChecks,
    listEscapeSkillChoices: engine.listEscapeSkillChoices,
    escapeAsksDc: engine.escapeAsksDc,
    escapeNeedsOwnTurn: engine.escapeNeedsOwnTurn,
    isEntityOwnTurn: (entityId) => !offTurn.includes(entityId),
    describeEscapeChecks: engine.describeEscapeChecks,
    DEFAULT_ESCAPE_LABEL: engine.DEFAULT_ESCAPE_LABEL,
    askedEscapeDcs: new Map(),
    resolveEscapeRollMode: engine.resolveEscapeRollMode,
    // Вне боя трата хода не пишется
    recordEntityActionSpend: () => {},
    formatEffectEscapeLabel: engine.formatEffectEscapeLabel,
    getSkillSetting: engine.getSkillSetting,
    getSkillSettingAbility: engine.getSkillSettingAbility,
    resolveAbilityCheckRollMode: engine.resolveAbilityCheckRollMode,
    SKILLS_LABELS: engine.SKILLS_LABELS,
    EFFECT_QUESTION_PROMPT_MODAL: 'EffectQuestionPromptModal',
    EFFECT_ESCAPE_PROMPT_MODAL: 'EffectEscapePromptModal',
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

        if (name === 'EffectEscapePromptModal') {
          prompts.push(props);
          props.onAnswer(String(pick), askedDc);

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
      modifierPrefix: ' (',
      modifierSuffix: ')',
      difficultyPrefix: 'Сложность, чтобы вырваться: ',
      difficultyMixedPrefix: 'Сложность: ',
      notOwnTurnSuffix: ' — не его ход',
    },
    EFFECT_ESCAPE_MODAL_KEY_PREFIX: 'effect-escape:',
  };

  ports.chooseOne = await loadHandler(helperPath, 'chooseOne', ports);

  ports.warnEscapeUnavailable = await loadHandler(
    helperPath,
    'warnEscapeUnavailable',
    ports,
  );

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

  ports.refuseOutsideOwnTurn = await loadHandler(
    helperPath,
    'refuseOutsideOwnTurn',
    ports,
  );

  ports.formatEscapeTitle = await loadHandler(
    helperPath,
    'formatEscapeTitle',
    ports,
  );

  ports.describeEscapeDifficulty = await loadHandler(
    helperPath,
    'describeEscapeDifficulty',
    ports,
  );

  const runEscapeAs = await loadHandler(helperPath, 'runEscapeAs', ports);

  return {
    runEscapeAs,
    opened,
    questions,
    prompts,
    settled,
    bonusKeys,
    toasts,
  };
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

/**
 * Настоящие списки «кто действует» и «чем помочь рядом» на выдуманной сцене.
 *
 * @param {object[]} nearby - кто стоит в пределах касания
 * @returns {Promise<object>} списки
 */
async function loadEscapeLists(nearby) {
  const ports = {
    canEscapeEffect: engine.canEscapeEffect,
    canHelpEscapeEffect: engine.canHelpEscapeEffect,
    formatEffectEscapeLabel: engine.formatEffectEscapeLabel,
    DEFAULT_REACH_FEET: engine.DEFAULT_REACH_FEET,
    EFFECT_ESCAPE_LABELS: { titleSeparator: ' — ' },
    listEntitiesNear: () => nearby,
    // Ведущий управляет всеми
    controlsEntityAsUser: () => true,
  };

  return {
    listEscapeActors: await loadHandler(helperPath, 'listEscapeActors', {
      ...ports,
    }),
    listEscapeHelpOffers: await loadHandler(
      helperPath,
      'listEscapeHelpOffers',
      { ...ports },
    ),
  };
}

it('наложивший эффект в помощники «вырваться» не предлагается', async () => {
  const plant = { id: 'plant', name: 'Plant', system: {}, activeEffects: [] };

  const friend = {
    id: 'friend',
    name: 'Friend',
    system: {},
    activeEffects: [],
  };

  const pod = grappled({
    id: 'pod',
    name: 'В стручке',
    sourceActorId: plant.id,
    escape: { by: 'adjacent', check: { skill: 'athletics', dc: 13 } },
  });

  const victim = { ...hero, activeEffects: [pod] };

  const fromVictim = await loadEscapeLists([plant, friend]);

  assert.equal(
    fromVictim
      .listEscapeActors(victim, pod)
      .map((actor) => `${actor.entity.id}:${actor.role}`)
      .join(),
    'friend:adjacent',
    'у ведущего в списке «кто действует» самого растения нет',
  );

  const fromHelper = await loadEscapeLists([victim]);

  assert.equal(
    fromHelper.listEscapeHelpOffers(plant.id).length,
    0,
    'на листе растения помощи со своим стручком нет',
  );

  assert.equal(
    fromHelper.listEscapeHelpOffers(friend.id).length,
    1,
    'сосед помочь может',
  );
});

it('носитель, наложивший эффект на себя, вырывается сам', async () => {
  const tangled = grappled({
    sourceActorId: hero.id,
    escape: { by: 'any', check: { skill: 'athletics', dc: 13 } },
  });

  const { listEscapeActors } = await loadEscapeLists([]);

  assert.equal(
    listEscapeActors({ ...hero, activeEffects: [tangled] }, tangled)
      .map((actor) => actor.role)
      .join(),
    'self',
  );
});

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

it('два навыка на выбор: Сл — строкой плашки, навыки — кнопками с бонусом', async () => {
  const { runEscapeAs, opened, prompts } = await loadEscape({ pick: 1 });

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

  assert.equal(prompts[0].difficulty, 'Сложность, чтобы вырваться: 14');
  assert.equal(prompts[0].asksDc, false);
  assert.equal(prompts[0].title, 'Вырваться — Схвачен');

  assert.deepEqual(
    prompts[0].options.map((option) => option.label),
    ['Атлетика (+3)', 'Акробатика (+5)'],
  );

  assert.equal(opened[0].props.modifier, 5, 'бросок — Акробатикой');
  assert.deepEqual(opened[0].props.rollLabel, 'Акробатика — Hero');
  assert.equal(opened[0].props.targetDc, 14);
});

it('у навыков разная Сл: плашка называет каждую', async () => {
  const { runEscapeAs, prompts } = await loadEscape();

  runEscapeAs(
    hero,
    grappled({
      escape: {
        check: {
          skill: 'sleightOfHand',
          dc: 20,
          skills: [{ skill: 'sleightOfHand' }, { skill: 'athletics', dc: 25 }],
        },
      },
    }),
    AS_SELF,
  );

  assert.equal(
    prompts[0].difficulty,
    'Сложность: Ловкость рук Сл 20 или Атлетика Сл 25',
  );
});

/**
 * «Схваченный», повешенный плиткой листа. Цена действия снята: её запрет
 * считается по настоящему листу, а герой теста — заглушка без характеристик.
 *
 * @returns {object} эффект состояния
 */
function manualGrapple() {
  const built = engine.buildConditionActiveEffect('grappled');

  assert.equal(built.escape.cost, 'action', 'вырываются действием');

  return { ...built, escape: { check: built.escape.check } };
}

it('«Схваченный», повешенный рукой: кнопка есть, Сл называет бросающий', async () => {
  const manual = manualGrapple();

  assert.equal(engine.canEscapeEffect(manual, 'self'), true);

  assert.equal(
    engine.formatEffectEscapeLabel(manual),
    'Вырваться: Атлетика или Акробатика',
  );

  const { runEscapeAs, opened, prompts, settled } = await loadEscape({
    pick: 0,
    askedDc: 12,
  });

  assert.equal(runEscapeAs(hero, manual, AS_SELF), true);

  assert.equal(prompts[0].asksDc, true);
  assert.equal(prompts[0].difficulty, null, 'известной Сл нет');

  assert.deepEqual(
    prompts[0].options.map((option) => [option.label, option.needsDc]),
    [
      ['Атлетика (+3)', true],
      ['Акробатика (+5)', true],
    ],
  );

  assert.equal(opened[0].props.targetDc, 12, 'бросок — против названной Сл');

  opened[0].props.onCheckRoll({ total: 12 });

  assert.deepEqual(settled, [['hero', manual.id, true]]);
});

it('сл не названа — броска нет', async () => {
  const manual = manualGrapple();
  const { runEscapeAs, opened } = await loadEscape();

  runEscapeAs(hero, manual, AS_SELF);

  assert.equal(opened.length, 0);
});

it('без отметки «спросить Сл» неизвестная Сл остаётся отказом', () => {
  const sourceless = grappled({
    escape: { check: { skill: 'athletics', dc: 0 } },
  });

  assert.equal(engine.canEscapeEffect(sourceless), false);
  assert.equal(engine.escapeAsksDc(sourceless.escape), false);
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

it('в бою вырываются только в свой ход — отказ с уведомлением', async () => {
  const { runEscapeAs, opened, prompts, settled, toasts } = await loadEscape({
    offTurn: [hero.id],
  });

  assert.equal(runEscapeAs(hero, grappled(), AS_SELF), false);
  assert.equal(runEscapeAs(hero, grappled({ escape: {} }), AS_SELF), false);

  assert.equal(opened.length + prompts.length + settled.length, 0);
  assert.match(toasts[0].description, /Hero — не его ход/);

  // Помощник действует в СВОЙ ход: чужой ход носителя ему не мешает
  assert.equal(
    runEscapeAs(
      hero,
      grappled({
        escape: { by: 'any', check: { skill: 'athletics', dc: 10 } },
      }),
      { entity: friend, role: 'adjacent' },
    ),
    true,
  );

  // Реакцией вырываются как раз в чужой ход
  assert.equal(engine.escapeNeedsOwnTurn({ cost: 'reaction' }), false);
  assert.equal(engine.escapeNeedsOwnTurn({ cost: 'action' }), true);
  assert.equal(engine.escapeNeedsOwnTurn({}), true);
});

it('действие без проверки снимает эффект сразу', async () => {
  const { runEscapeAs, opened, settled } = await loadEscape();

  runEscapeAs(hero, grappled({ escape: {} }), AS_SELF);

  assert.equal(opened.length, 0);
  assert.deepEqual(settled, [['hero', 'grappled', true]]);
});
