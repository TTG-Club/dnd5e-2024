import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  change,
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  createToken,
  createZone,
  engine,
  GRID,
  MAX_ROLL,
  MIN_ROLL,
  PLAYER_ID,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: зоны мастера и ауры (`docs/EFFECT_SCENARIOS.md`, раздел «Зоны и ауры»).
 */

/** Сл зон каталога */
const ZONE_DC = 12;

/**
 * Сущность с заданными хитами.
 *
 * @param {Function} factory - createActor или createCreature
 * @param {number} hitPoints - хиты
 * @param {object} overrides - поля
 * @returns {object} сущность
 */
function withHp(factory, hitPoints, overrides = {}) {
  const entity = factory(overrides);

  entity.system.hitPoints =
    factory === createActor
      ? { current: hitPoints, max: hitPoints, temp: 0 }
      : {
          ...entity.system.hitPoints,
          current: hitPoints,
          max: hitPoints,
          average: hitPoints,
        };

  return entity;
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
      aura: { radius: 5, target: 'all', applyToSelf: false, visible: true },
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

  it('[Z12] «Первый вход за ход»: вход и начало хода в зоне делят лимит «раз в ход»', () => {
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
          id: 'trigger_turn',
          event: 'turnStart',
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

    const entered = withRandom([MIN_ROLL, MAX_ROLL], () =>
      enter(orc, zones, inCombat),
    );

    assert.equal(entered.damageOutcomes.length, 1);
    assert.equal(entered.changed, true);

    // Тот же ход: вход уже ударил — начало хода в зоне молчит
    const sameTurn = withRandom([MIN_ROLL, MAX_ROLL], () =>
      engine.processTurnEffects(orc, 'startOfTurn'),
    );

    assert.equal(sameTurn.damageOutcomes.length, 0);

    // Выйти и войти снова в том же ходу — тоже без урона
    engine.syncActorAreaEffects(orc, new Set([zones[0].id]), new Set(), zones);
    assert.equal(enter(orc, zones, inCombat).damageOutcomes.length, 0);

    // Конец хода сбрасывает счётчик
    engine.expireTurnEffects(orc, 'someone', 'end');

    const nextTurn = withRandom([MIN_ROLL, MAX_ROLL], () =>
      engine.processTurnEffects(orc, 'startOfTurn'),
    );

    assert.equal(nextTurn.damageOutcomes.length, 1);

    // Вне боя ходов нет: каждый вход бьёт, остаток счётчика прошлого боя стёрт
    const outOfCombat = { isInCombat: () => false };

    const leave = () =>
      engine.syncActorAreaEffects(
        orc,
        new Set([zones[0].id]),
        new Set(),
        zones,
      );

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
      aura: { radius: 5, target: 'all', applyToSelf: false, visible: true },
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
        const to = createToken(entity.id, column, 0);

        return engine.applyAuraTriggerEffects(
          { tokens: [clericToken, to], gridSettings: GRID },
          to,
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
    engine.expireTurnEffects(orc, 'someone', 'end');
    assert.equal(endTurnInAura(), 1);
  });

  it.todo(
    '[Z13] Сильная заслонённость зоны игрока (стена зрения у зоны от сущности) — пробел',
  );
});
