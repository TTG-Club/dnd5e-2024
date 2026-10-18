import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  CELL_SIZE,
  createActor,
  createEffect,
  createToken,
  engine,
  GRID,
  withHp,
} from './_fixtures.mjs';

/**
 * Каталог: действия срабатываний (`docs/EFFECT_SCENARIOS.md`, раздел
 * «Действия срабатываний»).
 */

/**
 * Выполняет действия срабатывания на сущности.
 *
 * @param {object} entity - субъект (меняется)
 * @param {object} effect - эффект со срабатыванием
 * @param {boolean} passed - пройден ли спасбросок
 * @param {object} options - опции наложения
 * @returns {object} что сделало срабатывание
 */
function runActions(entity, effect, passed = false, options = {}) {
  return engine.applyTriggerEffectActions(
    entity,
    {
      effect,
      trigger: effect.triggers[0],
      ambient: false,
      instance: true,
      scope: effect.id,
    },
    passed,
    options,
  );
}

/**
 * Эффект с одним срабатыванием «в начале хода».
 *
 * @param {string} name - название эффекта
 * @param {object[]} actions - действия срабатывания
 * @param {object} overrides - остальные поля эффекта
 * @returns {object} эффект
 */
function effectWithActions(name, actions, overrides = {}) {
  return createEffect(name, {
    triggers: [{ id: 'trigger_main', event: 'turnStart', actions }],
    ...overrides,
  });
}

/**
 * «Изгнание»: эффект с флагом «убран со сцены» на несколько раундов.
 *
 * @param {number} remaining - сколько раундов осталось
 * @returns {object} эффект
 */
function banishment(remaining) {
  return createEffect('Изгнание', {
    flags: ['scene.offScene'],
    duration: { type: 'rounds', value: 10, remaining },
  });
}

/**
 * Ядро глазами сверки присутствия: что стоит на сцене, что убрано, и журнал
 * просьб убрать и вернуть фишку.
 *
 * @param {object} scene - что видит система
 * @param {object | null} scene.standing - фишка сущности на сцене
 * @param {object[]} scene.away - убранные фишки сущности
 * @param {boolean} scene.overlapped - вернуться удастся только поверх другой
 * @returns {object} контекст срабатывания и журнал
 */
function presenceContext({ standing = null, away = [], overlapped = false }) {
  const taken = [];
  const returned = [];

  return {
    taken,
    returned,
    context: {
      getSceneSurroundings: () =>
        standing
          ? { token: standing, gridSettings: GRID, neighbors: [], areas: [] }
          : null,
      getOffSceneTokens: () => away,
      takeTokenOffScene: (tokenId) => {
        taken.push(tokenId);

        return true;
      },
      returnTokenToScene: (tokenId) => {
        returned.push(tokenId);

        return { x: 0, y: 0, displaced: overlapped, overlapped };
      },
    },
  };
}

