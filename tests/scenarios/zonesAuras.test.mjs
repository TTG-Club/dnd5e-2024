import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  allCreaturesAura,
  authoredScenario,
  CELL_SIZE,
  change,
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  createToken,
  createZone,
  engine,
  FEET_PER_CELL,
  GRID,
  MAX_ROLL,
  MIN_ROLL,
  OTHER_TURN_ACTOR_ID,
  PLAYER_ID,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: зоны мастера и ауры (`docs/EFFECT_SCENARIOS.md`, раздел «Зоны и ауры»).
 */

/** Сл зон каталога */
const ZONE_DC = 12;

/**
 * Сцена вокруг носителя: соседи для отбора «в радиусе» и «по выбору».
 *
 * @param {object} carrier - носитель эффекта
 * @param {object[]} neighbors - кто стоит рядом
 * @returns {object} контекст со сценой
 */
function surroundingsOf(carrier, neighbors) {
  return {
    getSceneSurroundings: (entity) =>
      entity.id === carrier.id
        ? {
            token: createToken(carrier.id, 0, 0),
            gridSettings: GRID,
            neighbors: neighbors.map((neighbor, index) => ({
              token: createToken(neighbor.id, index + 1, 0),
              entity: neighbor,
            })),
          }
        : null,
  };
}

/**
 * Синхронизация «сущность вошла в зону».
 *
 * @param {object} entity - сущность
 * @param {object[]} zones - зоны сцены
 * @param {object} options - запрос броска, ауры
 * @returns {object} результат
 */
function enter(entity, zones, options = {}) {
  return engine.syncActorAreaEffects(
    entity,
    new Set(),
    new Set(zones.map((zone) => zone.id)),
    zones,
    options,
  );
}

