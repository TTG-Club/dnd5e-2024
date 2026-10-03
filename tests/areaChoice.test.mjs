import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  CELL_SIZE,
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Цели области: кого накрыл шаблон и кого из них задеть.
 *
 * «Замедление» по правилу — до шести существ на выбор в кубе 40 футов; раньше
 * область накрывала всех, включая заклинателя (живая проверка 03.10, Б/З5).
 * Правило выбора — поле эффекта `areaChoice`, один разбор на заклинание,
 * действие существа, применение с областью и кнопку «При действии» с
 * шаблоном. Без правила задеты все в шаблоне, кроме мёртвых (А/З7).
 */

const CHOICE_PATH = 'src/client/composables/areaTargetChoice.ts';

/** Центр шаблона, пикс.: середина клетки (5, 5) */
const TEMPLATE_CENTER = 5.5 * CELL_SIZE;

/** Радиус шаблона в клетках */
const TEMPLATE_RADIUS_CELLS = 3;

/** Круг радиусом три клетки с центром в клетке (5, 5) */
const TEMPLATE = {
  id: 'template_circle',
  type: 'circle',
  originX: TEMPLATE_CENTER,
  originY: TEMPLATE_CENTER,
  targetX: TEMPLATE_CENTER + TEMPLATE_RADIUS_CELLS * CELL_SIZE,
  targetY: TEMPLATE_CENTER,
  color: 0xffffff,
  createdBy: 'player',
};

/**
 * Персонаж после нормализации: отношение фишки — «дружественный».
 *
 * @param {string} id - персонаж
 * @returns {object} персонаж
 */
function hero(id) {
  const actor = createActor({ id, name: id });

  engine.normalizeActor(actor);

  return actor;
}

/**
 * Существо после нормализации: отношение фишки — «враждебный».
 *
 * @param {string} id - существо
 * @param {number} hitPoints - текущие хиты
 * @returns {object} существо
 */
function monster(id, hitPoints = 10) {
  const creature = withHp(createCreature, hitPoints, { id, name: id }, 10);

  new engine.Dnd5eVttSystem().normalizeCreature(creature);

  return creature;
}

/** Заклинатель и союзник в области, трое врагов в области, один — вне её */
const CASTER = hero('caster');
const ALLY = hero('ally');
const OGRE = monster('ogre');
const GOBLIN = monster('goblin');
const DEAD = monster('dead', 0);
const FAR = monster('far');

const ENTITIES = [CASTER, ALLY, OGRE, GOBLIN, DEAD, FAR];

const TOKENS = [
  createToken(CASTER.id, 5, 5),
  createToken(ALLY.id, 4, 5),
  createToken(OGRE.id, 6, 5),
  createToken(GOBLIN.id, 5, 6),
  // Вторая фишка того же гоблина: в списке он один
  createToken(GOBLIN.id, 5, 4, { id: 'token_goblin_copy' }),
  createToken(DEAD.id, 6, 6),
  createToken(FAR.id, 20, 20),
];

/**
 * Накрытые шаблоном.
 *
 * @returns {object[]} кандидаты
 */
function candidates() {
  return engine.listAreaCandidates(TEMPLATE, TOKENS, CELL_SIZE, ENTITIES);
}

/**
 * Имена сущностей.
 *
 * @param {object[]} entities - сущности
 * @returns {string[]} имена
 */
function names(entities) {
  return entities.map((entity) => entity.name).sort();
}

/**
 * План целей области по правилу.
 *
 * @param {object | undefined} choice - правило выбора
 * @param {object} [context] - числа применившего
 * @returns {object} план
 */
function plan(choice, context) {
  return engine.planAreaTargets(
    candidates(),
    choice,
    engine.resolveAreaCaster(CASTER, TOKENS),
    context,
  );
}

