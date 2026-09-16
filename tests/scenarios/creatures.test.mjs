import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  allCreaturesAura,
  authoredScenario,
  createActor,
  createCreature,
  createEffect,
  createToken,
  createTrait,
  engine,
  GRID,
  MAX_ROLL,
  MIN_ROLL,
  NO_REGENERATION_TAG,
  saveOutcome,
  strikeEntity,
  TROLL_REGENERATION,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: существа — действия, черты, статблок
 * (`docs/EFFECT_SCENARIOS.md`, раздел «Существа»).
 */

/** Хиты тролля по статблоку (Бестиарий 2024) */
const TROLL_MAX_HP = 94;

/** Лечение регенерацией тролля в формуле урона */
const TROLL_REGENERATION_FORMULA = `${TROLL_REGENERATION}@heal`;

/** Радиус «Огненной ауры» огненного элементаля (Бестиарий 2024), в футах */
const FIRE_AURA_RADIUS = 10;

/**
 * Тролль мастера.
 *
 * @param {number} hitPoints - текущие хиты (максимум по статблоку)
 * @param {object} overrides - поля существа
 * @returns {object} тролль
 */
function createTroll(hitPoints, overrides = {}) {
  return withHp(
    createCreature,
    hitPoints,
    { id: 'creature_troll', name: 'Тролль', ...overrides },
    TROLL_MAX_HP,
  );
}

/**
 * Эффект-состояние, собранный из шаблона и полей автора.
 *
 * @param {string} conditionKey - состояние
 * @param {object} overrides - поля автора
 * @returns {object} эффект
 */
function conditionEffect(conditionKey, overrides) {
  return engine.applyConditionPresetToEffect(
    createEffect(conditionKey, overrides),
    engine.buildConditionActiveEffect(conditionKey),
  );
}

/**
 * Флаги сущности с наложенными эффектами.
 *
 * @param {object} entity - сущность
 * @param {object[]} effects - эффекты
 * @returns {Set<string>} активные флаги
 */
function flagsAfter(entity, effects) {
  const target = {
    ...entity,
    activeEffects: engine.applyEffectsToEntity(
      entity,
      effects,
      'creatureAction',
    ),
  };

  return engine.resolveActorStats(target).activeFlags;
}