describe('каталог: действия срабатываний', () => {
  it('[A01] Защита от яда: снятие состояния убирает эффект, а не только метку', () => {
    const cure = effectWithActions('Защита от яда', [
      { type: 'removeCondition', conditionKey: 'poisoned' },
    ]);

    assert.match(authoredScenario(cure, 'spell'), /снимается состояние/);

    const poison = engine.buildConditionActiveEffect('poisoned');
    const hero = withHp(createActor, 20, { activeEffects: [cure, poison] });

    const result = runActions(hero, cure);

    assert.equal(result.applied, true);

    assert.equal(
      hero.activeEffects.some((effect) => effect.conditionKey === 'poisoned'),
      false,
      'состояние снято вместе с несущим его эффектом',
    );

    assert.ok(
      hero.activeEffects.some((effect) => effect.id === cure.id),
      'сам эффект остался',
    );
  });

  it('[A02] Заражение: запертое состояние снимает только его источник', () => {
    const disease = effectWithActions('Заражение', [
      { type: 'applyCondition', conditionKey: 'poisoned', locked: true },
    ]);

    const hero = withHp(createActor, 20, { activeEffects: [disease] });

    runActions(hero, disease);

    const applied = hero.activeEffects.find(
      (effect) => effect.conditionKey === 'poisoned',
    );

    assert.equal(applied?.conditionLocked, true);

    const cure = effectWithActions('Снятие', [
      { type: 'removeCondition', conditionKey: 'poisoned' },
    ]);

    hero.activeEffects = [...hero.activeEffects, cure];

    const cured = runActions(hero, cure);

    assert.equal(cured.applied, false, 'запертое состояние не снялось');

    assert.ok(
      hero.activeEffects.some((effect) => effect.conditionKey === 'poisoned'),
      'состояние на месте',
    );
  });

  it('[A03] Слово силы: Исцеление — полный запас хитов и снятие всех состояний', () => {
    // По правилам хиты становятся полными в момент наложения, а не на ходу:
    // окно предлагает «Хиты становятся» именно на этом событии
    const heal = createEffect('Слово силы: Исцеление', {
      effectTarget: 'target',
      triggers: [
        {
          id: 'trigger_main',
          event: 'applied',
          actions: [
            { type: 'setHp', value: 0, toMax: true },
            { type: 'removeCondition' },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(heal, 'spell'),
      /хиты восстанавливаются полностью/,
    );

    const stunned = engine.buildConditionActiveEffect('stunned');
    const hero = withHp(createActor, 40, { activeEffects: [heal, stunned] });

    hero.system.hitPoints.current = 3;

    runActions(hero, heal);

    assert.equal(engine.resolveEntityCurrentHp(hero), 40);

    assert.equal(
      hero.activeEffects.some((effect) => effect.conditionKey !== undefined),
      false,
      'состояний не осталось',
    );
  });

  it('[A04] Божественное слово: убить и вернуть к жизни', () => {
    const word = effectWithActions('Божественное слово', [{ type: 'kill' }]);
    const hero = withHp(createActor, 30, { activeEffects: [word] });

    runActions(hero, word);

    assert.equal(engine.resolveEntityCurrentHp(hero), 0);

    assert.ok(
      hero.activeEffects.some((effect) => effect.conditionKey === 'dead'),
      'метка «Мёртв» стоит',
    );

    const revive = effectWithActions('Воскрешение', [
      { type: 'revive', full: true },
    ]);

    hero.activeEffects = [...hero.activeEffects, revive];

    runActions(hero, revive);

    assert.equal(engine.resolveEntityCurrentHp(hero), 30);

    assert.equal(
      hero.activeEffects.some((effect) => effect.conditionKey === 'dead'),
      false,
      'метка «Мёртв» снята',
    );
  });

  it('[A05] Временные хиты: «поставить» берёт большее, «потратить» уменьшает', () => {
    const shield = effectWithActions('Ложная жизнь', [
      { type: 'tempHp', amount: '5' },
    ]);

    const hero = withHp(createActor, 20, { activeEffects: [shield] });

    hero.system.hitPoints.temp = 8;

    runActions(hero, shield);

    assert.equal(
      engine.resolveEntityTempHp(hero),
      8,
      'временные хиты не складываются — осталось большее',
    );

    const spend = effectWithActions('Расход щита', [
      { type: 'tempHp', amount: '3', mode: 'spend' },
    ]);

    hero.activeEffects = [...hero.activeEffects, spend];

    runActions(hero, spend);

    assert.equal(engine.resolveEntityTempHp(hero), 5);
  });

  it('[A06] Рассеивание магии: снимает касты до круга и заканчивает их', () => {
    const dispel = effectWithActions('Рассеивание магии', [
      { type: 'dispel', maxLevel: 3 },
    ]);

    assert.match(
      authoredScenario(dispel, 'spell'),
      /рассеиваются заклинания до круга 3/,
    );

    const weak = createEffect('Замедление', {
      castId: 'cast_slow',
      castLevel: 3,
    });

    const strong = createEffect('Удержание чудовища', {
      castId: 'cast_hold',
      castLevel: 5,
    });

    const hero = withHp(createActor, 20, {
      activeEffects: [dispel, weak, strong],
    });

    const ended = [];

    runActions(hero, dispel, false, {
      endCast: (effect) => ended.push(effect.castId),
    });

    assert.deepEqual(ended, ['cast_slow'], 'закончен только каст до 3 круга');

    assert.deepEqual(
      hero.activeEffects.map((effect) => effect.name),
      ['Рассеивание магии', 'Удержание чудовища'],
      'сильное заклинание осталось',
    );
  });

  it('[A07] Стихийное извержение: возвращает ячейку и ресурс листа', () => {
    const slot = effectWithActions('Вернуть ячейку', [
      { type: 'restore', what: 'spellSlot', level: 2 },
    ]);

    const hero = withHp(createActor, 20, { activeEffects: [slot] });

    hero.system.spellSlotsUsed = [1, 2, 0, 0, 0, 0, 0, 0, 0];

    runActions(hero, slot);

    assert.equal(
      hero.system.spellSlotsUsed[1],
      1,
      'ячейка второго круга вернулась',
    );

    const counter = effectWithActions('Вернуть ресурс', [
      { type: 'restore', what: 'counter', counter: 'rage' },
    ]);

    hero.activeEffects = [...hero.activeEffects, counter];

    hero.system.classCounters = [{ counterKey: 'rage', current: 0, max: 3 }];

    runActions(hero, counter);

    assert.equal(hero.system.classCounters[0].current, 1);
  });

  it('[A08] Совершенство: вдохновение и роняние предметов', () => {
    const gift = effectWithActions('Совершенство', [
      { type: 'grantInspiration' },
      { type: 'dropHeld' },
    ]);

    const hero = withHp(createActor, 20, { activeEffects: [gift] });

    hero.equipment = [
      { id: 'item_sword', name: 'Меч', type: 'weapon', equipped: true },
      { id: 'item_rope', name: 'Верёвка', type: 'equipment', equipped: false },
      {
        id: 'item_mail',
        name: 'Кольчуга',
        type: 'equipment',
        equipmentCategory: 'heavy',
        equipped: true,
      },
      {
        id: 'item_wand',
        name: 'Жезл',
        type: 'equipment',
        equipmentCategory: 'wand',
        equipped: true,
      },
    ];

    runActions(hero, gift);

    assert.equal(hero.system.inspiration, true);
    assert.equal(hero.equipment[0].equipped, false, 'оружие выронено');
    assert.equal(hero.equipment[1].equipped, false);
    assert.equal(hero.equipment[2].equipped, true, 'доспех остался надетым');
    assert.equal(hero.equipment[3].equipped, false, 'жезл выронен');
  });

  it('[A09] Изгоняющая кара: прерывает концентрацию получателя, свой эффект остаётся', () => {
    const smite = effectWithActions('Изгоняющая кара', [
      { type: 'endCast', whose: 'recipient' },
    ]);

    assert.match(
      authoredScenario(smite, 'spell'),
      /каст получателя заканчивается/,
    );

    const mark = createEffect('Концентрация', {
      castId: 'cast_target',
      concentration: true,
    });

    const victim = withHp(createActor, 20, { activeEffects: [smite, mark] });

    const ended = [];

    const result = runActions(victim, smite, false, {
      endCast: (effect) => ended.push(effect.castId),
    });

    assert.deepEqual(ended, ['cast_target']);
    assert.equal(result.removes, false, 'свой эффект не снимается');

    assert.ok(
      victim.activeEffects.some((effect) => effect.id === smite.id),
      'эффект остался на носителе',
    );
  });

  it('[A10] Гейт спасброска работает у новых действий', () => {
    const smite = effectWithActions('Сглаз', [
      { type: 'grantInspiration', on: 'saved' },
      { type: 'kill', on: 'failed' },
    ]);

    const lucky = withHp(createActor, 20, { activeEffects: [smite] });

    runActions(lucky, smite, true);

    assert.equal(lucky.system.inspiration, true, 'успех дал вдохновение');
    assert.equal(engine.resolveEntityCurrentHp(lucky), 20, 'успех не убил');

    const unlucky = withHp(createActor, 20, {
      id: 'actor_unlucky',
      activeEffects: [smite],
    });

    runActions(unlucky, smite, false);

    assert.equal(
      unlucky.system.inspiration,
      false,
      'провал не дал вдохновения',
    );

    assert.equal(engine.resolveEntityCurrentHp(unlucky), 0, 'провал убил');
  });

  it('[A11] Свобода перемещения: подавление состояния обратимо', () => {
    const freedom = createEffect('Свобода перемещения', {
      suppressConditions: ['restrained'],
    });

    const restrained = engine.buildConditionActiveEffect('restrained');

    const hero = withHp(createActor, 20, {
      activeEffects: [freedom, restrained],
    });

    assert.equal(
      engine.resolveActorStats(hero).movement.walk > 0,
      true,
      'пока свобода действует, Опутанный не отнимает скорость',
    );

    assert.ok(
      hero.activeEffects.some((effect) => effect.conditionKey === 'restrained'),
      'состояние осталось на носителе — подавление не снятие',
    );

    hero.activeEffects = hero.activeEffects.filter(
      (effect) => effect.id !== freedom.id,
    );

    assert.equal(
      engine.resolveActorStats(hero).movement.walk,
      0,
      'свобода кончилась — состояние снова действует',
    );
  });

  // Пробелы: действиям нужны события и окна, которых ещё нет. Заводить их в
  // окне нельзя — они молча ничего не делали бы
  it.todo('[A14] Действие «наложить другой эффект»');
  it.todo('[A15] Перенос эффекта на новую цель');
  it.todo('[A16] Переброс спасброска');
  it.todo('[A17] Принять урон вместо другого');

  it('[A12] Волна грома: отталкивает получателя от наложившего', () => {
    const wave = effectWithActions('Волна грома', [
      { type: 'move', kind: 'push', distance: 10 },
    ]);

    assert.match(authoredScenario(wave, 'spell'), /отталкивает на 10 фт/);

    wave.sourceActorId = 'actor_caster';

    const victim = withHp(createActor, 20, {
      id: 'actor_victim',
      activeEffects: [wave],
    });

    const moves = [];

    const surroundings = {
      token: createToken(victim.id, 2, 0),
      gridSettings: GRID,
      neighbors: [
        { token: createToken('actor_caster', 0, 0), entity: createActor() },
      ],
    };

    runActions(victim, wave, false, {
      surroundings,
      moveToken: (tokenId, position) => moves.push({ tokenId, position }),
    });

    assert.equal(moves.length, 1, 'ядро просят подвинуть один раз');

    assert.ok(
      moves[0].position.x > surroundings.token.x,
      'толкнуло прочь от наложившего',
    );

    assert.equal(moves[0].position.y, surroundings.token.y, 'по прямой');
  });

  it('[A12d] Толчок наискось ставит фишку в клетку, а не мимо сетки', () => {
    // «Телекинетический толчок» на 5 футов по диагонали: по прямой между
    // центрами это 0,7 клетки по каждой оси — фишка вставала мимо сетки
    const scene = {
      target: createToken('actor_victim', 3, 3),
      origin: createToken('actor_caster', 2, 2),
      gridSettings: GRID,
    };

    assert.deepEqual(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'push', distance: 5 },
        scene,
      ),
      { x: 4 * CELL_SIZE, y: 4 * CELL_SIZE },
      '5 футов наискось — одна клетка по диагонали',
    );

    assert.deepEqual(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'push', distance: 10 },
        scene,
      ),
      { x: 5 * CELL_SIZE, y: 5 * CELL_SIZE },
      '10 футов наискось — две клетки по диагонали',
    );

    assert.deepEqual(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'pull', distance: 5 },
        { ...scene, target: createToken('actor_victim', 5, 4) },
      ),
      { x: 4 * CELL_SIZE, y: 3 * CELL_SIZE },
      'притягивание под углом тоже попадает в клетку',
    );

    // Прямой толчок прежний, а счёт по обычной длине диагональ не растягивает
    assert.deepEqual(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'push', distance: 10 },
        { ...scene, target: createToken('actor_victim', 4, 2) },
      ),
      { x: 6 * CELL_SIZE, y: 2 * CELL_SIZE },
    );

    assert.deepEqual(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'push', distance: 10 },
        { ...scene, gridSettings: { ...GRID, diagonalRule: 'euclidean' } },
      ),
      { x: 4 * CELL_SIZE, y: 4 * CELL_SIZE },
      'по правилу обычной длины 10 футов наискось — 1,4 клетки, то есть одна',
    );
  });

  it('[A12b] Притягивание не проносит цель сквозь того, кто тянет', () => {
    const hook = effectWithActions('Ледяной нож', [
      { type: 'move', kind: 'pull', distance: 100 },
    ]);

    hook.sourceActorId = 'actor_caster';

    const victim = withHp(createActor, 20, {
      id: 'actor_victim',
      activeEffects: [hook],
    });

    const moves = [];

    const surroundings = {
      token: createToken(victim.id, 2, 0),
      gridSettings: GRID,
      neighbors: [
        { token: createToken('actor_caster', 0, 0), entity: createActor() },
      ],
    };

    runActions(victim, hook, false, {
      surroundings,
      moveToken: (tokenId, position) => moves.push({ tokenId, position }),
    });

    assert.ok(
      moves[0].position.x >= createToken('actor_caster', 0, 0).x,
      'дальше центра тянущего не тянет',
    );
  });

  it('[A12c] Без сцены или без ядра действие молчит', () => {
    const wave = effectWithActions('Волна грома', [
      { type: 'move', kind: 'push', distance: 10 },
    ]);

    const victim = withHp(createActor, 20, { activeEffects: [wave] });
    const moves = [];

    runActions(victim, wave, false, {
      moveToken: (tokenId, position) => moves.push({ tokenId, position }),
    });

    assert.deepEqual(moves, [], 'без сцены двигать нечего');

    runActions(victim, wave, false, {
      surroundings: {
        token: createToken(victim.id, 2, 0),
        gridSettings: GRID,
        neighbors: [],
      },
    });

    assert.deepEqual(moves, [], 'старое ядро фишку не двигает');
  });

  it('[A12e] Перенос проходит сквозь стены, толчок — нет', () => {
    /**
     * С какими настройками система просит ядро подвинуть фишку.
     *
     * @param {string} kind - вид перемещения
     * @returns {object | undefined} настройки перемещения
     */
    const moveOptionsOf = (kind) => {
      const effect = effectWithActions('Перемещение', [
        { type: 'move', kind, distance: 10 },
      ]);

      effect.sourceActorId = 'actor_caster';

      const victim = withHp(createActor, 20, {
        id: 'actor_victim',
        activeEffects: [effect],
      });

      const asked = [];

      runActions(victim, effect, false, {
        surroundings: {
          token: createToken(victim.id, 4, 0),
          gridSettings: GRID,
          neighbors: [
            { token: createToken('actor_caster', 0, 0), entity: createActor() },
          ],
        },
        moveToken: (tokenId, position, options) => asked.push(options),
      });

      return asked[0];
    };

    assert.deepEqual(moveOptionsOf('teleport'), { ignoreWalls: true });
    assert.deepEqual(moveOptionsOf('bring'), { ignoreWalls: true });

    assert.deepEqual(moveOptionsOf('push'), {}, 'толчок стена держит');
    assert.deepEqual(moveOptionsOf('pull'), {}, 'притягивание тоже');
  });

  it('[A13] Изгнание: эффект с флагом убирает фишку со сцены', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 20, { activeEffects: [banishment(10)] });
    const standing = createToken(hero.id, 2, 2);
    const { context, taken, returned } = presenceContext({ standing });

    system.decrementEffectDurations(hero, context);

    assert.deepEqual(taken, [standing.id], 'ядро просят убрать фишку');
    assert.deepEqual(returned, [], 'возвращать нечего');
  });

  it('[A13b] Срок изгнания вышел — фишка возвращается', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 20, { activeEffects: [banishment(1)] });
    const away = createToken(hero.id, 2, 2);
    const { context, taken, returned } = presenceContext({ away: [away] });

    const result = system.decrementEffectDurations(hero, context);

    assert.equal(hero.activeEffects.length, 0, 'эффект снят по сроку');
    assert.deepEqual(returned, [away.id], 'ядро просят вернуть фишку');
    assert.deepEqual(taken, []);

    assert.doesNotMatch(
      result.chatSummary ?? '',
      /поверх/,
      'встала на своё место — сообщать не о чем',
    );
  });

  it('[A13c] Вернуться некуда — фишка встаёт поверх, об этом пишут в чат', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 20, { activeEffects: [banishment(1)] });

    const { context } = presenceContext({
      away: [createToken(hero.id, 2, 2)],
      overlapped: true,
    });

    const result = system.decrementEffectDurations(hero, context);

    assert.match(result.chatSummary, new RegExp(hero.name));
    assert.match(result.chatSummary, /поверх другой/);
  });

  it('[A13d] Без ядра изгнание фишку не трогает', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 20, { activeEffects: [banishment(10)] });

    assert.deepEqual(system.decrementEffectDurations(hero, {}), {
      changed: true,
      chatSummary: null,
    });
  });

  it('[A13e] Изгнание вписали в лист руками — фишка уходит сразу', () => {
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 20, { activeEffects: [banishment(10)] });
    const standing = createToken(hero.id, 2, 2);
    const { context, taken } = presenceContext({ standing });

    // Ядро зовёт хук после записи листа: срока и ходов тут нет
    const result = system.settleEntityChange(hero, context);

    assert.deepEqual(taken, [standing.id]);

    assert.deepEqual(
      result,
      { changed: false, chatSummary: null },
      'сущность хук не меняет — запись не идёт по кругу',
    );

    hero.activeEffects = [];

    const away = presenceContext({ away: [standing] });

    system.settleEntityChange(hero, away.context);

    assert.deepEqual(away.returned, [standing.id], 'стёрли — вернулась');
  });

  it('[A13f] Мастер возвращает фишку меткой — изгнание снимается', () => {
    const system = new engine.Dnd5eVttSystem();

    const blessing = createEffect('Благословение');

    const hero = withHp(createActor, 20, {
      activeEffects: [banishment(10), blessing],
    });

    const result = system.releaseOffSceneToken(hero);

    assert.equal(result.changed, true);
    assert.match(result.chatSummary, new RegExp(hero.name));
    assert.match(result.chatSummary, /Изгнание/);

    assert.deepEqual(
      hero.activeEffects.map((effect) => effect.name),
      ['Благословение'],
      'остальные эффекты на месте',
    );

    assert.deepEqual(
      system.releaseOffSceneToken(hero),
      { changed: false, chatSummary: null },
      'снимать больше нечего',
    );
  });
});