describe('кого накрыл шаблон', () => {
  it('мёртвое существо область не задевает; сущность с двумя фишками — одна', () => {
    assert.equal(engine.isAreaTarget(DEAD), false, 'метка «Мёртв» стоит');

    assert.deepEqual(names(candidates().map((candidate) => candidate.entity)), [
      'ally',
      'caster',
      'goblin',
      'ogre',
    ]);
  });

  it('без правила задеты все накрытые — как раньше', () => {
    const settled = plan(undefined);

    assert.equal(settled.kind, 'settled');

    assert.deepEqual(names(settled.targets), [
      'ally',
      'caster',
      'goblin',
      'ogre',
    ]);
  });
});

describe('правило «на выбор из тех, кто в области»', () => {
  it('«Замедление»: до шести на выбор — применивший отмечает, можно никого', () => {
    const slow = plan({ count: 6 });

    assert.equal(slow.kind, 'choose');

    // Допущенных четверо — больше и не отметить
    assert.equal(slow.request.max, 4);
    assert.equal(slow.request.min, 0);
    assert.equal(slow.fallbackTargets.length, 0, 'закрытая плашка — никого');

    assert.deepEqual(
      names(engine.settleAreaChoice(slow.request, ['ogre', 'goblin'])),
      ['goblin', 'ogre'],
    );
  });

  it('предел меньше числа накрытых — лишняя и чужая отметка отбрасываются', () => {
    const two = plan({ count: 2 });

    assert.equal(two.request.max, 2);

    assert.equal(
      engine.settleAreaChoice(two.request, ['ally', 'ogre', 'goblin', 'far'])
        .length,
      2,
    );

    assert.deepEqual(engine.settleAreaChoice(two.request, ['far']), []);
  });

  it('«ровно N»: меньше не подтвердить; накрытых меньше — все они', () => {
    const exactlyTwo = plan({ count: 2, mode: 'exactly' });

    assert.equal(exactlyTwo.request.min, 2);
    assert.equal(exactlyTwo.request.max, 2);

    const exactlyTen = plan({ count: 10, mode: 'exactly' });

    assert.equal(exactlyTen.request.min, 4);
  });

  it('«все» с отбором: только враги, без вопроса', () => {
    const enemies = plan({ target: 'enemies' });

    assert.equal(enemies.kind, 'settled');
    assert.deepEqual(names(enemies.targets), ['goblin', 'ogre']);
  });

  it('отбор: «все» — без применившего, «союзники с носителем» — с ним', () => {
    assert.deepEqual(names(plan({ target: 'all' }).targets), [
      'ally',
      'goblin',
      'ogre',
    ]);

    assert.deepEqual(names(plan({ target: 'alliesWithSelf' }).targets), [
      'ally',
      'caster',
    ]);

    assert.deepEqual(names(plan({ target: 'allies' }).targets), ['ally']);
  });

  it('закрытая плашка с умолчанием «все» задевает всех допущенных', () => {
    const fallback = plan({ count: 1, target: 'enemies', fallback: 'all' });

    assert.equal(fallback.kind, 'choose');
    assert.deepEqual(names(fallback.fallbackTargets), ['goblin', 'ogre']);
  });

  it('предел формулой считается от чисел применившего', () => {
    const context = {
      ...engine.buildResolvedFormulaContext(CASTER, { ambientEffects: [] }),
      castLevel: 3,
    };

    assert.equal(
      engine.resolveAreaChoiceCount({ count: '@castLevel - 1' }, context),
      2,
    );

    assert.equal(plan({ count: '@castLevel - 1' }, context).request.max, 2);

    // Формула не посчиталась — предела нет, отметить можно всех допущенных
    assert.equal(
      engine.resolveAreaChoiceCount({ count: '@castLevel - 1' }),
      undefined,
    );
  });

  it('правило несёт эффект: схема эффекта его хранит, негодное значение — убирает', () => {
    const slowed = createEffect('slowed', {
      effectTarget: 'target',
      areaChoice: { count: 6, target: 'allWithSelf', fallback: 'none' },
    });

    assert.deepEqual(
      engine.ActiveEffectSchema.parse(slowed).areaChoice,
      slowed.areaChoice,
    );

    assert.deepEqual(engine.findAreaChoice([createEffect('x'), slowed]), {
      count: 6,
      target: 'allWithSelf',
      fallback: 'none',
    });

    // Негодные значения полей убираются: правило остаётся пустым — «все»
    assert.equal(
      JSON.stringify(
        engine.ActiveEffectSchema.parse({
          ...slowed,
          areaChoice: { count: 0, mode: 'some', target: 'pets' },
        }).areaChoice,
      ),
      '{}',
    );

    assert.equal(engine.findAreaChoice([createEffect('x')]), undefined);
  });
});