describe('каталог: зоны и ауры', () => {
  it('[Z01] Трясина: труднопроходимая местность, «Лёгкий шаг» её игнорирует', () => {
    const swamp = createEffect('Трясина', {
      changes: [change('terrain.movementCost', '2', { mode: 'override' })],
    });

    authoredScenario(swamp, 'zone');

    assert.equal(
      engine.resolveAreaTerrainCost(createZone('ca_swamp', [swamp])),
      2,
    );

    const strider = createActor({
      activeEffects: [
        createEffect('Лёгкий шаг', { flags: ['terrain.ignoreDifficult'] }),
      ],
    });

    assert.equal(engine.entityIgnoresTerrainCost(strider), true);
    assert.equal(engine.entityIgnoresTerrainCost(createActor()), false);
  });

  it('[Z02] Ядовитое болото: существо мастера бросает спасбросок при входе сразу на сервере', () => {
    const bog = createEffect('Ядовитое болото', {
      areaTrigger: 'enter',
      conditionKey: 'poisoned',
      flags: ['attack.disadvantage', 'abilityCheck.disadvantage'],
      applySave: { ability: 'constitution', dc: ZONE_DC, onSuccess: 'negate' },
      duration: { type: 'rounds', value: 3 },
    });

    authoredScenario(bog, 'zone');

    const orc = createCreature();
    const double = createRequestRoll();

    const result = withRandom([MIN_ROLL], () =>
      enter(orc, [createZone('ca_bog', [bog])], {
        requestRoll: double.requestRoll,
      }),
    );

    assert.equal(double.requests.length, 0);
    assert.equal(result.saveOutcomes[0].passed, false);

    assert.ok(
      orc.activeEffects.some((effect) => effect.conditionKey === 'poisoned'),
    );
  });

  it('[Z03] Ядовитое болото: персонажу игрока спасбросок приходит запросом', async () => {
    const bog = createEffect('Ядовитое болото', {
      areaTrigger: 'enter',
      conditionKey: 'poisoned',
      flags: ['attack.disadvantage'],
      applySave: { ability: 'constitution', dc: ZONE_DC, onSuccess: 'negate' },
    });

    const hero = createActor();
    const double = createRequestRoll();

    const result = enter(hero, [createZone('ca_bog', [bog])], {
      requestRoll: double.requestRoll,
    });

    assert.equal(result.deferred.length, 1);
    assert.deepEqual(hero.activeEffects, []);

    double.answer({
      status: 'answered',
      result: { roll: 18, modifier: 0, total: 18, passed: true },
      respondedByUserId: PLAYER_ID,
    });

    const outcome = (await result.deferred[0].resolution)(hero);

    assert.equal(outcome.saveOutcomes[0].passed, true);
    assert.deepEqual(hero.activeEffects, [], 'успех — статуса нет');
  });

  it('[Z04] Лава: урон огнём в начале хода стоящему, иммунитет к огню спасает', () => {
    const lava = createEffect('Лава', {
      recurringDamage: {
        damageParts: [{ formula: '2d10@dmg.fire' }],
        timing: 'startOfTurn',
      },
    });

    authoredScenario(lava, 'zone');

    const zones = [createZone('ca_lava', [lava])];
    const orc = withHp(createCreature, 30);

    const salamander = withHp(createCreature, 30, {
      id: 'creature_salamander',
    });

    salamander.system.defenses = {
      ...salamander.system.defenses,
      immunities: ['fire'],
    };

    for (const creature of [orc, salamander]) {
      engine.syncActorAreaEffects(
        creature,
        new Set(),
        new Set(['ca_lava']),
        zones,
        { triggerOneShots: false },
      );

      withRandom([MAX_ROLL], () =>
        engine.processTurnEffects(creature, 'startOfTurn'),
      );
    }

    assert.equal(engine.resolveEntityCurrentHp(orc), 10);
    assert.equal(engine.resolveEntityCurrentHp(salamander), 30);
  });

  it('[Z05] Выход из круга: урон при выходе, а при входе — нет', () => {
    const circle = createEffect('Круг', {
      areaTrigger: 'exit',
      damageParts: [{ formula: '5', type: 'force' }],
    });

    authoredScenario(circle, 'zone');

    const zones = [createZone('ca_circle', [circle])];
    const orc = withHp(createCreature, 20);

    engine.syncActorAreaEffects(orc, new Set(), new Set(['ca_circle']), zones);
    assert.equal(engine.resolveEntityCurrentHp(orc), 20);

    engine.syncActorAreaEffects(orc, new Set(['ca_circle']), new Set(), zones);
    assert.equal(engine.resolveEntityCurrentHp(orc), 15);
  });

  it('[Z06] Эффект «пока внутри» живёт по зоне, а не по своей длительности', () => {
    const shade = createEffect('Тень', {
      flags: ['skill.stealth.advantage'],
      duration: { type: 'rounds', value: 1 },
    });

    const zones = [createZone('ca_shade', [shade])];
    const rogue = createActor();

    enter(rogue, zones, { triggerOneShots: false });
    assert.equal(rogue.activeEffects[0].duration.type, 'permanent');

    engine.decrementActorEffectDurations(rogue);
    engine.decrementActorEffectDurations(rogue);
    assert.equal(rogue.activeEffects.length, 1, 'ход не снимает копию');

    engine.syncActorAreaEffects(
      rogue,
      new Set(['ca_shade']),
      new Set(),
      zones,
      { triggerOneShots: false },
    );

    assert.deepEqual(rogue.activeEffects, [], 'выход снимает');
  });

  it('[Z17] Паутина: Опутанность спадает при выходе из зоны', () => {
    const web = createEffect('Паутина', {
      areaTrigger: 'enter',
      triggers: [
        {
          id: 'trigger_web',
          event: 'enter',
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'restrained',
              endsOnExit: true,
            },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(web, 'zone'),
      /до выхода из зоны/,
      'сводка называет, когда состояние спадёт',
    );

    const zones = [createZone('ca_web', [web])];
    const orc = withHp(createCreature, 20);

    enter(orc, zones);

    assert.equal(
      orc.activeEffects.some((effect) => effect.conditionKey === 'restrained'),
      true,
      'вход опутал',
    );

    // Тик хода состояние не снимает: у него нет своего срока
    engine.decrementActorEffectDurations(orc);

    assert.equal(
      orc.activeEffects.some((effect) => effect.conditionKey === 'restrained'),
      true,
    );

    engine.syncActorAreaEffects(orc, new Set(['ca_web']), new Set(), zones);

    assert.equal(
      orc.activeEffects.some((effect) => effect.conditionKey === 'restrained'),
      false,
      'выход снял состояние',
    );
  });

  it('[Z07] Две зоны с одинаковым эффектом: выход из одной оставляет копию другой', () => {
    const fog = createEffect('Туман', {
      flags: ['skill.perception.disadvantage'],
    });

    const zones = [
      createZone('ca_fog_a', [fog]),
      createZone('ca_fog_b', [{ ...fog, id: 'Туман-2' }]),
    ];

    const scout = createActor();

    enter(scout, zones, { triggerOneShots: false });

    engine.syncActorAreaEffects(
      scout,
      new Set(['ca_fog_a', 'ca_fog_b']),
      new Set(['ca_fog_b']),
      zones,
      { triggerOneShots: false },
    );

    assert.equal(
      engine.resolveAbilityCheckRollMode({
        flags: engine.resolveActorStats(scout).activeFlags,
        ability: 'wisdom',
        skill: 'perception',
      }),
      'disadvantage',
    );
  });

  it('[Z19] Зона в форме стены', () => {
    const cell = 50;

    // Стена огня: длина — сам луч, толщина — поле «ширина» луча. Окно
    // заклинания пишет его в `areaOfEffect.width`, шаблон на сцене его несёт
    const wallOf = (widthCells) => ({
      id: 'tmpl_wall',
      type: 'ray',
      originX: 1000,
      originY: 1025,
      targetX: 1000 + 12 * cell,
      targetY: 1025,
      width: widthCells * cell,
      color: 0xff6600,
      createdBy: 'player',
    });

    const coveredCells = (template) => {
      const polygon = engine.templateToPolygon(template, cell);

      let covered = 0;

      assert.ok(polygon, 'полигон зоны собран');

      for (let column = 15; column <= 35; column++) {
        for (let row = 15; row <= 25; row++) {
          const x = column * cell + cell / 2;
          const y = row * cell + cell / 2;
          const inZone = engine.isPointInPolygon(x, y, polygon);

          assert.equal(
            inZone,
            engine.isPointInTemplate(x, y, cell, template),
            `клетка ${column}:${row} — зона и шаблон совпадают`,
          );

          covered += inZone ? 1 : 0;
        }
      }

      return covered;
    };

    const thin = coveredCells(wallOf(1));
    const thick = coveredCells(wallOf(3));

    assert.ok(thin > 0, 'тонкая стена накрывает ряд клеток');

    assert.equal(
      thick,
      thin * 3,
      'стена втрое толще накрывает втрое больше клеток той же длины',
    );
  });

  it('[Z18] Перемещение зоны заклинания', () => {
    const castId = 'cast_cloudkill';

    // Квадрат в клетку: середина — в центре клетки (5, 0), на одном ряду с
    // заклинателем в клетке (0, 0)
    const cloudZone = createZone('ca_cloudkill', [], {
      points: [
        { x: 5 * CELL_SIZE, y: 0 },
        { x: 6 * CELL_SIZE, y: 0 },
        { x: 6 * CELL_SIZE, y: CELL_SIZE },
        { x: 5 * CELL_SIZE, y: CELL_SIZE },
      ],
      source: { entityId: 'actor_caster', label: 'Облако смерти', castId },
    });

    const strangerZone = createZone('ca_other', [], {
      points: cloudZone.points,
      source: { entityId: 'actor_caster', label: 'Чужой каст', castId: 'x' },
    });

    const surroundingsOf = (caster) => ({
      token: createToken(caster.id, 0, 0),
      gridSettings: GRID,
      neighbors: [],
      areas: [cloudZone, strangerZone],
    });

    // «Облако смерти»: в начале хода заклинателя уходит от него на 10 футов
    const cloudkill = createEffect('Облако смерти', {
      castId,
      triggers: [
        {
          id: 'trigger_cloudkill_drift',
          event: 'turnStart',
          actions: [{ type: 'moveArea', kind: 'away', distance: 10 }],
        },
      ],
    });

    assert.match(
      authoredScenario(cloudkill, 'spell'),
      /сдвигает зону от получателя на 10 фт/,
    );

    const caster = withHp(createActor, 30, {
      id: 'actor_caster',
      activeEffects: [cloudkill],
    });

    const shifts = [];

    engine.processTurnEffects(caster, 'startOfTurn', {
      surroundings: surroundingsOf(caster),
      moveArea: (areaId, offset) => shifts.push({ areaId, offset }),
    });

    // 10 футов — две клетки
    const tenFeet = (10 / FEET_PER_CELL) * CELL_SIZE;

    assert.deepEqual(
      shifts,
      [{ areaId: 'ca_cloudkill', offset: { dx: tenFeet, dy: 0 } }],
      'сдвинута только зона своего каста — на 10 футов прочь, по прямой',
    );

    // Старое ядро сдвигать не умеет: без `moveArea` действие молчит и не падает
    assert.doesNotThrow(() =>
      engine.processTurnEffects(caster, 'startOfTurn', {
        surroundings: surroundingsOf(caster),
      }),
    );

    // «Тьма» на предмете в руке: зона идёт за носителем
    const darkness = createEffect('Тьма', {
      castId,
      triggers: [
        {
          id: 'trigger_darkness_follow',
          event: 'moved',
          actions: [{ type: 'moveArea', kind: 'follow' }],
        },
      ],
    });

    assert.match(authoredScenario(darkness, 'spell'), /зона идёт за носителем/);

    const bearer = withHp(createActor, 30, {
      id: 'actor_caster',
      activeEffects: [darkness],
    });

    const follows = [];
    const system = new engine.Dnd5eVttSystem();

    system.applyMovementEffects(
      bearer,
      {
        from: createToken(bearer.id, 0, 0),
        to: createToken(bearer.id, 2, 1),
        distance: 10,
        steps: [],
        forced: false,
        stopped: false,
      },
      {
        getSceneSurroundings: () => surroundingsOf(bearer),
        moveArea: (areaId, offset) => follows.push({ areaId, offset }),
      },
    );

    const shift = { dx: 2 * CELL_SIZE, dy: CELL_SIZE };

    assert.deepEqual(
      follows,
      [{ areaId: 'ca_cloudkill', offset: shift }],
      'зона повторяет смещение фишки один раз за перемещение',
    );

    // «К получателю» останавливается на его фишке: до неё одна клетка, а
    // просили на 30 футов
    const nearZone = createZone('ca_near', [], {
      points: [
        { x: CELL_SIZE, y: 0 },
        { x: 2 * CELL_SIZE, y: 0 },
        { x: 2 * CELL_SIZE, y: CELL_SIZE },
        { x: CELL_SIZE, y: CELL_SIZE },
      ],
    });

    const toward = engine.resolveAreaShift(
      { type: 'moveArea', kind: 'toward', distance: 30 },
      nearZone,
      { recipient: createToken('caster', 0, 0), gridSettings: GRID },
    );

    assert.equal(toward.dx, -CELL_SIZE, 'ровно до фишки, не дальше');
    assert.equal(Math.abs(toward.dy), 0);
  });

  // Пробелы: точку выбирает человек, а «При действии» клиентское; третьей
  // координаты фишки ядро не отдаёт
  it.todo('[Z18b] Переместить зону действием в выбранную точку');
  it.todo('[Z20] Высота области');
  it.todo('[Z21] Зона, в которую нельзя войти');
  it.todo('[Z22] Зона не пропускает звук');
  it.todo('[Z23] Вырезанные участки зоны');
  it.todo('[Z24] Вход в зону, появившуюся под существом');

  it.todo('[Z07b] Одноимённые зоны заклинаний не складываются (2024) — пробел');

  it('[Z08] Аура «врагам» не задевает союзника', () => {
    const dread = createEffect('Жуть', {
      aura: {
        radius: 10,
        target: 'enemies',
        applyToSelf: false,
        visible: true,
      },
      flags: ['attack.disadvantage'],
    });

    authoredScenario(dread, 'creatureTrait');

    const lich = createCreature({
      id: 'creature_lich',
      activeEffects: [dread],
    });

    const source = {
      token: createToken(lich.id, 0, 0, { disposition: 'hostile' }),
      effects: engine.collectAllAuraEffects(lich),
    };

    const onEnemy = engine.calculateAmbientAuras(
      createToken('actor_hero', 1, 0, { disposition: 'friendly' }),
      [source],
      GRID,
    );

    const onAlly = engine.calculateAmbientAuras(
      createToken('creature_minion', 0, 1, { disposition: 'hostile' }),
      [source],
      GRID,
    );

    assert.equal(onEnemy.length, 1);
    assert.equal(onAlly.length, 0);
  });

  it('[Z09] Аура с «и на себя» действует на носителя, без неё — нет', () => {
    const glow = createEffect('Сияние', {
      aura: { radius: 10, target: 'allies', applyToSelf: true, visible: true },
      changes: [change('armorClass', '1')],
    });

    assert.equal(
      engine.resolveActorStats(createActor({ activeEffects: [glow] }))
        .armorClass,
      11,
    );

    const outward = { ...glow, aura: { ...glow.aura, applyToSelf: false } };

    assert.equal(
      engine.resolveActorStats(createActor({ activeEffects: [outward] }))
        .armorClass,
      10,
    );
  });

  it('[Z10] Источник ауры «при входе» сам подошёл к цели — срабатывание у цели', () => {
    const thorns = createEffect('Шипы', {
      aura: allCreaturesAura(5),
      areaTrigger: 'enter',
      damageParts: [{ formula: '3', type: 'piercing' }],
    });

    authoredScenario(thorns, 'creatureTrait');

    const hedgehog = createCreature({
      id: 'creature_hedgehog',
      activeEffects: [thorns],
    });

    const hero = withHp(createActor, 20);

    const heroToken = createToken(hero.id, 3, 0);
    const before = createToken(hedgehog.id, 0, 0);
    const after = createToken(hedgehog.id, 2, 0);

    const entities = new Map([
      [hero.id, hero],
      [hedgehog.id, hedgehog],
    ]);

    const outcomes = engine.applyAuraTriggerEffects(
      { tokens: [after, heroToken], gridSettings: GRID },
      after,
      hedgehog,
      before,
      (actorId) => entities.get(actorId),
    );

    assert.equal(outcomes.length, 1);
    assert.equal(engine.resolveEntityCurrentHp(hero), 17);
  });

  it('[Z11] Спасбросок при входе в зону получает бонус «Ауры защиты» союзника', () => {
    const bog = createEffect('Болото', {
      areaTrigger: 'enter',
      flags: ['attack.disadvantage'],
      applySave: { ability: 'constitution', dc: ZONE_DC, onSuccess: 'negate' },
    });

    const aura = createEffect('Аура защиты', {
      aura: { radius: 10, target: 'allies', applyToSelf: true, visible: true },
      changes: [change('save.constitution', '4')],
    });

    const zones = [createZone('ca_bog', [bog])];

    const helped = withRandom([0.5], () =>
      enter(createCreature(), zones, { resolveAmbientEffects: () => [aura] }),
    );

    const plain = withRandom([0.5], () => enter(createCreature(), zones));

    assert.equal(helped.saveOutcomes[0].total - plain.saveOutcomes[0].total, 4);
  });

  it('[Z12] Лунный луч (2024): вход и конец хода в зоне делят лимит «раз в ход»', () => {
    const once = { max: 1, per: 'turn', key: 'moonbeam' };

    const radiant = {
      type: 'damage',
      parts: [{ formula: '2d10@dmg.radiant' }],
      halfOnSave: true,
    };

    const moonbeam = createEffect('Лунный луч', {
      triggers: [
        {
          id: 'trigger_enter',
          event: 'enter',
          save: { ability: 'constitution', dc: ZONE_DC },
          actions: [radiant],
          limit: once,
        },
        {
          id: 'trigger_turn_end',
          event: 'turnEnd',
          save: { ability: 'constitution', dc: ZONE_DC },
          actions: [radiant],
          limit: once,
        },
      ],
    });

    const scenario = authoredScenario(moonbeam, 'zone');

    assert.match(scenario, /не чаще одного раза за ход/);

    const zones = [createZone('ca_moonbeam', [moonbeam])];
    const orc = createCreature();
    const inCombat = { isInCombat: () => true };

    const leave = () =>
      engine.syncActorAreaEffects(
        orc,
        new Set([zones[0].id]),
        new Set(),
        zones,
      );

    const endTurnInZone = () =>
      withRandom([MIN_ROLL, MAX_ROLL], () =>
        engine.processTurnEffects(orc, 'endOfTurn'),
      ).damageOutcomes.length;

    const entered = withRandom([MIN_ROLL, MAX_ROLL], () =>
      enter(orc, zones, inCombat),
    );

    assert.equal(entered.damageOutcomes.length, 1);
    assert.equal(entered.changed, true);

    // Выйти и войти снова в том же ходу — без урона
    leave();
    assert.equal(enter(orc, zones, inCombat).damageOutcomes.length, 0);

    // Тот же ход: вход уже ударил — конец хода в зоне молчит
    assert.equal(endTurnInZone(), 0);

    // Конец хода сбрасывает счётчик: в конце следующего хода в зоне снова бьёт
    engine.expireTurnEffects(orc, OTHER_TURN_ACTOR_ID, 'end');
    assert.equal(endTurnInZone(), 1);

    // Вне боя ходов нет: каждый вход бьёт, остаток счётчика прошлого боя стёрт
    const outOfCombat = { isInCombat: () => false };

    leave();
    assert.equal(enter(orc, zones, outOfCombat).damageOutcomes.length, 1);
    assert.equal(orc.system.effectUsage, undefined);
    leave();
    assert.equal(enter(orc, zones, outOfCombat).damageOutcomes.length, 1);
  });

  it('[Z14] Духовные стражи (2024): вход в ауру и конец хода в ней делят «раз в ход», извилистый путь входит один раз', () => {
    const once = { max: 1, per: 'turn', key: 'guardians' };
    const save = { ability: 'wisdom', dc: ZONE_DC };

    const radiant = {
      type: 'damage',
      parts: [{ formula: '3d8@dmg.radiant' }],
      halfOnSave: true,
    };

    const guardians = createEffect('Духовные стражи', {
      aura: allCreaturesAura(5),
      triggers: [
        {
          id: 'trigger_enter',
          event: 'enter',
          save,
          actions: [radiant],
          limit: once,
        },
        {
          id: 'trigger_turn_end',
          event: 'turnEnd',
          save,
          actions: [radiant],
          limit: once,
        },
      ],
    });

    const scenario = authoredScenario(guardians, 'spell');

    assert.match(scenario, /не чаще одного раза за ход/);

    const cleric = createActor({
      id: 'actor_cleric',
      activeEffects: [guardians],
    });

    const clericToken = createToken(cleric.id, 0, 0);

    /**
     * Проводит существо по клеткам ряда шаг за шагом, как ядро: вход в одну
     * ауру за перемещение отмечается в общем наборе.
     *
     * @param {object} entity - идущее существо
     * @param {number[]} columns - клетки пути
     * @returns {object[]} исходы аур по шагам
     */
    const walk = (entity, columns) => {
      const entities = new Map([
        [cleric.id, cleric],
        [entity.id, entity],
      ]);

      const context = {
        isInCombat: () => true,
        alreadyEnteredAuraKeys: new Set(),
      };

      return columns.slice(1).flatMap((column, index) => {
        const stepToken = createToken(entity.id, column, 0);

        return engine.applyAuraTriggerEffects(
          { tokens: [clericToken, stepToken], gridSettings: GRID },
          stepToken,
          entity,
          createToken(entity.id, columns[index], 0),
          (actorId) => entities.get(actorId),
          context,
        );
      });
    };

    const hits = (outcomes) =>
      outcomes.flatMap((outcome) => outcome.damageOutcomes).length;

    // Внутрь, наружу и снова внутрь за одно перемещение
    const winding = [3, 2, 1, 2, 1];
    const orc = withHp(createCreature, 60);

    assert.equal(
      withRandom([MIN_ROLL, MAX_ROLL], () => hits(walk(orc, winding))),
      1,
    );

    // Без лимита извилистый путь всё равно входит один раз
    const unlimited = withHp(createCreature, 60, { id: 'creature_goblin' });

    cleric.activeEffects = [
      {
        ...guardians,
        triggers: guardians.triggers.map(({ limit: _limit, ...trigger }) => ({
          ...trigger,
        })),
      },
    ];

    assert.equal(
      withRandom([MIN_ROLL, MAX_ROLL], () => hits(walk(unlimited, winding))),
      1,
    );

    cleric.activeEffects = [guardians];

    const endTurnInAura = () =>
      withRandom([MIN_ROLL, MAX_ROLL], () =>
        engine.processTurnEffects(orc, 'endOfTurn', {
          ambientEffects: engine.calculateAmbientAuras(
            createToken(orc.id, 1, 0),
            [
              {
                token: clericToken,
                effects: engine.collectAllAuraEffects(cleric),
              },
            ],
            GRID,
          ),
        }),
      ).damageOutcomes.length;

    // Тот же ход: вход уже ударил — конец хода в ауре молчит
    assert.equal(endTurnInAura(), 0);

    // Новый ход — снова бьёт
    engine.expireTurnEffects(orc, OTHER_TURN_ACTOR_ID, 'end');
    assert.equal(endTurnInAura(), 1);
  });

  it.todo(
    '[Z13] Сильная заслонённость зоны игрока (стена зрения у зоны от сущности) — пробел',
  );

  it('[Z15] Аура живучести: лечит одно существо на выбор в начале хода', async () => {
    const aura = createEffect('Аура живучести', {
      triggers: [
        {
          id: 'trigger_heal',
          event: 'turnStart',
          recipient: 'choice',
          choice: { radius: 30, target: 'allies', count: 1 },
          actions: [{ type: 'damage', parts: [{ formula: '5@heal' }] }],
        },
      ],
    });

    assert.match(
      authoredScenario(aura, 'spell'),
      /на 1 из союзников в 30 фт вокруг по выбору/,
    );

    const caster = withHp(createActor, 30, {
      id: 'actor_caster',
      name: 'Жрец',
      activeEffects: [aura],
    });

    const hurt = withHp(createActor, 30, { id: 'actor_hurt', name: 'Раненый' });
    const fresh = withHp(createActor, 30, { id: 'actor_fresh', name: 'Целый' });

    hurt.system.hitPoints.current = 10;

    for (const ally of [caster, hurt, fresh]) {
      ally.token = { ...ally.token, disposition: 'friendly' };
    }

    const { requests, requestRoll, answer } = createRequestRoll();

    const result = new engine.Dnd5eVttSystem().runTurnEffects(
      caster,
      'startOfTurn',
      { requestRoll, ...surroundingsOf(caster, [hurt, fresh]) },
    );

    assert.equal(requests.length, 1, 'спросили один раз');
    assert.equal(requests[0].entityId, caster.id, 'спросили у носителя ауры');

    assert.deepEqual(
      requests[0].payload.candidates.map((candidate) => candidate.id),
      [hurt.id, fresh.id],
      'кандидаты — союзники в радиусе',
    );

    answer({
      status: 'answered',
      result: { chosenIds: [hurt.id] },
      respondedByUserId: PLAYER_ID,
    });

    const applied = await result.deferred[0].resolution;
    const nested = applied(caster);

    assert.equal(nested.deferred?.length, 1, 'лечение уходит чужой записи');

    (await nested.deferred[0].resolution)(hurt);

    assert.equal(
      engine.resolveEntityCurrentHp(hurt),
      15,
      'вылечили выбранного',
    );

    assert.equal(
      engine.resolveEntityCurrentHp(fresh),
      30,
      'второго не тронули',
    );
  });

  it('[Z16] Выбор цели: условие кандидата и отказ отменяет срабатывание', async () => {
    const smite = createEffect('Кара нежити', {
      triggers: [
        {
          id: 'trigger_smite',
          event: 'turnEnd',
          recipient: 'choice',
          choice: { radius: 15, condition: 'self.creatureType === "undead"' },
          actions: [
            { type: 'damage', parts: [{ formula: '6', type: 'radiant' }] },
          ],
        },
      ],
    });

    const hero = createActor({ id: 'actor_hero', activeEffects: [smite] });
    const zombie = withHp(createCreature, 20, { id: 'creature_zombie' });
    const wolf = withHp(createCreature, 20, { id: 'creature_wolf' });

    zombie.system.type = 'undead';
    wolf.system.type = 'beast';

    const { requests, requestRoll, answer } = createRequestRoll();

    const result = new engine.Dnd5eVttSystem().runTurnEffects(
      hero,
      'endOfTurn',
      { requestRoll, ...surroundingsOf(hero, [zombie, wolf]) },
    );

    assert.deepEqual(
      requests[0].payload.candidates.map((candidate) => candidate.id),
      [zombie.id],
      'волк не нежить — в кандидаты не попал',
    );

    answer({ status: 'declined' });

    const applied = await result.deferred[0].resolution;
    const outcome = applied(hero);

    assert.equal(
      outcome.changed,
      false,
      'без выбора срабатывание не состоялось',
    );

    assert.equal(engine.resolveEntityCurrentHp(zombie), 20, 'урона нет');

    assert.match(outcome.chatSummary ?? '', /цель не выбрана/);
  });
});
