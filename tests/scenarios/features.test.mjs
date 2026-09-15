import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  change,
  createActor,
  createEffect,
  createToken,
  engine,
  GRID,
  strikeEntity,
} from './_fixtures.mjs';

/**
 * Каталог: умения классов, черты и виды
 * (`docs/EFFECT_SCENARIOS.md`, разделы «Классы и черты» и «Виды»).
 */

/** Все характеристики — для аур на все спасброски */
const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/**
 * Персонаж с классом и характеристиками.
 *
 * @param {object} options - класс, уровень, характеристики, поля
 * @param {string} [options.classKey] - класс
 * @param {number} [options.level] - уровень в классе
 * @param {object} [options.abilities] - значения характеристик
 * @param {object} [options.overrides] - поля персонажа
 * @returns {object} персонаж
 */
function hero({
  classKey = 'fighter',
  level = 1,
  abilities = {},
  overrides = {},
} = {}) {
  const system = structuredClone(engine.DEFAULT_ACTOR.system);

  return createActor({
    system: {
      ...system,
      classes: [{ classKey, level }],
      abilities: { ...system.abilities, ...abilities },
    },
    ...overrides,
  });
}

/**
 * Разница статов с эффектом и без.
 *
 * @param {object} entity - персонаж без эффекта
 * @param {object[]} effects - эффекты
 * @param {Function} read - что читать из статов
 * @returns {number} прибавка
 */
function deltaOf(entity, effects, read) {
  const base = read(engine.resolveActorStats(entity));

  const withEffects = read(
    engine.resolveActorStats({ ...entity, activeEffects: effects }),
  );

  return withEffects - base;
}

/** Контекст броска */
const roll = (hasAdvantage) => ({ hasAdvantage, hasDisadvantage: false });

