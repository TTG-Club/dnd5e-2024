import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  MAX_ROLL,
  MIN_ROLL,
  strikeEntity,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: события срабатываний (`docs/EFFECT_SCENARIOS.md`, раздел
 * «События»).
 *
 * Правило раздела: событие без данных не запускается вхолостую. Часть условия,
 * для которой на этом событии данных нет, НЕ выполняется — срабатывание
 * молчит, а не бьёт всегда.
 */

/** Кто наложил эффект в сценариях раздела */
const SOURCE_ID = 'actor_source';

/**
 * Записывает сущности новый запас хитов боевым снимком — как это делает окно
 * лечения.
 *
 * @param {object} system - система сервера
 * @param {object} entity - сущность в мире (мутируется)
 * @param {number} current - новые текущие хиты
 * @param {number} temp - новые временные хиты
 * @param {object} context - возможности ядра
 * @returns {object} исход записи снимка
 */
function settleHitPoints(system, entity, current, temp, context = {}) {
  const copy = structuredClone(entity);

  copy.system.hitPoints = { ...copy.system.hitPoints, current, temp };

  return system.settleCombatState(
    entity,
    engine.pickCombatState(copy),
    context,
  );
}

/**
 * Эффект с одним срабатыванием, ставящим отметку.
 *
 * @param {string} name - название
 * @param {object} trigger - поля срабатывания
 * @returns {object} эффект
 */
function markingEffect(name, trigger) {
  return createEffect(name, {
    triggers: [
      {
        id: `trigger_${name}`,
        actions: [{ type: 'applyTag', tag: 'fired' }],
        ...trigger,
      },
    ],
  });
}

/**
 * Стоит ли на сущности отметка срабатывания.
 *
 * @param {object} entity - сущность
 * @returns {boolean} сработало ли
 */
function hasFired(entity) {
  return (entity.activeEffects ?? []).some((effect) => effect.tag === 'fired');
}