describe('каталог: существа', () => {
  it('[C01] Когти гуля: «Парализованный» при провале Телосложения, повторный спасбросок в конце хода', () => {
    const claws = conditionEffect('paralyzed', {
      effectTarget: 'target',
      applySave: { ability: 'constitution', dc: 10, onSuccess: 'negate' },
      recurringSave: { ability: 'constitution', dc: 10, timing: 'endOfTurn' },
      duration: { type: 'rounds', value: 10 },
    });

    authoredScenario(claws, 'creatureAction');

    assert.equal(
      engine.resolveEffectApplication(claws, {
        landed: true,
        applySaveSucceeded: false,
      }).applyEffect,
      true,
    );

    assert.equal(
      engine.resolveEffectApplication(claws, {
        landed: true,
        applySaveSucceeded: true,
      }).applyEffect,
      false,
    );

    const flags = flagsAfter(createActor(), [claws]);

    assert.ok(flags.has('save.autoFail.strength'));
    assert.ok(flags.has('attacksAgainst.advantage'));
  });

  it('[C02] Укус волка: «Лежащий ничком» при провале Силы', () => {
    const bite = conditionEffect('prone', {
      effectTarget: 'target',
      applySave: { ability: 'strength', dc: 11, onSuccess: 'negate' },
    });

    authoredScenario(bite, 'creatureAction');

    const flags = flagsAfter(createActor(), [bite]);

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: new Set(),
        attackType: 'melee',
        targetFlags: flags,
      }),
      'advantage',
    );

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: new Set(),
        attackType: 'ranged',
        targetFlags: flags,
      }),
      'disadvantage',
    );
  });

  it('[C03] Паутина паука: «Опутанный» — скорость 0, помеха на атаки и спасброски Ловкости', () => {
    const web = conditionEffect('restrained', {
      effectTarget: 'target',
      applySave: { ability: 'dexterity', dc: 12, onSuccess: 'negate' },
    });

    authoredScenario(web, 'creatureAction');

    const target = {
      ...createActor(),
      activeEffects: engine.applyEffectsToEntity(
        createActor(),
        [web],
        'creatureAction',
      ),
    };

    const stats = engine.resolveActorStats(target);

    assert.equal(engine.resolveTotalMovementSpeed(stats), 0);

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: stats.activeFlags,
        attackType: 'melee',
      }),
      'disadvantage',
    );

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags: stats.activeFlags,
        ability: 'dexterity',
      }),
      'disadvantage',
    );
  });

  it('[C04] Магическое сопротивление: преимущество только на спасброски против магии', () => {
    const trait = createEffect('Магическое сопротивление', {
      flags: ['save.advantage.vsMagic'],
    });

    authoredScenario(trait, 'creatureTrait');

    const creature = createCreature();

    creature.system.traits = [createTrait('Магическое сопротивление', [trait])];

    const flags = engine.resolveActorStats(creature).activeFlags;

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags,
        ability: 'wisdom',
        againstMagic: true,
      }),
      'advantage',
    );

    assert.equal(
      engine.resolveSavingThrowRollMode({ flags, ability: 'wisdom' }),
      'normal',
    );
  });

  it.todo(
    '[C05] Тактика стаи: преимущество, если союзник в 5 фт от цели — пробел («союзник рядом»)',
  );

  it('[C06] Зловоние [≈]: аура «при входе» — спасбросок Телосложения или «Отравленный»', () => {
    const stench = conditionEffect('poisoned', {
      aura: allCreaturesAura(10),
      areaTrigger: 'enter',
      applySave: { ability: 'constitution', dc: 12, onSuccess: 'negate' },
      duration: { type: 'rounds', value: 1 },
    });

    authoredScenario(stench, 'creatureTrait');

    const troglodyte = createCreature({
      id: 'creature_troglodyte',
      name: 'Троглодит',
    });

    troglodyte.system.traits = [createTrait('Зловоние', [stench])];

    const hero = createActor();
    const heroFar = createToken(hero.id, 5, 0);
    const heroNear = createToken(hero.id, 1, 0);
    const sourceToken = createToken(troglodyte.id, 0, 0);

    const entities = new Map([
      [hero.id, hero],
      [troglodyte.id, troglodyte],
    ]);

    const outcomes = withRandom([MIN_ROLL], () =>
      engine.applyAuraTriggerEffects(
        { tokens: [sourceToken, heroNear], gridSettings: GRID },
        heroNear,
        hero,
        heroFar,
        (actorId) => entities.get(actorId),
      ),
    );

    assert.equal(outcomes.length, 1);

    assert.ok(
      hero.activeEffects.some((effect) => effect.conditionKey === 'poisoned'),
    );
  });

  it('[C06b] Зловоние: в начале хода в ауре спасбросок Телосложения или «Отравленный»', () => {
    const stench = createEffect('Зловоние', {
      aura: allCreaturesAura(10),
      triggers: [
        {
          id: 'trigger_stench',
          event: 'turnStart',
          save: { ability: 'constitution', dc: 12 },
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'poisoned',
              duration: { type: 'rounds', value: 1 },
            },
          ],
        },
      ],
    });

    const scenario = authoredScenario(stench, 'creatureTrait');

    assert.match(scenario, /в начале хода: спасбросок Телосложения, Сл 12/);

    const troglodyte = createCreature({
      id: 'creature_troglodyte',
      name: 'Троглодит',
    });

    troglodyte.system.traits = [createTrait('Зловоние', [stench])];

    const auraSources = [
      {
        token: createToken(troglodyte.id, 0, 0),
        effects: engine.collectAllAuraEffects(troglodyte),
      },
    ];

    const startTurnAt = (entity, column, random) =>
      withRandom([random], () =>
        engine.processTurnEffects(entity, 'startOfTurn', {
          ambientEffects: engine.calculateAmbientAuras(
            createToken(entity.id, column, 0),
            auraSources,
            GRID,
          ),
        }),
      );

    const conditionsOf = (entity) =>
      (entity.activeEffects ?? []).map((effect) => effect.conditionKey);

    const failed = createActor({ autoSaves: true });

    startTurnAt(failed, 1, MIN_ROLL);
    assert.deepEqual(conditionsOf(failed), ['poisoned']);

    const passed = createActor({ autoSaves: true });

    startTurnAt(passed, 1, MAX_ROLL);
    assert.deepEqual(conditionsOf(passed), []);

    const far = createActor({ autoSaves: true });

    startTurnAt(far, 5, MIN_ROLL);
    assert.deepEqual(conditionsOf(far), []);

    // Сам троглодит своего зловония не нюхает
    startTurnAt(troglodyte, 0, MIN_ROLL);
    assert.deepEqual(conditionsOf(troglodyte), []);
  });

  it('[C07] Огненная аура: урон огнём в конце хода элементаля всем в ауре; сам источник не горит', () => {
    const fireAura = createEffect('Огненная аура', {
      aura: allCreaturesAura(FIRE_AURA_RADIUS),
      triggers: [
        {
          id: 'trigger_fire_aura',
          event: 'turnEnd',
          turnOf: 'source',
          actions: [{ type: 'damage', parts: [{ formula: '1d10@dmg.fire' }] }],
        },
      ],
    });

    authoredScenario(fireAura, 'creatureTrait');

    const elemental = createCreature({
      id: 'creature_elemental',
      name: 'Огненный элементаль',
    });

    elemental.system.traits = [createTrait('Огненная аура', [fireAura])];

    const hero = withHp(createActor, 30);

    const ambient = engine.calculateAmbientAuras(
      createToken(hero.id, 1, 0),
      [
        {
          token: createToken(elemental.id, 0, 0),
          effects: engine.collectAllAuraEffects(elemental),
        },
      ],
      GRID,
    );

    // Элементаль в бою: его аура бьёт на ЕГО ходу, а не на ходу героя
    const elementalInCombat = {
      ambientEffects: ambient,
      isSourceInCombat: () => true,
    };

    withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(hero, 'endOfTurn', elementalInCombat),
    );

    assert.equal(engine.resolveEntityCurrentHp(hero), 30);

    withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(hero, 'endOfTurn', {
        ...elementalInCombat,
        sourceTurnActorId: elemental.id,
      }),
    );

    assert.equal(engine.resolveEntityCurrentHp(hero), 20);

    const selfResult = engine.processTurnEffects(elemental, 'endOfTurn', {
      sourceTurnActorId: elemental.id,
    });

    assert.equal(selfResult.damageOutcomes.length, 0);
  });

  it('[C08] Регенерация (свой эффект существа): +15 хитов в начале хода', () => {
    const regeneration = createEffect('Регенерация', {
      recurringDamage: {
        damageParts: [{ formula: TROLL_REGENERATION_FORMULA }],
        timing: 'startOfTurn',
      },
    });

    authoredScenario(regeneration, 'ownEffects');

    const troll = createTroll(TROLL_MAX_HP, { activeEffects: [regeneration] });

    engine.applyTargetDamage(troll, 20, false, 'slashing');

    const woundedHp = engine.resolveEntityCurrentHp(troll);
    const result = engine.processTurnEffects(troll, 'startOfTurn');

    assert.equal(result.healingOutcomes.length, 1);

    assert.equal(
      engine.resolveEntityCurrentHp(troll),
      woundedHp + TROLL_REGENERATION,
    );
  });

  it('[C08b] Регенерация чертой статблока: +15 хитов в начале хода, черта остаётся', () => {
    const regeneration = createEffect('Регенерация', {
      recurringDamage: {
        damageParts: [{ formula: TROLL_REGENERATION_FORMULA }],
        timing: 'startOfTurn',
      },
    });

    authoredScenario(regeneration, 'creatureTrait');

    const troll = createTroll(TROLL_MAX_HP);

    troll.system.traits = [createTrait('Регенерация', [regeneration])];
    engine.applyTargetDamage(troll, 20, false, 'slashing');

    const woundedHp = engine.resolveEntityCurrentHp(troll);
    const result = engine.processTurnEffects(troll, 'startOfTurn');

    assert.equal(result.healingOutcomes.length, 1);

    assert.equal(
      engine.resolveEntityCurrentHp(troll),
      woundedHp + TROLL_REGENERATION,
    );

    assert.equal(troll.system.traits[0].activeEffects.length, 1);
    assert.equal(troll.activeEffects?.length ?? 0, 0);
  });

  it('[C08c] Регенерация гаснет после урона огнём или кислотой до начала следующего хода', () => {
    const noRegenerationTag = {
      type: 'applyTag',
      tag: NO_REGENERATION_TAG,
      label: 'Без регенерации',
    };

    const regeneration = createEffect('Регенерация', {
      triggers: [
        {
          id: 'trigger_regen',
          event: 'turnStart',
          condition: `self.tag !== "${NO_REGENERATION_TAG}"`,
          actions: [
            {
              type: 'damage',
              parts: [{ formula: TROLL_REGENERATION_FORMULA }],
            },
          ],
        },
        {
          id: 'trigger_fire',
          event: 'damageTaken',
          condition: 'damage.type === "fire"',
          actions: [noRegenerationTag],
        },
        {
          id: 'trigger_acid',
          event: 'damageTaken',
          condition: 'damage.type === "acid"',
          actions: [noRegenerationTag],
        },
      ],
    });

    const scenario = authoredScenario(regeneration, 'creatureTrait');

    assert.match(scenario, /урон огненный/);

    const troll = createTroll(40);

    troll.system.traits = [createTrait('Регенерация', [regeneration])];

    const system = new engine.Dnd5eVttSystem();

    const heals = () =>
      engine.processTurnEffects(troll, 'startOfTurn').healingOutcomes.length;

    strikeEntity(system, troll, 10, 'fire');
    assert.equal(heals(), 0, 'после огня регенерации нет');

    engine.expireTurnEffects(troll, troll.id, 'start');
    strikeEntity(system, troll, 10, 'slashing');
    assert.equal(heals(), 1, 'рубящий урон регенерацию не гасит');

    strikeEntity(system, troll, 10, 'acid');
    assert.equal(heals(), 0, 'кислота гасит так же, как огонь');
  });

  it('[C09] Защиты статблока: сопротивление, иммунитет и уязвимость к урону', () => {
    const creature = createCreature();

    creature.system.defenses = {
      ...creature.system.defenses,
      resistances: ['fire'],
      immunities: ['poison'],
      vulnerabilities: ['bludgeoning'],
    };

    const hp = engine.resolveEntityCurrentHp(creature);

    assert.equal(
      engine.applyTargetDamage(creature, 4, false, 'fire').hpAfter,
      hp - 2,
    );

    assert.equal(
      engine.applyTargetDamage(creature, 4, false, 'poison').hpAfter,
      hp - 2,
    );

    assert.equal(
      engine.applyTargetDamage(creature, 2, false, 'bludgeoning').hpAfter,
      Math.max(0, hp - 6),
    );
  });

  it('[C10] Иммунитет к состояниям статблока: «Отравленный» не накладывается', () => {
    const creature = createCreature();

    creature.system.defenses = {
      ...creature.system.defenses,
      conditionImmunities: ['poisoned'],
    };

    const poisoned = engine.buildConditionActiveEffect('poisoned');

    assert.deepEqual(
      engine.applyEffectsToEntity(creature, [poisoned], 'creatureAction'),
      [],
    );

    assert.equal(
      engine.applyEntryEffect(creature, poisoned, null).statusApplied,
      false,
    );
  });

  it('[C11] Устрашающая внешность: «Испуганный» на минуту, повторный спасбросок Мудрости', () => {
    const presence = conditionEffect('frightened', {
      effectTarget: 'target',
      applySave: { ability: 'wisdom', dc: 16, onSuccess: 'negate' },
      recurringSave: { ability: 'wisdom', dc: 16, timing: 'endOfTurn' },
      duration: { type: 'minutes', value: 1 },
    });

    authoredScenario(presence, 'creatureAction');

    const hero = createActor();

    hero.activeEffects = engine.applyEffectsToEntity(
      hero,
      [presence],
      'creatureAction',
    );

    const flags = engine.resolveActorStats(hero).activeFlags;

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: flags,
        attackType: 'melee',
      }),
      'disadvantage',
    );

    assert.equal(
      engine.resolveAbilityCheckRollMode({ flags, ability: 'strength' }),
      'disadvantage',
    );

    assert.equal(
      hero.activeEffects[0].duration.remaining,
      10,
      'минута — 10 раундов',
    );

    withRandom([MAX_ROLL], () => engine.processTurnEffects(hero, 'endOfTurn'));
    assert.equal(hero.activeEffects.length, 0);
  });

  it('[C12] Иммунитет к Испугу у персонажа от черты перекрывает «Устрашающую внешность»', () => {
    const fearless = createEffect('Бесстрашие', {
      conditionImmunities: ['frightened'],
    });

    authoredScenario(fearless, 'feature');

    const hero = createActor({
      features: [
        { id: 'feat_fearless', name: 'Бесстрашие', activeEffects: [fearless] },
      ],
      activeEffects: [fearless],
    });

    const frightened = engine.buildConditionActiveEffect('frightened');

    assert.deepEqual(
      engine.applyEffectsToEntity(hero, [frightened], 'creatureAction'),
      [fearless],
    );
  });

  it('[C12b] Стойкость нежити: вместо 0 хитов — 1 при спасброске Телосложения Сл 5 + урон, кроме излучения и крита', () => {
    const fortitude = createEffect('Стойкость нежити', {
      triggers: [
        {
          id: 'trigger_fortitude',
          event: 'hpZero',
          condition: 'damage.type !== "radiant" && damage.isCritical === false',
          save: { ability: 'constitution', dc: 10, dcFormula: '5 + @damage' },
          actions: [{ type: 'setHp', value: 1, on: 'saved' }],
        },
      ],
    });

    const scenario = authoredScenario(fortitude, 'creatureTrait');

    assert.match(scenario, /Сл = 5 \+ урон/);

    const system = new engine.Dnd5eVttSystem();

    /**
     * Зомби с 6 хитами под ударом.
     *
     * @param {string} damageType - тип урона
     * @param {object} details - крит
     * @param {number} random - бросок спасброска
     * @returns {object} зомби после удара
     */
    const strikeZombie = (damageType, details, random) => {
      const zombie = withHp(
        createCreature,
        6,
        { id: 'creature_zombie', name: 'Зомби' },
        22,
      );

      zombie.system.traits = [createTrait('Стойкость нежити', [fortitude])];

      withRandom([random], () =>
        strikeEntity(system, zombie, 8, damageType, { details }),
      );

      return engine.resolveEntityCurrentHp(zombie);
    };

    assert.equal(strikeZombie('slashing', {}, MAX_ROLL), 1);
    assert.equal(strikeZombie('slashing', {}, MIN_ROLL), 0, 'провал Сл 13');
    assert.equal(strikeZombie('radiant', {}, MAX_ROLL), 0);
    assert.equal(strikeZombie('slashing', { critical: true }, MAX_ROLL), 0);
  });

  it('[C13] Огненное дыхание: спасбросок Ловкости, успех — половина урона', () => {
    const breath = createEffect('Огненное дыхание', {
      effectTarget: 'target',
      applySave: { ability: 'dexterity', dc: 13, onSuccess: 'half' },
      damageParts: [{ formula: '7d6', type: 'fire' }],
    });

    authoredScenario(breath, 'creatureAction');

    assert.deepEqual(
      engine.resolveEffectApplication(breath, {
        landed: true,
        applySaveSucceeded: true,
      }),
      {
        applyEffect: false,
        damageMultiplier: 0.5,
      },
    );

    assert.deepEqual(
      engine.resolveEffectApplication(breath, {
        landed: true,
        applySaveSucceeded: false,
      }),
      {
        applyEffect: true,
        damageMultiplier: 1,
      },
    );

    const hero = withHp(createActor, 40);

    const result = engine.applyEntryEffect(
      hero,
      breath,
      saveOutcome(true, { ability: 'dexterity', dc: 13 }),
    );

    assert.ok(result.damageOutcome, 'урон нанесён');

    assert.ok(
      engine.resolveEntityCurrentHp(hero) >= 40 - 21,
      'не больше половины максимума 7к6',
    );
  });
});

