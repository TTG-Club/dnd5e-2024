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
 *
 * Область, исходящая от применившего, его самого не задевает: «Волна грома»
 * с краем куба по клетке заклинателя и «Дрожь» били по самому заклинателю
 * (допроверка 04.10, пункт 1). Признак считает движок по дальности источника,
 * обратное говорит только запись — отбором «с носителем».
 */

const CHOICE_PATH = 'src/client/composables/areaTargetChoice.ts';

const ACTIVE_ACTION_PATH = 'src/client/composables/effectActiveAction.ts';

/** Заклинание «на себя» из компендиума: «Волна грома» */
const SELF_SPELL = {
  id: 'thunderwave',
  name: 'Волна грома',
  level: 1,
  range: 0,
  rangeUnit: 'self',
  deliveryType: 'self',
};

/** Заклинание с дальностью в футах: «Огненный шар» */
const RANGED_SPELL = {
  id: 'fireball',
  name: 'Огненный шар',
  level: 3,
  range: 150,
  rangeUnit: 'ft',
  deliveryType: 'none',
};

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
 * @param {object} [options] - числа применившего и признак «от применившего»
 * @returns {object} план
 */
function plan(choice, options) {
  return engine.planAreaTargets(
    candidates(),
    choice,
    engine.resolveAreaCaster(CASTER, TOKENS),
    options,
  );
}

/**
 * План целей области, исходящей от применившего.
 *
 * @param {object | undefined} choice - правило выбора
 * @returns {object} план
 */
