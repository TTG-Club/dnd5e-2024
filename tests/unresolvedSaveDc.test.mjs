import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  createZone,
  engine,
  MIN_ROLL,
  saveOutcome,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Сл спасброска, которую не из чего посчитать, не становится нулём молча:
 * «Телекинетический толчок» без выбранной в черте характеристики у
 * не-заклинателя шёл против Сл 0 — любой бросок успех, бонусное действие
 * потрачено, предупреждения нет.
 */

const resolutionPath = 'src/client/composables/useTargetEffectResolution.ts';

const FEATURE_ID = 'feature_telekinetic';

/** Сл формулой по характеристике, выбранной в черте */
const FEAT_DC_FORMULA = '8 + @prof + @mod.feat';

/** Эффект «Телекинетического толчка», как он записан в компендиуме */
const SHOVE = createEffect('Телекинетический толчок', {
  activation: { mode: 'use', cost: 'bonus' },
  effectTarget: 'target',
  originId: `feat:${FEATURE_ID}`,
  conditionKey: 'prone',
  applySave: {
    ability: 'strength',
    dc: 0,
    dcFormula: FEAT_DC_FORMULA,
    onSuccess: 'negate',
  },
  duration: { type: 'special' },
});

/**
 * Персонаж с чертой «Телекинетик».
 *
 * @param {object} choices - ответы выборов черты
 * @returns {object} персонаж
 */
function createTelekinetic(choices) {
  const actor = createActor({ activeEffects: [SHOVE] });

  actor.features = [
    {
      id: FEATURE_ID,
      name: 'Телекинетик',
      featData: {
        abilityScoreIncrease: { fromChoiceKey: 'spellcasting-ability' },
        choices: [{ key: 'spellcasting-ability', type: 'spellcastingAbility' }],
      },
      choices,
    },
  ];

  return actor;
}

/**
 * Эффект с числами наложившего — как его готовит клиент перед наложением.
 *
 * @param {object} owner - наложивший
 * @returns {object} эффект
 */
function bindToOwner(owner) {
  const [bound] = engine.bindTargetEffectsToSource(
    [SHOVE],
    owner,
    engine.buildOwnerSaveDcContext(owner, [FEAT_DC_FORMULA]),
  );

  return bound;
}

describe('непосчитанная Сл: что не посчиталось и почему', () => {
  it('в черте не выбрана характеристика — Сл нет, причина названа', () => {
    const problem = engine.findUnresolvedApplySaveDc(
      bindToOwner(createTelekinetic({})),
      0,
    );

    assert.deepEqual(problem.tokens, ['@mod.feat']);

    assert.match(
      engine.describeUnresolvedSaveDc(problem),
      /^формула «.*@mod\.feat» — в черте не выбрана характеристика$/,
    );

    assert.match(
      engine.formatUnresolvedSaveDcNote(SHOVE.name, problem),
      /^Телекинетический толчок: Сл спасброска не посчитана \(.*\) — спасбросок не брошен, срабатывание пропущено$/,
    );
  });

  it('характеристика выбрана — Сл считается', () => {
    const bound = bindToOwner(
      createTelekinetic({ 'spellcasting-ability': ['wisdom'] }),
    );

    assert.equal(engine.findUnresolvedApplySaveDc(bound, 0), null);
    assert.ok(bound.applySave.dc > 0);
  });

  it('у заклинателя запасная Сл есть — спасбросок идёт против неё', () => {
    assert.equal(
      engine.findUnresolvedApplySaveDc(bindToOwner(createTelekinetic({})), 14),
      null,
    );
  });

  it('сл «наложившего» без наложившего', () => {
    const problem = engine.findUnresolvedSaveDc({ dc: 0 }, 0);

    assert.equal(
      engine.describeUnresolvedSaveDc(problem),
      'записана «Сл наложившего», а у наложившего её нет',
    );
  });

  it('сл от проверки навыка до броска проверки непосчитанной не считается', () => {
    const dread = createEffect('Устрашение', {
      effectTarget: 'target',
      applySave: { ability: 'wisdom', dc: 0, dcSkill: 'intimidation' },
    });

    assert.equal(engine.findUnresolvedApplySaveDc(dread, 0), null);
  });
});