describe('каталог: классы и черты', () => {
  it('[F01] Ярость [≈]: сопротивление физическому урону, +2 к урону, преимущество на Силу', () => {
    const rage = createEffect(engine.buildClassEffectId('barbarian', 'rage'), {
      name: 'Ярость',
      flags: [
        'resistance.bludgeoning',
        'resistance.piercing',
        'resistance.slashing',
        'abilityCheck.advantage.strength',
        'save.advantage.strength',
      ],
      changes: [change('damage.melee', '2')],
      duration: { type: 'minutes', value: 10 },
    });

    authoredScenario(rage, 'ownEffects');

    const barbarian = hero({
      classKey: 'barbarian',
      level: 3,
      overrides: { activeEffects: [rage] },
    });

    const stats = engine.resolveActorStats(barbarian);

    assert.equal(stats.damageBonuses.melee, 2);
    assert.ok(stats.damageDefenses.resistances.has('slashing'));

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags: stats.activeFlags,
        ability: 'strength',
      }),
      'advantage',
    );
  });

  it.todo(
    '[F01b] Ярость включается бонусным действием и кончается без атаки/урона за ход — пробел (активация умений)',
  );

  it('[F02] Драконья стойкость: +1 хит за уровень чародея и КД 10 + Ловк + Хар без доспеха', () => {
    const resilience = createEffect(
      engine.buildClassEffectId('sorcerer', 'draconic'),
      {
        name: 'Драконья стойкость',
        changes: [
          change('hitPoints.max', '@classLevel'),
          change('armorClass', '10 + @mod.dex + @mod.cha', {
            mode: 'override',
            condition: 'self.armor === "none"',
          }),
        ],
      },
    );

    authoredScenario(resilience, 'feature');

    const sorcerer = hero({
      classKey: 'sorcerer',
      level: 5,
      abilities: { dexterity: 14, charisma: 16 },
    });

    assert.equal(
      deltaOf(sorcerer, [resilience], (stats) => stats.hitPointsMax),
      5,
    );

    assert.equal(
      engine.resolveActorStats({ ...sorcerer, activeEffects: [resilience] })
        .armorClass,
      15,
    );
  });

  it('[F03] Аура защиты: союзникам + Харизма паладина к спасброскам, а не своя', () => {
    const aura = createEffect(
      engine.buildClassEffectId('paladin', 'auraOfProtection'),
      {
        name: 'Аура защиты',
        aura: {
          radius: 10,
          target: 'allies',
          applyToSelf: true,
          visible: true,
        },
        changes: ABILITIES.map((ability) =>
          change(`save.${ability}`, '@mod.cha'),
        ),
      },
    );

    authoredScenario(aura, 'feature');

    const paladin = hero({
      classKey: 'paladin',
      level: 6,
      abilities: { charisma: 18 },
      overrides: { id: 'actor_paladin', activeEffects: [aura] },
    });

    const rogue = hero({
      classKey: 'rogue',
      abilities: { charisma: 8 },
      overrides: { id: 'actor_rogue' },
    });

    const ambient = engine.calculateAmbientAuras(
      createToken(rogue.id, 1, 0, { disposition: 'friendly' }),
      [
        {
          token: createToken(paladin.id, 0, 0, { disposition: 'friendly' }),
          effects: engine.collectAllAuraEffects(paladin),
        },
      ],
      GRID,
    );

    assert.equal(engine.resolveActorStats(rogue, ambient).saves.wisdom, 4);

    assert.equal(
      engine.resolveActorStats(paladin).saves.wisdom,
      4,
      'сам паладин тоже в ауре',
    );
  });

  it('[F04] Аура отваги: союзники в ауре иммунны к Испугу', () => {
    const courage = createEffect('Аура отваги', {
      aura: { radius: 10, target: 'allies', applyToSelf: true, visible: true },
      conditionImmunities: ['frightened'],
    });

    authoredScenario(courage, 'feature');

    const paladin = hero({
      overrides: { id: 'actor_paladin', activeEffects: [courage] },
    });

    const ally = hero({ overrides: { id: 'actor_ally' } });

    const ambient = engine.calculateAmbientAuras(
      createToken(ally.id, 1, 0, { disposition: 'friendly' }),
      [
        {
          token: createToken(paladin.id, 0, 0, { disposition: 'friendly' }),
          effects: engine.collectAllAuraEffects(paladin),
        },
      ],
      GRID,
    );

    assert.ok(
      engine.getEntityConditionImmunities(ally, ambient).includes('frightened'),
    );

    assert.equal(
      engine.getEntityConditionImmunities(ally).includes('frightened'),
      false,
      'вне ауры иммунитета нет',
    );
  });

  it('[F05] Стиль «Оборона»: +1 КД только в доспехе', () => {
    const defense = createEffect('Оборона', {
      changes: [
        change('armorClass', '1', { condition: 'self.armor === "any"' }),
      ],
    });

    authoredScenario(defense, 'feature');

    const chain = {
      id: 'chain',
      name: 'Кольчуга',
      type: 'equipment',
      equipped: true,
      equipmentCategory: 'heavy',
      baseArmorAC: 16,
    };

    assert.equal(
      deltaOf(hero(), [defense], (stats) => stats.armorClass),
      0,
    );

    assert.equal(
      deltaOf(
        hero({ overrides: { equipment: [chain] } }),
        [defense],
        (stats) => stats.armorClass,
      ),
      1,
    );
  });

  it('[F06] Движение без доспехов: +10 фт без доспеха и щита', () => {
    const movement = createEffect('Движение без доспехов', {
      changes: [
        change('movement.walk', '10', {
          condition: 'self.armor === "none" && self.armor === "noShield"',
        }),
      ],
    });

    authoredScenario(movement, 'feature');

    const shield = {
      id: 'shield',
      name: 'Щит',
      type: 'equipment',
      equipped: true,
      equipmentCategory: 'shield',
      baseArmorAC: 2,
    };

    assert.equal(
      deltaOf(hero(), [movement], (stats) => stats.movement.walk),
      10,
    );

    assert.equal(
      deltaOf(
        hero({ overrides: { equipment: [shield] } }),
        [movement],
        (stats) => stats.movement.walk,
      ),
      0,
    );
  });

  it('[F07] Скрытая атака [≈]: +к6 урона при преимуществе', () => {
    const sneak = createEffect('Скрытая атака', {
      changes: [
        change('damage.melee', '3d6', {
          condition: 'roll.hasAdvantage === true',
        }),
      ],
    });

    authoredScenario(sneak, 'feature');

    assert.deepEqual(
      engine
        .collectBonusDamageFormulas([sneak], 'damage.melee', roll(true))
        .map((part) => part.formula),
      ['3d6'],
    );

    assert.deepEqual(
      engine.collectBonusDamageFormulas([sneak], 'damage.melee', roll(false)),
      [],
    );
  });

  it.todo(
    '[F07b] Скрытая атака: союзник рядом с целью вместо преимущества и «раз в ход» — пробел',
  );

  it.todo(
    '[F08] Увёртливость: успех спасброска Ловкости — без урона, провал — половина — пробел',
  );

  it('[F09] Бдительный: + бонус мастерства к инициативе', () => {
    const alert = createEffect('Бдительный', {
      changes: [change('initiative', '@prof')],
    });

    authoredScenario(alert, 'feature');

    assert.equal(
      deltaOf(hero({ level: 5 }), [alert], (stats) => stats.initiative),
      3,
    );
  });

  it('[F10] Крепкий: +2 хита за уровень персонажа', () => {
    const tough = createEffect('Крепкий', {
      changes: [change('hitPoints.max', '2 * @level')],
    });

    authoredScenario(tough, 'feature');

    assert.equal(
      deltaOf(hero({ level: 4 }), [tough], (stats) => stats.hitPointsMax),
      8,
    );
  });

  it('[F11] Подвижный: +10 фт скорости', () => {
    const mobile = createEffect('Подвижный', {
      changes: [change('movement.walk', '10')],
    });

    authoredScenario(mobile, 'feature');

    assert.equal(
      deltaOf(hero(), [mobile], (stats) => stats.movement.walk),
      10,
    );
  });

  it('[F12] Боевой заклинатель [≈]: преимущество на спасброски Телосложения', () => {
    const warCaster = createEffect('Боевой заклинатель', {
      flags: ['save.advantage.constitution'],
    });

    authoredScenario(warCaster, 'feature');

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags: engine.resolveActorStats(
          hero({ overrides: { activeEffects: [warCaster] } }),
        ).activeFlags,
        ability: 'constitution',
      }),
      'advantage',
    );
  });

  it.todo(
    '[F12b] Боевой заклинатель: преимущество только на спасброски концентрации — пробел (нет концентрации)',
  );

  it.todo(
    '[F13] Удача: переброс d20 за очко удачи — пробел (ресурс и переброс)',
  );
});