describe('каталог: запрет лечения', () => {
  it('[C14] Борода бородатого дьявола: цель не восстанавливает хиты', () => {
    const beard = createEffect('Борода', {
      effectTarget: 'target',
      flags: ['healing.blocked'],
      recurringSave: { ability: 'constitution', dc: 12, timing: 'endOfTurn' },
    });

    authoredScenario(beard, 'creatureAction');

    const victim = withHp(createActor, 10, { activeEffects: [beard] }, 30);

    engine.applyTargetDamage(victim, 8, true);
    assert.equal(engine.resolveEntityCurrentHp(victim), 10);

    // Урон каждый ход с лечением и временные хиты: хиты — нет, временные — да
    engine.applyTurnHealing(victim, 5, 4);
    assert.equal(engine.resolveEntityCurrentHp(victim), 10);
    assert.equal(engine.resolveEntityTempHp(victim), 4);

    const healed = withHp(createActor, 10, {}, 30);

    engine.applyTargetDamage(healed, 8, true);
    assert.equal(engine.resolveEntityCurrentHp(healed), 18);
  });
});

describe('каталог: срабатывания на цели и у черт', () => {
  /** Сл дыхания серебряного дракона */
  const BREATH_DC = 18;

  /** Кто наложил эффект в сценариях */
  const WIGHT_ID = 'creature_wight';

  it('[C15] Сонное дыхание: урон будит, но не урон самого наложения', () => {
    const sleep = createEffect('Сонное дыхание', {
      effectTarget: 'target',
      conditionKey: 'unconscious',
      flags: ['incapacitated'],
      duration: { type: 'rounds', value: 10 },
      triggers: [
        {
          id: 'trigger_wake',
          event: 'damageTaken',
          actions: [{ type: 'removeSelf' }],
        },
      ],
    });

    authoredScenario(sleep, 'creatureAction');

    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 30);
    const landing = structuredClone(hero);

    landing.activeEffects = [sleep];
    engine.applyTargetDamage(landing, 5, false, 'fire');
    system.settleCombatState(hero, engine.pickCombatState(landing));

    assert.equal(hero.activeEffects.length, 1, 'урон наложения не будит');

    strikeEntity(system, hero, 3, 'slashing');
    assert.equal(hero.activeEffects.length, 0, 'следующий урон будит');
  });

  it('[C16] Парализующее дыхание: второй провал — паралич с повторным спасброском', () => {
    const breath = createEffect('Парализующее дыхание', {
      effectTarget: 'target',
      conditionKey: 'incapacitated',
      flags: ['incapacitated'],
      triggers: [
        {
          id: 'trigger_paralyze',
          event: 'turnEnd',
          save: { ability: 'constitution', dc: 0 },
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'paralyzed',
              duration: { type: 'rounds', value: 10 },
              recurringSave: {
                ability: 'constitution',
                dc: 0,
                timing: 'endOfTurn',
              },
              on: 'failed',
            },
            { type: 'removeSelf', on: 'always' },
          ],
        },
      ],
    });

    authoredScenario(breath, 'creatureAction');

    const stamped = engine.stampSourceTurnSaveDc(breath, BREATH_DC);
    const [trigger] = stamped.triggers;

    assert.equal(trigger.save.dc, BREATH_DC);
    assert.equal(trigger.actions[0].recurringSave.dc, BREATH_DC);

    const target = createCreature({ activeEffects: [stamped] });

    withRandom([MIN_ROLL], () =>
      engine.processTurnEffects(target, 'endOfTurn'),
    );

    assert.deepEqual(
      target.activeEffects.map((effect) => effect.conditionKey),
      ['paralyzed'],
    );

    assert.deepEqual(target.activeEffects[0].recurringSave, {
      ability: 'constitution',
      dc: BREATH_DC,
      timing: 'endOfTurn',
    });
  });

  it('[C17] Регенерация слаада: только пока у слаада есть хиты', () => {
    const regeneration = createEffect('Регенерация', {
      triggers: [
        {
          id: 'trigger_regen',
          event: 'turnStart',
          condition: 'self.hp.value >= 1',
          actions: [{ type: 'damage', parts: [{ formula: '10@heal' }] }],
        },
      ],
    });

    authoredScenario(regeneration, 'creatureTrait');

    const slaadAt = (hitPoints) => {
      const slaad = withHp(createCreature, hitPoints, {}, 100);

      slaad.system.traits = [createTrait('Регенерация', [regeneration])];
      engine.processTurnEffects(slaad, 'startOfTurn');

      return engine.resolveEntityCurrentHp(slaad);
    };

    assert.equal(slaadAt(0), 0, 'с нулём хитов не лечится');
    assert.equal(slaadAt(5), 15);
  });

  it('[C18] Вонь: после успеха — невосприимчивость к этому источнику', () => {
    const stench = createEffect('Вонь', {
      areaTrigger: 'stay',
      aura: allCreaturesAura(5),
      triggers: [
        {
          id: 'trigger_stench',
          event: 'turnStart',
          condition: 'self.tagFromSource !== "stenchImmune"',
          save: { ability: 'constitution', dc: 10 },
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'poisoned',
              duration: { type: 'rounds', value: 1 },
              on: 'failed',
            },
            {
              type: 'applyTag',
              tag: 'stenchImmune',
              label: 'Невосприимчив к вони',
              duration: { type: 'hours', value: 24 },
              on: 'saved',
            },
          ],
        },
      ],
    });

    authoredScenario(stench, 'creatureTrait');

    const fromGhast = (ghastId) => ({ ...stench, sourceActorId: ghastId });
    const hero = withHp(createActor, 30);

    const saves = (ghastId) =>
      withRandom([MAX_ROLL], () =>
        engine.processTurnEffects(hero, 'startOfTurn', {
          ambientEffects: [fromGhast(ghastId)],
        }),
      ).saveOutcomes.length;

    assert.equal(saves('ghast_a'), 1);
    assert.equal(saves('ghast_a'), 0, 'к этому гулю невосприимчив');
    assert.equal(saves('ghast_b'), 1, 'другой гуль — снова спасбросок');
  });

  it('[C19] Похищение жизни: максимум хитов уменьшается на некротический урон до долгого отдыха', () => {
    const drain = createEffect('Похищение жизни', {
      effectTarget: 'target',
      triggers: [
        {
          id: 'trigger_drain',
          event: 'applied',
          condition: 'damage.type === "necrotic"',
          actions: [
            { type: 'reduceMaxHp', amount: '@damage' },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    authoredScenario(drain, 'creatureAction');

    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 30);
    const landing = structuredClone(hero);

    landing.activeEffects = [{ ...drain, sourceActorId: WIGHT_ID }];

    engine.applyTargetDamage(landing, 7, false, 'necrotic', {
      critical: false,
      sourceId: WIGHT_ID,
    });

    system.settleCombatState(hero, engine.pickCombatState(landing));

    assert.equal(engine.resolveEntityMaxHp(hero), 23);
    assert.equal(engine.resolveEntityCurrentHp(hero), 23);

    assert.deepEqual(
      hero.activeEffects.map((effect) => effect.tag),
      [engine.MAX_HP_REDUCTION_TAG],
      'контейнер снят, осталась метка уменьшения',
    );

    const rested = engine.applyActorRest(hero, 'long');

    assert.deepEqual(rested.activeEffects, []);
    assert.equal(rested.system.hitPoints.current, 30);
  });
});

describe('каталог: случайный вариант', () => {
  it('[C20] Лучи глаз: случайный луч из группы', () => {
    const rays = ['Очаровывающий', 'Парализующий', 'Усыпляющий'].map(
      (label, index) =>
        createEffect(label, {
          effectTarget: 'target',
          conditionKey: ['charmed', 'paralyzed', 'unconscious'][index],
          variant: { group: 'луч', label, pick: 'random' },
        }),
    );

    authoredScenario(rays[0], 'creatureAction');

    const groups = engine.listEffectVariantGroups(rays);

    assert.equal(groups[0].pick, 'random');

    // Кость на 0.5 выбирает средний из трёх лучей
    assert.deepEqual(
      engine.rollRandomEffectVariants(groups, () => 0.5),
      { луч: 'Парализующий' },
    );
  });
});