function planFromCaster(choice) {
  return plan(choice, { originatesFromCaster: true });
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

    assert.equal(plan({ count: '@castLevel - 1' }, { context }).request.max, 2);

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

describe('область исходит от применившего', () => {
  /**
   * Признак «область от применившего» у источника с такими полями.
   *
   * @param {object} source - поля дальности и вид источника
   * @returns {boolean} исходит ли область от применившего
   */
  function fromCaster(source) {
    return engine.areaOriginatesFromCaster({
      id: 'source',
      name: 'source',
      level: 0,
      ...source,
    });
  }

  it('заклинание: дальность «на себя» — единицей либо способом применения', () => {
    assert.equal(fromCaster(SELF_SPELL), true);
    assert.equal(fromCaster({ rangeUnit: 'self', deliveryType: 'none' }), true);
    assert.equal(fromCaster({ rangeUnit: 'ft', deliveryType: 'self' }), true);
    assert.equal(fromCaster(RANGED_SPELL), false);

    // Касание и незаполненная дальность заклинания — не «на себя»
    assert.equal(
      fromCaster({ range: 0, rangeUnit: 'ft', deliveryType: 'touch' }),
      false,
    );

    assert.equal(
      fromCaster({ range: 0, rangeUnit: 'ft', deliveryType: 'none' }),
      false,
    );
  });

  it('действие существа с областью — всегда от существа; кнопка эффекта — от носителя', () => {
    assert.equal(
      fromCaster({ rollSource: 'creatureAction', deliveryType: 'melee' }),
      true,
    );

    assert.equal(
      fromCaster({ rollSource: 'creatureAction', deliveryType: 'ranged' }),
      true,
    );

    // Кнопка «При действии»: источник — эффект без дальности
    assert.equal(fromCaster({ rollSource: 'effect' }), true);
  });

  it('применение умения и предмета: без дальности — от себя, с дальностью — нет', () => {
    const area = { shape: 'cone', size: 30 };

    const breath = engine.buildUseSpell({
      id: 'breath',
      name: 'Выдох',
      effects: [],
      rollSource: 'effect',
      area,
    });

    const flask = engine.buildUseSpell({
      id: 'flask',
      name: 'Алхимический огонь',
      effects: [],
      rollSource: 'item',
      range: 20,
      area,
    });

    assert.equal(engine.areaOriginatesFromCaster(breath), true);
    assert.equal(engine.areaOriginatesFromCaster(flask), false);
  });

  it('применивший внутри своей области — не цель', () => {
    const wave = planFromCaster(undefined);

    assert.equal(wave.kind, 'settled');
    assert.deepEqual(names(wave.targets), ['ally', 'goblin', 'ogre']);
  });

  it('запись включила применившего явно — он цель', () => {
    assert.deepEqual(names(planFromCaster({ target: 'allWithSelf' }).targets), [
      'ally',
      'caster',
      'goblin',
      'ogre',
    ]);

    assert.deepEqual(
      names(planFromCaster({ target: 'alliesWithSelf' }).targets),
      ['ally', 'caster'],
    );
  });

  it('правило без отбора применившего не включает: умолчание — не «явно»', () => {
    assert.deepEqual(names(planFromCaster({ mode: 'all' }).targets), [
      'ally',
      'goblin',
      'ogre',
    ]);

    assert.deepEqual(names(planFromCaster({ target: 'enemies' }).targets), [
      'goblin',
      'ogre',
    ]);
  });

  it('«до N» у области от себя применившего не предлагает', () => {
    const upTo = planFromCaster({ count: 6 });

    assert.equal(upTo.kind, 'choose');
    assert.equal(upTo.request.max, 3);

    assert.deepEqual(
      names(upTo.request.candidates.map((candidate) => candidate.entity)),
      ['ally', 'goblin', 'ogre'],
    );

    // Отметка «себя» отбрасывается: его не предлагали
    assert.deepEqual(engine.settleAreaChoice(upTo.request, ['caster']), []);

    // С явным «включая вас» он в списке
    assert.equal(
      planFromCaster({ count: 6, target: 'allWithSelf' }).request.max,
      4,
    );
  });

  it('умолчание «все» закрытой плашки применившего не возвращает', () => {
    const fallback = planFromCaster({ count: 1, fallback: 'all' });

    assert.deepEqual(names(fallback.fallbackTargets), [
      'ally',
      'goblin',
      'ogre',
    ]);
  });

  it('область на расстоянии и область без применившего — как раньше', () => {
    assert.deepEqual(
      names(plan(undefined, { originatesFromCaster: false }).targets),
      ['ally', 'caster', 'goblin', 'ogre'],
    );

    // Применившего нет среди сущностей разбора — убирать некого
    const noCaster = engine.planAreaTargets(
      candidates(),
      undefined,
      undefined,
      { originatesFromCaster: true },
    );

    assert.deepEqual(names(noCaster.targets), [
      'ally',
      'caster',
      'goblin',
      'ogre',
    ]);
  });

  it('мёртвые не цели и у области от себя', () => {
    assert.equal(
      planFromCaster(undefined).targets.some((entity) => entity.id === DEAD.id),
      false,
    );
  });
});

describe('общий разбор целей области', () => {
  /**
   * Настоящий разбор целей с плашкой-заглушкой.
   *
   * @param {object[]} effects - эффекты источника
   * @param {object} [source] - поля источника: дальность, вид источника
   * @returns {Promise<object>} итог разбора и свойства плашки
   */
  async function resolveTargets(effects, source = {}) {
    const prompts = [];
    const settled = [];

    const resolveAreaTargets = await loadHandler(
      CHOICE_PATH,
      'resolveAreaTargets',
      {
        areaOriginatesFromCaster: engine.areaOriginatesFromCaster,
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
          ...source,
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

  it('заклинание «на себя»: заклинатель в шаблоне — не цель', async () => {
    const { prompts, settled } = await resolveTargets(
      [createEffect('push', { effectTarget: 'target' })],
      SELF_SPELL,
    );

    assert.equal(prompts.length, 0);
    assert.deepEqual(settled, [['ally', 'goblin', 'ogre']]);
  });

  it('заклинание «на себя» с явным «включая вас» задевает заклинателя', async () => {
    const { settled } = await resolveTargets(
      [createEffect('feast', { areaChoice: { target: 'allWithSelf' } })],
      SELF_SPELL,
    );

    assert.deepEqual(settled, [['ally', 'caster', 'goblin', 'ogre']]);
  });

  it('заклинание с дальностью в футах, поставленное на себя, задевает заклинателя', async () => {
    const { settled } = await resolveTargets(
      [createEffect('plain')],
      RANGED_SPELL,
    );

    assert.deepEqual(settled, [['ally', 'caster', 'goblin', 'ogre']]);
  });

  it('действие существа с областью само существо не задевает', async () => {
    const breath = engine.buildPseudoSpell({
      id: 'creature-action-caster-breath',
      name: 'Морозное дыхание',
      rollSource: 'creatureAction',
      targetType: 'area',
      deliveryType: 'melee',
      areaOfEffect: { shape: 'cone', size: 30, unit: 'ft' },
    });

    const { settled } = await resolveTargets([], breath);

    assert.deepEqual(settled, [['ally', 'goblin', 'ogre']]);
  });

  it('«до N» у заклинания «на себя»: заклинателя в плашке нет', async () => {
    const { prompts } = await resolveTargets(
      [createEffect('slowed', { areaChoice: { count: 6 } })],
      SELF_SPELL,
    );

    assert.equal(prompts[0].props.count, 3);

    assert.deepEqual(
      prompts[0].props.candidates.map((candidate) => candidate.name).sort(),
      ['ally', 'goblin', 'ogre'],
    );
  });

  it('признак «от применившего» считает только общий разбор, по источнику', () => {
    const originUsers = listClientSources()
      .filter((path) =>
        /\bareaOriginatesFromCaster\(/u.test(readFileSync(path, 'utf8')),
      )
      .map(toSystemPath);

    // Все точки входа (заклинание персонажа и существа, действие существа,
    // применение с областью, «При действии») отдают источник общему разбору —
    // своего условия ни у одной нет
    assert.deepEqual(originUsers, [CHOICE_PATH]);

    assert.match(
      readFileSync(CHOICE_PATH, 'utf8'),
      /originatesFromCaster: areaOriginatesFromCaster\(input\.source\)/u,
    );

    // Кнопка «При действии» собирает источник сама: вид источника обязан
    // быть назван, иначе он читался бы как заклинание с дальностью
    assert.match(
      readFileSync(ACTIVE_ACTION_PATH, 'utf8'),
      /placeAreaTemplate\([\s\S]*?rollSource: 'effect',[\s\S]*?activeEffects: \[boundEffect\]/u,
    );
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