describe('общий разбор целей области', () => {
  /**
   * Настоящий разбор целей с плашкой-заглушкой.
   *
   * @param {object[]} effects - эффекты источника
   * @returns {Promise<object>} итог разбора и свойства плашки
   */
  async function resolveTargets(effects) {
    const prompts = [];
    const settled = [];

    const resolveAreaTargets = await loadHandler(
      CHOICE_PATH,
      'resolveAreaTargets',
      {
        findAreaChoice: engine.findAreaChoice,
        listAreaCandidates: engine.listAreaCandidates,
        planAreaTargets: engine.planAreaTargets,
        resolveAreaCaster: engine.resolveAreaCaster,
        settleAreaChoice: engine.settleAreaChoice,
        toChoiceCandidatePayload: engine.toChoiceCandidatePayload,
        buildChoiceContext: () => undefined,
        EFFECT_TARGET_PROMPT_MODAL: 'EffectTargetPromptModal',
        useModalManager: () => ({
          openModal: (name, props) => {
            prompts.push({ name, props });

            return 'prompt';
          },
        }),
      },
    );

    resolveAreaTargets(
      {
        source: {
          id: 'slow',
          name: 'Замедление',
          level: 3,
          activeEffects: effects,
        },
        casterId: CASTER.id,
        template: TEMPLATE,
        tokens: TOKENS,
        gridSize: CELL_SIZE,
        entities: ENTITIES,
      },
      (targets) => settled.push(names(targets)),
    );

    return { prompts, settled };
  }

  it('без правила цели известны сразу, плашки нет', async () => {
    const { prompts, settled } = await resolveTargets([createEffect('plain')]);

    assert.equal(prompts.length, 0);
    assert.deepEqual(settled, [['ally', 'caster', 'goblin', 'ogre']]);
  });

  it('с правилом применивший отмечает цели плашкой выбора цели', async () => {
    const { prompts, settled } = await resolveTargets([
      createEffect('slowed', { areaChoice: { count: 6 } }),
    ]);

    assert.deepEqual(settled, [], 'до ответа цели не разбираются');
    assert.equal(prompts[0].name, 'EffectTargetPromptModal');

    const { props } = prompts[0];

    assert.equal(props.sourceName, 'Замедление');
    assert.equal(props.count, 4);
    assert.equal(props.minCount, 0);
    assert.equal(props.optional, true);

    assert.deepEqual(
      props.candidates.map((candidate) => candidate.name).sort(),
      ['ally', 'caster', 'goblin', 'ogre'],
    );

    props.onConfirm(['ogre', 'goblin']);
    assert.deepEqual(settled, [['goblin', 'ogre']]);
  });

  it('закрытая плашка — умолчание правила', async () => {
    const { prompts, settled } = await resolveTargets([
      createEffect('slowed', { areaChoice: { count: 6 } }),
    ]);

    prompts[0].props.onCancel();
    assert.deepEqual(settled, [[]]);
  });

  it('шаблон в цели превращает только общий разбор', () => {
    const geometryUsers = listClientSources()
      .filter((path) =>
        /\bfindTokensInTemplate\(/u.test(readFileSync(path, 'utf8')),
      )
      .map(toSystemPath);

    assert.deepEqual(geometryUsers, []);

    const resolverUsers = listClientSources()
      .filter((path) =>
        /\b(?:resolveAreaTargets|chooseAreaTargets)\(/u.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map(toSystemPath)
      .sort();

    assert.deepEqual(resolverUsers, [
      'src/client/composables/areaTargetChoice.ts',
      'src/client/composables/areaTemplateTargets.ts',
      'src/client/composables/useSpellDamageWithParts.ts',
      'src/client/composables/useSpellResolution.ts',
    ]);
  });
});
