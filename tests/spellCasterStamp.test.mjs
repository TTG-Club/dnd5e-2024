import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  engine,
  MAX_ROLL,
  saveOutcome,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Эффект заклинания со спасброском знает заклинателя: лист персонажа не
 * передавал его в разбор, и «Опутывающий удар» ложился без каста, круга и
 * наложившего — конец концентрации и «Рассеивание магии» его не снимали, а
 * урон в начале хода `(@castLevel)d6` не считался.
 */

const require = createRequire(`${systemRoot}package.json`);
const { parse } = require('@vue/compiler-sfc');
const typescript = require('typescript');

const resolutionPath = 'src/client/composables/useTargetEffectResolution.ts';
const sharedPath = 'src/client/composables/spellResolutionShared.ts';
const bindingPath = 'src/client/composables/targetEffectSourceBinding.ts';
const castsPath = 'src/client/composables/spellCasts.ts';

const RANGER_ID = 'actor_ranger';
const ENSNARE_CAST_ID = 'cast_ensnaring_strike';

/** Сл заклинаний следопыта */
const RANGER_SAVE_DC = 14;

/** Круг ячейки каста */
const CAST_LEVEL = 3;

/** Хиты цели: с запасом на урон в начале хода */
const TARGET_HP = 60;

/** Эффект «Опутывающего удара», как он записан в компендиуме */
const ENSNARED = createEffect('Опутанный', {
  origin: 'spell',
  effectTarget: 'target',
  conditionKey: 'restrained',
  duration: { type: 'minutes', value: 1 },
  flags: ['speed.zero', 'attack.disadvantage'],
  recurringDamage: {
    damageParts: [
      { formula: '(@castLevel)d6@dmg.piercing', target: 'selected' },
    ],
    timing: 'startOfTurn',
  },
  escape: {
    by: 'any',
    cost: 'action',
    check: { skill: 'athletics', dc: 0 },
    onSuccess: 'removeSelf',
  },
});

/** «Опутывающий удар»: спасбросок Силы у заклинания, концентрация */
const ENSNARING_STRIKE = {
  id: 'spell_ensnaring_strike',
  name: 'Опутывающий удар',
  level: 1,
  concentration: true,
  saveType: 'strength',
  saveEffect: 'none',
  activeEffects: [ENSNARED],
};

/**
 * Настоящий разбор эффектов цели вместе с памятью кастов и штампом наложения.
 *
 * @param {object[]} entities - сущности мира
 * @returns {Promise<object>} разбор и начало каста
 */
async function loadResolution(entities) {
  const world = {
    findCurrentDndEntity: (id) => entities.find((entity) => entity.id === id),
    findEntityCreatureType: () => undefined,
  };

  /** Память кастов: одна на все функции модуля */
  const castMemory = {
    activeCastIds: new Map(),
    activeCastLevels: new Map(),
  };

  const castMemoryKey = await loadHandler(castsPath, 'castMemoryKey', {});

  /**
   * Функция модуля кастов с общей памятью.
   *
   * @param {string} name - имя функции
   * @returns {Promise<Function>} функция
   */
  const loadCastFunction = (name) =>
    loadHandler(castsPath, name, { ...castMemory, castMemoryKey });

  const beginSpellCast = await loadCastFunction('beginSpellCast');
  const setSpellCastLevel = await loadCastFunction('setSpellCastLevel');
  const resolveSpellCastId = await loadCastFunction('resolveSpellCastId');
  const resolveSpellCastLevel = await loadCastFunction('resolveSpellCastLevel');

  const resolveCasterSpellMod = await loadHandler(
    bindingPath,
    'resolveCasterSpellMod',
    {
      resolveActorStats: engine.resolveActorStats,
      resolveSpellcastingAbility: engine.resolveSpellcastingAbility,
      listAmbientEffects: () => [],
    },
  );

  const bindTargetEffectsToCaster = await loadHandler(
    bindingPath,
    'bindTargetEffectsToCaster',
    {
      useWorldEntities: () => world,
      listEffectSaveDcs: engine.listEffectSaveDcs,
      bindTargetEffectsToSource: engine.bindTargetEffectsToSource,
      buildOwnerSaveDcContext: engine.buildOwnerSaveDcContext,
      resolveSpellCastLevel,
      resolveCasterSpellMod,
    },
  );

  const stampEffectOnApply = await loadHandler(
    sharedPath,
    'stampEffectOnApply',
    {
      useWorldEntities: () => world,
      stampAppliedEffect: engine.stampAppliedEffect,
      resolveActiveTurnActorId: () => undefined,
    },
  );

  const collectTargetEffects = await loadHandler(
    resolutionPath,
    'collectTargetEffects',
    {
      useWorldEntities: () => world,
      buildLandingContext: (input) => ({
        source: world.findCurrentDndEntity(input.casterId),
      }),
      // У эффекта нет урона при наложении — бросать нечего
      rollEffectDamage: () => ({ damage: 0, outcome: 'normal', lines: [] }),
      bindTargetEffectsToCaster,
      stampEffectOnApply,
      resolveSpellCastId,
      resolveSpellCastLevel,
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
    },
  );

  return { beginSpellCast, setSpellCastLevel, collectTargetEffects };
}