describe('каталог: события срабатываний', () => {
  it('[E01] Второе дыхание: срабатывание «когда носителя лечат»', () => {
    const watch = markingEffect('Печать жизни', { event: 'healed' });
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 10, { activeEffects: [watch] }, 30);

    settleHitPoints(system, hero, 20, 0);

    assert.equal(hasFired(hero), true, 'хиты поднялись — событие пришло');

    const idle = withHp(createActor, 20, { activeEffects: [watch] }, 30);

    settleHitPoints(system, idle, 12, 0);

    assert.equal(hasFired(idle), false, 'падение хитов лечением не считается');
  });

  it('[E02] Временные хиты лечением не считаются', () => {
    const watch = markingEffect('Печать жизни', { event: 'healed' });
    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 10, { activeEffects: [watch] }, 30);

    settleHitPoints(system, hero, 10, 8);

    assert.equal(
      hasFired(hero),
      false,
      'правила отделяют щит из временных хитов от лечения',
    );
  });

  it('[E03] Освобождение: срабатывание «когда снимается состояние»', () => {
    const system = new engine.Dnd5eVttSystem();

    const run = (conditionKey) => {
      const watch = markingEffect('Освобождение', {
        event: 'conditionLost',
        ...(conditionKey ? { conditionKey } : {}),
      });

      const restrained = engine.buildConditionActiveEffect('restrained');

      const hero = withHp(createActor, 30, {
        activeEffects: [watch, restrained],
      });

      const copy = structuredClone(hero);

      copy.activeEffects = copy.activeEffects.filter(
        (effect) => effect.id !== restrained.id,
      );

      system.settleCombatState(hero, engine.pickCombatState(copy));

      return hasFired(hero);
    };

    assert.equal(run(undefined), true, 'без ключа — любое снятое состояние');
    assert.equal(run('restrained'), true, 'ключ совпал');

    assert.equal(
      run('poisoned'),
      false,
      'срабатывание с ключом слушает только своё состояние',
    );
  });

  it('[E04] Кровавая жатва: «когда носитель сваливает цель»', () => {
    const harvest = markingEffect('Кровавая жатва', { event: 'downedOther' });
    const system = new engine.Dnd5eVttSystem();

    const slayer = withHp(createActor, 30, {
      id: SOURCE_ID,
      activeEffects: [harvest],
    });

    const victim = withHp(createCreature, 5, { id: 'creature_victim' });

    const result = withRandom([MIN_ROLL], () =>
      strikeEntity(system, victim, 10, 'slashing', {
        details: { critical: false, sourceId: SOURCE_ID },
        context: { getEntity: (id) => (id === SOURCE_ID ? slayer : undefined) },
      }),
    );

    assert.equal(engine.resolveEntityCurrentHp(victim), 0);

    assert.equal(
      hasFired(slayer),
      true,
      'событие пришло на эффектах свалившего, а не поверженного',
    );

    assert.equal(hasFired(victim), false);

    assert.deepEqual(
      result.related?.map((related) => related.entity.id),
      [SOURCE_ID],
      'правки свалившего уходят в мир «другой стороной»: снимок пишет '
        + 'поверженный, и без этого они остались бы в памяти сервера',
    );
  });

  it('[E05] Свалившего не знаем — событие молчит', () => {
    const harvest = markingEffect('Кровавая жатва', { event: 'downedOther' });
    const system = new engine.Dnd5eVttSystem();

    const slayer = withHp(createActor, 30, {
      id: SOURCE_ID,
      activeEffects: [harvest],
    });

    const victim = withHp(createCreature, 5, { id: 'creature_victim' });

    withRandom([MIN_ROLL], () =>
      strikeEntity(system, victim, 10, 'slashing', {
        details: { critical: false, sourceId: SOURCE_ID },
        context: {},
      }),
    );

    assert.equal(
      hasFired(slayer),
      false,
      'старое ядро сущностей не отдаёт — бить некого',
    );
  });

  it('[E06] Бросок на шанс: неудача не тратит «раз в ход»', () => {
    const spark = createEffect('Шальная искра', {
      triggers: [
        {
          id: 'trigger_spark',
          event: 'turnStart',
          chancePercent: 50,
          limit: { max: 1, per: 'turn' },
          actions: [{ type: 'applyTag', tag: 'fired' }],
        },
      ],
    });

    const hero = withHp(createActor, 30, { activeEffects: [spark] });

    const source = {
      effect: spark,
      trigger: spark.triggers[0],
      ambient: false,
      instance: true,
      scope: spark.id,
    };

    // 0.99 * 100 = 99 — больше 50, шанс не выпал
    assert.equal(
      withRandom([0.99], () => engine.admitTrigger(hero, source)),
      false,
      'шанс не выпал',
    );

    // Лимит цел: следующая попытка всё ещё возможна
    assert.equal(
      withRandom([0], () => engine.admitTrigger(hero, source)),
      true,
      'неудавшийся шанс «раз в ход» не потратил',
    );

    assert.equal(
      withRandom([0], () => engine.admitTrigger(hero, source)),
      false,
      'а сработавшее — потратило',
    );
  });

  it('[E07] «Атака попала» и «атака промахнулась» — части условия', () => {
    const landed = engine.writeTriggerCondition([{ kind: 'attackLanded' }]);
    const missed = engine.writeTriggerCondition([{ kind: 'attackMissed' }]);

    const hero = createActor();

    const holds = (condition, attack) =>
      engine.isTriggerConditionMet(
        hero,
        { condition },
        attack ? { attack } : {},
      );

    assert.equal(holds(landed, { kinds: [], landed: true }), true);
    assert.equal(holds(missed, { kinds: [], landed: true }), false);
    assert.equal(holds(missed, { kinds: [], landed: false }), true);

    assert.equal(
      holds(landed, undefined),
      false,
      'без данных о попадании часть не выполняется',
    );

    assert.equal(
      holds(missed, undefined),
      false,
      'и «промахнулась» тоже: неизвестно — значит молчим',
    );

    assert.ok(
      engine.listTriggerConditionKinds('attackRoll').includes('attackLanded'),
      'часть предлагается на броске атаки',
    );

    assert.equal(
      engine.listTriggerConditionKinds('turnStart').includes('attackLanded'),
      false,
      'на границе хода атаки нет — части тоже',
    );
  });

  it('[E17] Расписание по номеру раунда', () => {
    const system = new engine.Dnd5eVttSystem();

    const healedOnRound = (condition, context) => {
      const watch = markingEffect('Расписание', { event: 'healed', condition });
      const hero = withHp(createActor, 10, { activeEffects: [watch] }, 30);

      settleHitPoints(system, hero, 20, 0, context);

      return hasFired(hero);
    };

    const onSecond = 'combat.round === 2';
    const fromSecond = 'combat.round >= 2';

    assert.equal(
      healedOnRound(onSecond, { getCombatRound: () => 2 }),
      true,
      'на втором раунде расписание выполняется',
    );

    assert.equal(
      healedOnRound(onSecond, { getCombatRound: () => 1 }),
      false,
      'на первом — нет',
    );

    assert.equal(
      healedOnRound(fromSecond, { getCombatRound: () => 3 }),
      true,
      '«не раньше второго» выполняется и на третьем',
    );

    assert.equal(
      healedOnRound(onSecond, { getCombatRound: () => null }),
      false,
      'вне боя номера нет — расписание молчит',
    );

    assert.equal(
      healedOnRound(onSecond, {}),
      false,
      'старое ядро номера не отдаёт — расписание молчит, а не бьёт всегда',
    );

    // Граница хода идёт своим путём: номер раунда доезжает и туда
    const turnWatch = markingEffect('Расписание хода', {
      event: 'turnStart',
      condition: onSecond,
    });

    const fighter = withHp(createActor, 30, { activeEffects: [turnWatch] });

    engine.processTurnEffects(fighter, 'startOfTurn', { combatRound: 2 });

    assert.equal(hasFired(fighter), true, 'начало хода на втором раунде');

    // «При действии» считает клиент — номер раунда он берёт из трекера
    const actionWatch = markingEffect('Расписание действия', {
      event: 'activate',
      condition: onSecond,
    });

    const caster = withHp(createActor, 30, { activeEffects: [actionWatch] });

    assert.equal(
      hasFired(engine.runEffectActiveAction(caster, actionWatch.id, 2)),
      true,
      'действие эффекта на втором раунде',
    );

    assert.equal(
      hasFired(engine.runEffectActiveAction(caster, actionWatch.id)),
      false,
      'вне боя действие по расписанию молчит',
    );

    assert.equal(
      engine.listTriggerConditionKinds('rest').includes('combatRoundIs'),
      false,
      'отдых идёт вне боя — расписание ему не предлагается',
    );
  });

  it('[E09] Громовой клинок: урон, если цель сама прошла путь', () => {
    const system = new engine.Dnd5eVttSystem();

    // «Громовой клинок»: сдвинулась сама хотя бы на 5 футов — 1к8 звуком, и
    // эффект сгорает
    const boomingBlade = () =>
      createEffect('Громовой клинок', {
        triggers: [
          {
            id: 'trigger_booming_blade',
            event: 'moved',
            condition: 'move.forced === false',
            actions: [
              { type: 'damage', parts: [{ formula: '1d8@dmg.thunder' }] },
              { type: 'removeSelf' },
            ],
          },
        ],
      });

    const moveOf = (distance, forced = false) => ({
      from: { id: 'token', actorId: 'x', x: 0, y: 0, scale: 1, rotation: 0 },
      to: { id: 'token', actorId: 'x', x: 50, y: 0, scale: 1, rotation: 0 },
      distance,
      steps: [],
      forced,
      stopped: false,
    });

    const walker = withHp(createCreature, 20, {
      activeEffects: [boomingBlade()],
    });

    withRandom([MAX_ROLL], () =>
      system.applyMovementEffects(walker, moveOf(15)),
    );

    assert.equal(
      engine.resolveEntityCurrentHp(walker),
      12,
      'сама прошла путь — 1к8 звуком один раз: эффект сгорел на первом шаге',
    );

    assert.equal(walker.activeEffects.length, 0, 'клинок снят');

    const pushed = withHp(createCreature, 20, {
      activeEffects: [boomingBlade()],
    });

    system.applyMovementEffects(pushed, moveOf(15, true));

    assert.equal(
      engine.resolveEntityCurrentHp(pushed),
      20,
      'толчок чужими правилами — не её воля: клинок молчит',
    );

    // Без снятия срабатывание повторяется за каждый шаг пути
    const trail = createEffect('Шипастый след', {
      triggers: [
        {
          id: 'trigger_trail',
          event: 'moved',
          everyFeet: 10,
          actions: [{ type: 'damage', parts: [{ formula: '1@dmg.piercing' }] }],
        },
      ],
    });

    const runner = withHp(createCreature, 20, { activeEffects: [trail] });

    system.applyMovementEffects(runner, moveOf(35));

    assert.equal(
      engine.resolveEntityCurrentHp(runner),
      17,
      '35 футов при шаге 10 — три срабатывания, остаток не считается',
    );

    assert.ok(
      engine.listTriggerConditionKinds('moved').includes('movementOwn'),
      'на пути предлагается «шёл сам»',
    );

    assert.equal(
      engine.listTriggerConditionKinds('damageTaken').includes('movementOwn'),
      false,
      'вне пути частей о перемещении нет',
    );
  });

  // Пробелы: этим событиям нужны данные, которых ядро не отдаёт, либо новая
  // точка в пути каста
  it.todo('[E08] Каст доиграл срок или был прерван');
  it.todo('[E10] «При наложении» у эффекта заклинателя');
  it.todo('[E11] Снятие после первого любого броска к20');
  it.todo('[E12] Носитель стал целью заклинания');
  it.todo('[E13] Носитель колдует, и каст можно отменить');
  it.todo('[E14] На глазах носителя ранили союзника');
  it.todo('[E15] Носитель пересёк границу своей области');
  it.todo('[E16] Срабатывание по игровому времени');
  it.todo('[E18] Отложенное начало эффекта');
});
