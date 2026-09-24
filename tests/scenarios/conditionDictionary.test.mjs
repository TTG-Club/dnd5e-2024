import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createRequestRoll,
  engine,
  withHp,
} from './_fixtures.mjs';

/**
 * Каталог: словарь условий срабатываний (`docs/EFFECT_SCENARIOS.md`, раздел
 * «Словарь условий»).
 *
 * Правило раздела одно и то же у каждой части: на событии, где данных для неё
 * нет, часть НЕ выполняется — срабатывание молчит, а не бьёт всегда.
 */

/** Срабатывание с условием — минимальная обёртка для проверки */
function triggerWith(condition) {
  return { condition };
}

/**
 * Выполняется ли условие на сущности.
 *
 * @param {object} entity - субъект
 * @param {string} condition - условие строкой словаря
 * @param {object} eventData - данные события
 * @returns {boolean} выполняется ли
 */
function met(entity, condition, eventData = {}) {
  return engine.isTriggerConditionMet(
    entity,
    triggerWith(condition),
    eventData,
  );
}

describe('каталог: словарь условий', () => {
  it('[TC01] Части словаря читаются и пишутся без потерь', () => {
    const parts = [
      { kind: 'selfTempHpZero' },
      { kind: 'selfGrounded' },
      { kind: 'otherIsSource' },
      { kind: 'otherBloodied' },
      { kind: 'selfSpecies', value: 'Эльф' },
      { kind: 'selfAbilityAtLeast', value: 'strength', amount: 13 },
      { kind: 'selfAbilityAtMost', value: 'dexterity', amount: 8 },
      { kind: 'otherHpAtMost', value: '25' },
      { kind: 'damageAtLeast', value: '10' },
      { kind: 'sourceWithin', value: '30' },
      { kind: 'attackKind', value: 'melee' },
      { kind: 'attackAbility', value: 'strength' },
    ];

    const condition = engine.writeTriggerCondition(parts);

    assert.deepEqual(
      engine.readTriggerConditionParts(condition),
      parts,
      'собрали в окне → сохранили → открыли: те же части',
    );
  });

  it('[TC02] Незнакомая часть не ломает разбор всего условия', () => {
    const condition = 'self.hp.temp === 0 && self.чужое === "x"';

    const parts = engine.readTriggerConditionParts(condition);

    assert.equal(parts.length, 2);
    assert.equal(parts[0].kind, 'selfTempHpZero');
    assert.equal(typeof parts[1], 'string', 'чужая часть осталась строкой');

    const hero = withHp(createActor, 20);

    assert.equal(
      met(hero, condition),
      false,
      'условие с непонятой частью НЕ выполняется',
    );
  });

  it('[TC03] Временные хиты, характеристика и вид носителя', () => {
    const hero = withHp(createActor, 20);

    assert.equal(met(hero, 'self.hp.temp === 0'), true);

    hero.system.hitPoints.temp = 5;

    assert.equal(met(hero, 'self.hp.temp === 0'), false);

    hero.system.abilities.strength = 16;

    assert.equal(met(hero, 'self.ability["strength"] >= 13'), true);
    assert.equal(met(hero, 'self.ability["strength"] <= 12'), false);

    hero.system.species = { speciesKey: 'elf', speciesName: 'Эльф' };

    assert.equal(met(hero, 'self.species === "эльф"'), true);
    assert.equal(met(hero, 'self.species === "Дварф"'), false);
  });

  it('[TC04] Другая сторона: наложивший, окровавленность и хиты', () => {
    const hero = createActor();
    const wolf = withHp(createCreature, 20, { id: 'creature_wolf' });

    assert.equal(
      met(hero, 'target.isSource === true', { other: wolf }),
      false,
      'без наложившего часть не выполняется',
    );

    assert.equal(
      met(hero, 'target.isSource === true', {
        other: wolf,
        sourceId: wolf.id,
      }),
      true,
    );

    assert.equal(
      met(hero, 'target.hp.value <= (target.hp.max / 2)', { other: wolf }),
      false,
    );

    wolf.system.hitPoints.current = 9;

    assert.equal(
      met(hero, 'target.hp.value <= (target.hp.max / 2)', { other: wolf }),
      true,
    );

    assert.equal(met(hero, 'target.hp.value <= 10', { other: wolf }), true);

    assert.equal(
      met(hero, 'target.hp.value <= 10'),
      false,
      'без другой стороны часть не выполняется',
    );
  });

  it('[TC05] Урон, расстояние и вид атаки берутся из данных события', () => {
    const hero = createActor();

    assert.equal(
      met(hero, 'damage.amount >= 10', {
        damage: { amount: 12, types: ['fire'], critical: false },
      }),
      true,
    );

    assert.equal(
      met(hero, 'damage.amount >= 10', {
        damage: { amount: 4, types: ['fire'], critical: false },
      }),
      false,
    );

    assert.equal(
      met(hero, 'damage.amount >= 10'),
      false,
      'без урона в событии часть не выполняется',
    );

    assert.equal(
      met(hero, 'source.distance <= 30', {
        isSourceWithin: (feet) => feet >= 30,
      }),
      true,
    );

    assert.equal(
      met(hero, 'source.distance <= 30'),
      false,
      'без сцены расстояние неизвестно — часть не выполняется',
    );

    assert.deepEqual(engine.toTriggerAttackKinds('melee'), ['melee', 'weapon']);

    assert.deepEqual(engine.toTriggerAttackKinds('spell'), ['spell']);

    assert.equal(
      met(hero, 'attack.kind === "melee"', {
        attack: { kinds: engine.toTriggerAttackKinds('melee') },
      }),
      true,
    );

    assert.equal(
      met(hero, 'attack.kind === "spell"', {
        attack: { kinds: engine.toTriggerAttackKinds('melee') },
      }),
      false,
    );

    assert.equal(
      met(hero, 'attack.ability === "strength"', {
        attack: { kinds: ['melee'], ability: 'strength' },
      }),
      true,
    );
  });

  it('[TC06] Часть предлагается только там, где на событии есть её данные', () => {
    const turnKinds = engine.listTriggerConditionKinds('turnStart');

    assert.ok(
      !turnKinds.includes('damageAtLeast'),
      'урона на границе хода нет — часть о нём не предлагается',
    );

    assert.ok(!turnKinds.includes('attackKind'), 'атаки на границе хода нет');

    assert.ok(
      turnKinds.includes('selfTempHpZero'),
      'о носителе спрашивать можно всегда',
    );

    assert.ok(
      engine.listTriggerConditionKinds('attackRoll').includes('attackKind'),
      'на броске атаки вид атаки известен',
    );

    assert.ok(
      engine.listTriggerConditionKinds('damageTaken').includes('damageAtLeast'),
      'у урона его величина известна',
    );
  });

  it('[TC07] Режим спасброска по условию: преимущество и помеха гасят друг друга', () => {
    const effect = createEffect('Жуткий смех Таши');
    const hero = withHp(createActor, 20);

    /**
     * Спасбросок срабатывания с правилами режима.
     *
     * @param {object[]} modeIf - правила режима
     * @returns {object} срабатывание
     */
    const triggerOf = (modeIf) => ({
      id: 'trigger_save',
      event: 'turnEnd',
      save: { ability: 'wisdom', dc: 13, modeIf },
      actions: [{ type: 'removeSelf' }],
    });

    hero.system.hitPoints.temp = 0;

    const advantage = engine.buildTriggerSaveSpec(
      effect,
      triggerOf([{ condition: 'self.hp.temp === 0', mode: 'advantage' }]),
      { entity: hero, eventData: {} },
    );

    assert.equal(advantage.mode, 'advantage');

    const cancelled = engine.buildTriggerSaveSpec(
      effect,
      triggerOf([
        { condition: 'self.hp.temp === 0', mode: 'advantage' },
        { condition: 'self.hp.temp === 0', mode: 'disadvantage' },
      ]),
      { entity: hero, eventData: {} },
    );

    assert.equal(cancelled.mode, undefined, 'преимущество и помеха погасились');

    const inert = engine.buildTriggerSaveSpec(
      effect,
      triggerOf([{ condition: 'damage.amount >= 10', mode: 'advantage' }]),
      { entity: hero, eventData: {} },
    );

    assert.equal(
      inert.mode,
      undefined,
      'без данных события правило не выполняется',
    );

    // Спасбросок хода, спрошенный у игрока, получает тот же режим, что бросок
    // сервера
    const cursed = createEffect('Жуткий смех Таши', {
      triggers: [
        triggerOf([{ condition: 'self.hp.temp === 0', mode: 'advantage' }]),
      ],
    });

    hero.activeEffects = [cursed];

    const turn = engine.processTurnEffects(hero, 'endOfTurn', {
      deferRecurringSave: () => true,
    });

    const { requests, requestRoll } = createRequestRoll();

    engine.requestTurnTriggerSave(
      hero,
      turn.deferredTriggers[0],
      'endOfTurn',
      requestRoll,
    );

    assert.equal(requests[0].payload.mode, 'advantage');
  });

  it('[TC08] Автоматический исход спасброска: провал главнее успеха', () => {
    const hero = withHp(createActor, 20);

    hero.system.hitPoints.temp = 0;

    const save = {
      ability: 'wisdom',
      dc: 13,
      autoSuccessIf: 'self.hp.temp === 0',
      autoFailIf: 'self.hp.value <= 20',
    };

    assert.equal(
      engine.resolveTriggerAutoSaveOutcome(save, {
        entity: hero,
        eventData: {},
      }),
      false,
      'провал считается первым',
    );

    assert.equal(
      engine.resolveTriggerAutoSaveOutcome(
        { ability: 'wisdom', dc: 13, autoSuccessIf: 'self.hp.temp === 0' },
        { entity: hero, eventData: {} },
      ),
      true,
    );

    assert.equal(
      engine.resolveTriggerAutoSaveOutcome(
        { ability: 'wisdom', dc: 13, autoFailIf: 'damage.amount >= 10' },
        { entity: hero, eventData: {} },
      ),
      null,
      'без данных события бросок идёт как обычно',
    );
  });

  it('[TC08] Автоматический исход на границе хода: эффект снимается без броска', () => {
    const hero = withHp(createActor, 20);

    hero.system.hitPoints.temp = 0;

    // Сл 30 честным броском не пройти: успех возможен только автоматически
    const laughter = createEffect('Жуткий смех Таши', {
      triggers: [
        {
          id: 'trigger_save',
          event: 'turnEnd',
          save: {
            ability: 'wisdom',
            dc: 30,
            autoSuccessIf: 'self.hp.temp === 0',
          },
          actions: [{ type: 'removeSelf', on: 'saved' }],
        },
      ],
    });

    hero.activeEffects = [laughter];

    const result = engine.processTurnEffects(hero, 'endOfTurn');

    assert.equal(result.saveOutcomes.length, 1);
    assert.equal(result.saveOutcomes[0].passed, true, 'успех автоматический');

    assert.equal(
      hero.activeEffects.some((effect) => effect.id === laughter.id),
      false,
      'эффект снят',
    );
  });

  // Пробелы словаря: части, которым нужны данные, которых ядро пока не даёт.
  // Заводить их в окне нельзя — они молча не выполнялись бы никогда
  it.todo('[TC09] Условия видимости и освещённости');
  it.todo('[TC10] Условие по прошлому броску к20');
  it.todo('[TC11] Условие сравнивает с формулой');
});