/**
 * Каст «Опутывающего удара» 3-м кругом по цели, провалившей спасбросок.
 *
 * @param {string | undefined} casterId - кого разбор считает заклинателем
 * @returns {Promise<{ target: object, effect: object | undefined }>} цель с
 *   наложенным эффектом
 */
async function castEnsnaringStrike(casterId) {
  const ranger = createActor({ id: RANGER_ID, name: 'Следопыт' });
  const target = withHp(createCreature, TARGET_HP, { name: 'Огр' });

  const { beginSpellCast, setSpellCastLevel, collectTargetEffects } =
    await loadResolution([ranger, target]);

  // Как на листе: каст начинается до окна броска, круг — выбором ячейки
  beginSpellCast(RANGER_ID, ENSNARING_STRIKE, ENSNARE_CAST_ID);
  setSpellCastLevel(RANGER_ID, ENSNARING_STRIKE, CAST_LEVEL);

  const { effects } = collectTargetEffects(
    {
      spell: ENSNARING_STRIKE,
      entity: target,
      spellSaveDC: RANGER_SAVE_DC,
      casterId,
    },
    saveOutcome(false, { ability: 'strength', dc: RANGER_SAVE_DC }),
    new Map(),
  );

  target.activeEffects = effects;

  return { target, effect: effects[0] };
}

describe('эффект заклинания со спасброском знает заклинателя', () => {
  it('«Опутывающий удар»: каст, круг, наложивший и числа заклинателя', async () => {
    const { effect } = await castEnsnaringStrike(RANGER_ID);

    assert.equal(effect.castId, ENSNARE_CAST_ID, 'каст с концентрацией');
    assert.equal(effect.castLevel, CAST_LEVEL, 'круг каста');
    assert.equal(effect.sourceActorId, RANGER_ID, 'наложивший');

    assert.equal(
      effect.recurringDamage.damageParts[0].formula,
      `${CAST_LEVEL}d6@dmg.piercing`,
      'круг ячейки подставлен в урон начала хода',
    );

    assert.equal(
      effect.escape.check.dc,
      RANGER_SAVE_DC,
      '«вырваться» — против Сл заклинателя',
    );
  });

  it('смена концентрации снимает эффект с цели', async () => {
    const { target } = await castEnsnaringStrike(RANGER_ID);
    const system = new engine.Dnd5eVttSystem();

    const result = system.removeCastEffects(
      target,
      RANGER_ID,
      new Set([ENSNARE_CAST_ID]),
    );

    assert.equal(result.changed, true);
    assert.equal(target.activeEffects.length, 0);
  });

  it('«Рассеивание магии» снимает эффект по кругу каста', async () => {
    /**
     * Рассеивание до заданного круга по цели с «Опутанным».
     *
     * @param {number} maxLevel - до какого круга рассеивает
     * @returns {Promise<string[]>} что осталось на цели
     */
    async function dispelUpTo(maxLevel) {
      const { target } = await castEnsnaringStrike(RANGER_ID);

      const dispel = createEffect('Рассеивание магии', {
        triggers: [
          {
            id: 'trigger_dispel',
            event: 'applied',
            actions: [{ type: 'dispel', maxLevel }],
          },
        ],
      });

      engine.applyTriggerEffectActions(
        target,
        {
          effect: dispel,
          trigger: dispel.triggers[0],
          ambient: false,
          instance: true,
          scope: dispel.id,
        },
        false,
      );

      return target.activeEffects.map((effect) => effect.name);
    }

    assert.equal(
      (await dispelUpTo(CAST_LEVEL)).length,
      0,
      'каст круга рассеивания снят',
    );

    assert.equal(
      (await dispelUpTo(CAST_LEVEL - 1)).join(),
      'Опутанный',
      'каст выше круга рассеивания остаётся',
    );
  });

  it('урон в начале хода считается по кругу каста', async () => {
    const { target } = await castEnsnaringStrike(RANGER_ID);

    const result = withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(target, 'startOfTurn'),
    );

    assert.equal(result.damageTotal, CAST_LEVEL * 6, '3к6 на максимум');
  });

  it('без заклинателя эффект «ничей» — поэтому поле обязательно', async () => {
    const { target, effect } = await castEnsnaringStrike(undefined);

    assert.equal(effect.castId, undefined);
    assert.equal(effect.sourceActorId, undefined);

    assert.equal(
      engine.processTurnEffects(target, 'startOfTurn').damageTotal,
      0,
      'формула с «@castLevel» не катается',
    );
  });
});