describe('каталог: виды', () => {
  it('[SP01] Стойкость дварфа: сопротивление яду, преимущество против Отравления', () => {
    const resilience = createEffect('Дварфийская стойкость', {
      flags: ['resistance.poison', 'save.advantage.vsPoisoned'],
    });

    authoredScenario(resilience, 'feature');

    const stats = engine.resolveActorStats(
      hero({ overrides: { activeEffects: [resilience] } }),
    );

    assert.ok(stats.damageDefenses.resistances.has('poison'));

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags: stats.activeFlags,
        ability: 'constitution',
        againstCondition: 'poisoned',
      }),
      'advantage',
    );

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags: stats.activeFlags,
        ability: 'constitution',
      }),
      'normal',
    );
  });

  it('[SP02] Наследие фей: преимущество против Очарования', () => {
    const fey = createEffect('Наследие фей', {
      flags: ['save.advantage.vsCharmed'],
    });

    authoredScenario(fey, 'feature');

    const flags = engine.resolveActorStats(
      hero({ overrides: { activeEffects: [fey] } }),
    ).activeFlags;

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags,
        ability: 'wisdom',
        againstCondition: 'charmed',
      }),
      'advantage',
    );
  });

  it('[SP03] Выносливость дварфа: +1 хит за уровень', () => {
    const toughness = createEffect('Дварфийская выносливость', {
      changes: [change('hitPoints.max', '@level')],
    });

    authoredScenario(toughness, 'feature');

    assert.equal(
      deltaOf(hero({ level: 7 }), [toughness], (stats) => stats.hitPointsMax),
      7,
    );
  });

  it('[SP04] Тифлинг: сопротивление огню и тёмное зрение 60 фт', () => {
    const infernal = createEffect('Адское наследие', {
      flags: ['resistance.fire'],
      changes: [change('sense.darkvision', '60', { mode: 'upgrade' })],
    });

    authoredScenario(infernal, 'feature');

    const stats = engine.resolveActorStats(
      hero({ overrides: { activeEffects: [infernal] } }),
    );

    assert.equal(stats.senses.darkvision, 60);
    assert.ok(stats.damageDefenses.resistances.has('fire'));
  });

  it('[SP05] Неумолимая стойкость: 1 хит вместо 0 раз в долгий отдых', () => {
    const endurance = createEffect('Неумолимая стойкость', {
      triggers: [
        {
          id: 'trigger_endurance',
          event: 'hpZero',
          actions: [{ type: 'setHp', value: 1 }],
          limit: { max: 1, per: 'longRest' },
        },
      ],
    });

    authoredScenario(endurance, 'feature');

    const orc = hero({ overrides: { activeEffects: [endurance] } });
    const system = new engine.Dnd5eVttSystem();

    const dropFrom = (hitPoints) => {
      orc.system.hitPoints = { current: hitPoints, max: 20, temp: 0 };
      strikeEntity(system, orc, 12, 'bludgeoning');

      return engine.resolveEntityCurrentHp(orc);
    };

    assert.equal(dropFrom(5), 1);
    assert.equal(dropFrom(5), 0, 'второй раз до отдыха — нет');

    orc.system = engine.applyActorRest(orc, 'long').system;

    assert.equal(dropFrom(5), 1, 'после долгого отдыха — снова');
  });

  it('[SP06] Храбрость полурослика: преимущество против Испуга', () => {
    const brave = createEffect('Храбрость', {
      flags: ['save.advantage.vsFrightened'],
    });

    authoredScenario(brave, 'feature');

    const flags = engine.resolveActorStats(
      hero({ overrides: { activeEffects: [brave] } }),
    ).activeFlags;

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags,
        ability: 'wisdom',
        againstCondition: 'frightened',
      }),
      'advantage',
    );
  });
});