describe('непосчитанная Сл: клиент не бросает и не накладывает', () => {
  /**
   * Настоящий разбор эффектов цели с журналом предупреждений.
   *
   * @returns {Promise<object>} отбор спасбросков, разбор и журнал
   */
  async function loadResolution() {
    const warnings = [];

    const listEffectsWithOwnSave = await loadHandler(
      resolutionPath,
      'listEffectsWithOwnSave',
      { getTargetSpellEffects: engine.getTargetSpellEffects },
    );

    const ports = {
      listEffectsWithOwnSave,
      // Числа наложившего в фикстуре уже подставлены
      bindTargetEffectsToCaster: (effects) => [...effects],
      buildLandingContext: () => ({}),
      useWorldEntities: () => ({ findEntityCreatureType: () => undefined }),
      rollEffectDamage: () => ({ damage: 0, outcome: 'normal', lines: [] }),
      stampEffectOnApply: (effect) => effect,
      resolveSpellCastId: () => undefined,
      resolveSpellCastLevel: () => 0,
      warnUnresolvedSaveDc: (sourceName, problem, outcomeSuffix) =>
        warnings.push([sourceName, problem.tokens, outcomeSuffix]),
      UNRESOLVED_SAVE_DC_LABELS: engine.UNRESOLVED_SAVE_DC_LABELS,
      findUnresolvedApplySaveDc: engine.findUnresolvedApplySaveDc,
      getTargetSpellEffects: engine.getTargetSpellEffects,
      isDndSceneEntity: engine.isDndSceneEntity,
      getEntityConditionImmunities: engine.getEntityConditionImmunities,
      resolveActorStats: engine.resolveActorStats,
      passesLandingCondition: engine.passesLandingCondition,
      resolveEffectApplication: engine.resolveEffectApplication,
      isMagicRoll: engine.isMagicRoll,
      isMagicalEffect: engine.isMagicalEffect,
      hasLastingEffectPayload: engine.hasLastingEffectPayload,
      isImmuneToCondition: engine.isImmuneToCondition,
      stampSourceTurnSaveDc: engine.stampSourceTurnSaveDc,
    };

    return {
      warnings,
      listSaves: await loadHandler(
        resolutionPath,
        'listLandingEffectsWithOwnSave',
        { ...ports },
      ),
      collect: await loadHandler(resolutionPath, 'collectTargetEffects', {
        ...ports,
      }),
    };
  }

  /**
   * Вход разбора: «Толчок» по гоблину с заданной Сл источника.
   *
   * @param {object} effect - эффект с числами наложившего
   * @param {number} spellSaveDC - Сл источника
   * @returns {object} вход разбора
   */
  function inputOf(effect, spellSaveDC) {
    return {
      spell: engine.buildEffectUseSpell(effect),
      entity: createCreature({ name: 'Гоблин' }),
      spellSaveDC,
      casterId: 'actor_hero',
    };
  }

  it('спасбросок не спрашивают, эффект не ложится, причина показана', async () => {
    const { listSaves, collect, warnings } = await loadResolution();
    const input = inputOf(bindToOwner(createTelekinetic({})), 0);

    assert.equal(listSaves(input).length, 0, 'бросать не против чего');

    const { effects } = collect(input, undefined, new Map());

    assert.equal(effects.length, 0, 'без броска эффект не ложится');

    assert.deepEqual(warnings, [
      [
        SHOVE.name,
        ['@mod.feat'],
        engine.UNRESOLVED_SAVE_DC_LABELS.effectSkippedSuffix,
      ],
    ]);
  });

  it('посчитанная Сл — спасбросок и наложение как раньше', async () => {
    const { listSaves, collect, warnings } = await loadResolution();

    const bound = bindToOwner(
      createTelekinetic({ 'spellcasting-ability': ['wisdom'] }),
    );

    const input = inputOf(bound, 0);

    assert.equal(listSaves(input).length, 1);

    const { effects } = collect(
      input,
      undefined,
      new Map([[bound.id, saveOutcome(false)]]),
    );

    assert.equal(effects.length, 1);
    assert.equal(warnings.length, 0);
  });
});