/** Разбор заклинания, которому нужен заклинатель в контексте */
const RESOLUTION_CALLS = new Set([
  'resolveSpellDamage',
  'resolveSpellDamageWithParts',
]);

/** Поле заклинателя в контексте разбора */
const CASTER_FIELD = 'casterId';

/**
 * Текст скрипта исходника: у компонента — блок `script setup`.
 *
 * @param {string} path - путь к исходнику
 * @returns {string} код
 */
function readScript(path) {
  const text = readFileSync(path, 'utf8');

  return path.endsWith('.vue')
    ? (parse(text).descriptor.scriptSetup?.content ?? '')
    : text;
}

/**
 * Есть ли у объектного литерала поле заклинателя.
 *
 * @param {object} literal - узел литерала
 * @returns {boolean} `true`, если поле записано
 */
function hasCasterField(literal) {
  return literal.properties.some(
    (property) => property.name?.getText() === CASTER_FIELD,
  );
}

/**
 * Литерал контекста вызова: записан прямо в вызове либо переменной выше.
 *
 * @param {object} call - узел вызова
 * @param {object} sourceFile - разобранный исходник
 * @returns {object | undefined} литерал; нет — контекст пришёл параметром
 */
function findContextLiteral(call, sourceFile) {
  const [argument] = call.arguments;

  if (!argument) {
    return undefined;
  }

  if (typescript.isObjectLiteralExpression(argument)) {
    return argument;
  }

  if (!typescript.isIdentifier(argument)) {
    return undefined;
  }

  let literal;

  /** Ищет ближайшее выше объявление переменной контекста. */
  function visit(node) {
    if (
      typescript.isVariableDeclaration(node)
      && node.name.getText(sourceFile) === argument.text
      && node.initializer
      && typescript.isObjectLiteralExpression(node.initializer)
      && node.pos < call.pos
    ) {
      literal = node.initializer;
    }

    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);

  return literal;
}

it('каждый вызов разбора заклинания передаёт заклинателя', () => {
  const missing = [];

  let checked = 0;

  for (const path of listClientSources()) {
    const sourceFile = typescript.createSourceFile(
      path,
      readScript(path),
      typescript.ScriptTarget.Latest,
      true,
    );

    /** Проверяет вызовы разбора в узле и глубже. */
    function visit(node) {
      if (
        typescript.isCallExpression(node)
        && typescript.isIdentifier(node.expression)
        && RESOLUTION_CALLS.has(node.expression.text)
      ) {
        const literal = findContextLiteral(node, sourceFile);

        checked += 1;

        if (!literal || !hasCasterField(literal)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );

          missing.push(
            `${toSystemPath(path)}: вызов №${line + 1} блока скрипта — ${node.expression.text}`,
          );
        }
      }

      typescript.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.ok(checked > 0, 'вызовы разбора найдены');
  assert.deepEqual(missing, []);
});