describe('непосчитанная Сл: сервер пропускает срабатывание со строкой в сводку', () => {
  /**
   * Эффект с повторным спасброском в начале хода: успех снимает эффект.
   *
   * @param {object} save - Сл спасброска
   * @returns {object} эффект
   */
  function heldBy(save) {
    return createEffect('Хватка', {
      conditionKey: 'restrained',
      triggers: [
        {
          id: 'trigger_hold',
          event: 'turnStart',
          save: { ability: 'strength', ...save },
          limit: { count: 1, per: 'turn' },
          actions: [{ on: 'passed', type: 'removeSelf' }],
        },
      ],
    });
  }

  it('начало хода: спасбросок не брошен, эффект не снят «успехом», лимит цел', () => {
    const hero = withHp(createActor, 20, {
      activeEffects: [heldBy({ dc: 0, dcFormula: FEAT_DC_FORMULA })],
    });

    const result = engine.processTurnEffects(hero, 'startOfTurn');

    assert.equal(result.saveOutcomes.length, 0, 'броска нет');
    assert.equal(hero.activeEffects.length, 1, 'эффект на месте');

    assert.equal(result.notes.length, 1, 'одна строка на срабатывание');

    assert.match(
      result.notes[0],
      /^Хватка: Сл спасброска не посчитана \(формула «.*@mod\.feat» — в черте не выбрана характеристика\) — спасбросок не брошен, срабатывание пропущено$/,
    );

    assert.equal(hero.system.effectUsage, undefined, 'лимит не потрачен');
  });

  it('начало хода: Сл числом — спасбросок идёт как раньше', () => {
    const hero = withHp(createActor, 20, {
      activeEffects: [heldBy({ dc: 30 })],
    });

    const result = withRandom([MIN_ROLL], () =>
      engine.processTurnEffects(hero, 'startOfTurn'),
    );

    assert.equal(result.saveOutcomes.length, 1);
    assert.equal(result.saveOutcomes[0].dc, 30);
    assert.deepEqual(result.notes, []);
  });

  it('событие урона: срабатывание со Сл 0 без источника пропущено', () => {
    const system = new engine.Dnd5eVttSystem();

    const hero = withHp(createActor, 20, {
      activeEffects: [
        createEffect('Шок', {
          triggers: [
            {
              id: 'trigger_shock',
              event: 'damageTaken',
              save: { ability: 'constitution', dc: 0 },
              actions: [
                {
                  on: 'failed',
                  type: 'applyCondition',
                  conditionKey: 'stunned',
                },
              ],
            },
          ],
        }),
      ],
    });

    const copy = structuredClone(hero);

    engine.applyTargetDamage(copy, 5, false, 'slashing');

    const result = system.settleCombatState(hero, engine.pickCombatState(copy));

    assert.match(
      result.chatSummary,
      /Шок: Сл спасброска не посчитана \(записана «Сл наложившего», а у наложившего её нет\)/,
    );

    assert.ok(
      !hero.activeEffects.some((effect) => effect.conditionKey === 'stunned'),
    );
  });

  it('вход в зону: эффект со Сл 0 не срабатывает, в сводке — причина', () => {
    const bog = createEffect('Ядовитое болото', {
      areaTrigger: 'enter',
      conditionKey: 'poisoned',
      applySave: { ability: 'constitution', dc: 0, onSuccess: 'negate' },
    });

    const orc = createCreature();

    const result = engine.syncActorAreaEffects(
      orc,
      new Set(),
      new Set(['ca_bog']),
      [createZone('ca_bog', [bog])],
      {},
    );

    assert.equal(result.saveOutcomes.length, 0);

    assert.deepEqual(result.notes, [
      engine.formatUnresolvedSaveDcNote(bog.name, { tokens: [] }),
    ]);
  });
});
