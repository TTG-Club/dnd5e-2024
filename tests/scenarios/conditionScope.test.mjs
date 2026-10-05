import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  change,
  createActor,
  createCreature,
  createEffect,
  engine,
} from './_fixtures.mjs';

/**
 * Каталог: условия и область действия модификаторов
 * (`docs/EFFECT_SCENARIOS.md`, раздел «Условия и область действия»). Тексты
 * правил — из сверки мест этапа 2A (`wave2-plan/stage2A/places.json`).
 */

/** Кто наложил эффект */
const SOURCE_ID = 'actor_bard';

/**
 * Цель броска для условий `target.*`.
 *
 * @param {string} entityId - сущность цели
 * @param {object} overrides - тип и прочее
 * @returns {object} цель в контексте броска
 */
function targetOf(entityId, overrides = {}) {
  return {
    entityId,
    currentHp: 10,
    maxHp: 10,
    creatureType: 'humanoid',
    markedBy: [],
    ...overrides,
  };
}

/**
 * Контекст броска атаки по цели.
 *
 * @param {object} target - цель
 * @returns {object} контекст
 */
function rollAt(target) {
  return { hasAdvantage: false, hasDisadvantage: false, target };
}

/**
 * Охотник на чудовищ с выбранными типами «Гримуара».
 *
 * @param {object[]} activeEffects - эффекты листа
 * @param {string[]} types - типы существ из «Гримуара»
 * @returns {object} персонаж
 */
function hunter(activeEffects, types = ['undead', 'fiend']) {
  const actor = createActor({ activeEffects });

  actor.system = {
    ...actor.system,
    classes: [
      {
        classKey: 'monster-hunter',
        className: 'Охотник на чудовищ',
        level: 5,
        subclassKey: null,
        hitDie: 10,
        hitDiceUsed: 0,
        hitPointsGained: [],
        chosenSkills: [],
        featureChoices: {},
        choiceAnswers: { 'monster-manual': types },
      },
    ],
  };

  return actor;
}

/**
 * Срабатывание эффекта в форме источника.
 *
 * @param {object} effect - эффект
 * @returns {object} срабатывание с источником
 */
function sourceOf(effect) {
  return {
    effect,
    trigger: effect.triggers[0],
    ambient: false,
    instance: true,
    scope: effect.id,
  };
}

describe('каталог: условия и область действия', () => {
  it('[CS01] Непристойный жест: помеха атакам по всем, кроме наложившего', () => {
    // «До начала вашего следующего хода совершает с помехой броски атаки по
    // всем существам, кроме вас»
    const gesture = createEffect('Непристойный жест', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      flags: ['attack.disadvantage'],
      rollCondition: engine.TARGET_NOT_SOURCE_CONDITION,
      duration: { type: 'turn', value: 1 },
    });

    authoredScenario(gesture, 'feature');

    // На цели — наложенная копия с тем, кто наложил
    const applied = {
      ...gesture,
      activation: undefined,
      sourceActorId: SOURCE_ID,
    };

    assert.deepEqual(
      engine.collectRollConditionFlags(
        [applied],
        rollAt(targetOf('actor_other')),
      ),
      ['attack.disadvantage'],
      'бьёт не по наложившему — помеха',
    );

    assert.deepEqual(
      engine.collectRollConditionFlags([applied], rollAt(targetOf(SOURCE_ID))),
      [],
      'бьёт по наложившему — без помехи',
    );

    // Без цели и без наложившего данных нет: условие не выполняется
    assert.deepEqual(
      engine.collectRollConditionFlags([applied], {
        hasAdvantage: false,
        hasDisadvantage: false,
      }),
      [],
    );

    assert.deepEqual(
      engine.collectRollConditionFlags(
        [{ ...applied, sourceActorId: undefined }],
        rollAt(targetOf('actor_other')),
      ),
      [],
    );

    // В числа листа такой эффект не входит
    const carrier = createCreature({ activeEffects: [applied] });

    assert.equal(
      engine.resolveActorStats(carrier).activeFlags.has('attack.disadvantage'),
      false,
    );
  });

  it('[CS02] Мерцание: помеха на атаки по наложившему', () => {
    // «Мерцает магическим светом до начала вашего следующего хода… получая
    // помеху на броски атаки против вас»
    const flicker = createEffect('Мерцание', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      flags: ['attack.disadvantage'],
      rollCondition: engine.TARGET_IS_SOURCE_CONDITION,
      duration: { type: 'turn', value: 1 },
    });

    authoredScenario(flicker, 'feature');

    const applied = {
      ...flicker,
      activation: undefined,
      sourceActorId: SOURCE_ID,
    };

    assert.deepEqual(
      engine.collectRollConditionFlags([applied], rollAt(targetOf(SOURCE_ID))),
      ['attack.disadvantage'],
    );

    assert.deepEqual(
      engine.collectRollConditionFlags(
        [applied],
        rollAt(targetOf('actor_other')),
      ),
      [],
    );
  });

  it('[CS03] «Все, кроме вас»: преимущество атак по цели не для наложившего', () => {
    const exposed = createEffect('Уязвимое место', {
      effectTarget: 'target',
      flags: ['attacksAgainst.advantage'],
      rollCondition: engine.INCOMING_ATTACKER_NOT_SOURCE_CONDITION,
      duration: { type: 'turn', value: 1 },
      sourceActorId: SOURCE_ID,
    });

    authoredScenario(exposed, 'spell');

    assert.deepEqual(
      engine.collectIncomingAttackFlags([exposed], {
        attackType: 'melee',
        attackerId: 'actor_ally',
      }),
      ['attacksAgainst.advantage'],
    );

    assert.deepEqual(
      engine.collectIncomingAttackFlags([exposed], {
        attackType: 'melee',
        attackerId: SOURCE_ID,
      }),
      [],
    );

    // Обратное условие — «только наложивший»
    const marked = {
      ...exposed,
      rollCondition: engine.INCOMING_ATTACKER_IS_SOURCE_CONDITION,
    };

    assert.deepEqual(
      engine.collectIncomingAttackFlags([marked], {
        attackType: 'ranged',
        attackerId: SOURCE_ID,
      }),
      ['attacksAgainst.advantage'],
    );

    // Кто атакует, неизвестно — условие не выполняется
    assert.deepEqual(
      engine.collectIncomingAttackFlags([exposed], { attackType: 'melee' }),
      [],
    );
  });

  it('[CS04] Улучшенный Гримуар: крит на 19–20 по типам из выбора владельца', () => {
    // «Броски атаки оружием против типов существ из Гримуара наносят
    // критическое попадание при 19 или 20»
    const grimoire = createEffect('Улучшенный Гримуар монстров', {
      changes: [
        change('critThreshold', '19', {
          mode: 'downgrade',
          condition: 'target.creatureType === "@choice.monster-manual"',
        }),
      ],
    });

    authoredScenario(grimoire, 'feature');

    const actor = hunter([grimoire]);
    const effects = engine.collectActiveEffects(actor);

    assert.equal(
      effects[0].changes[0].condition,
      'target.creatureType === "undead, fiend"',
      'лист подставил выбранные типы',
    );

    assert.equal(
      engine.resolveActorStats(actor).critThreshold,
      20,
      'в числа листа условие о цели не входит',
    );

    assert.equal(
      engine.resolveRollCritThreshold(
        effects,
        20,
        rollAt(targetOf('zombie', { creatureType: 'undead' })),
      ),
      19,
    );

    assert.equal(
      engine.resolveRollCritThreshold(
        effects,
        20,
        rollAt(targetOf('wolf', { creatureType: 'beast' })),
      ),
      20,
    );

    // Выбор не сделан — токен остаётся, условие не выполняется
    const blank = createActor({ activeEffects: [grimoire] });

    assert.equal(
      engine.resolveRollCritThreshold(
        engine.collectActiveEffects(blank),
        20,
        rollAt(targetOf('zombie', { creatureType: 'undead' })),
      ),
      20,
    );

    // Значения выбора названиями типов читаются так же, как ключами
    const named = hunter([grimoire], ['Нежить', 'Исчадие']);

    assert.equal(
      engine.resolveRollCritThreshold(
        engine.collectActiveEffects(named),
        20,
        rollAt(targetOf('imp', { creatureType: 'fiend' })),
      ),
      19,
    );
  });

  it('[CS05] Тайное вмешательство, Магическая защита: спасброски от заклинаний типов из Гримуара', () => {
    // «Спасброски против заклинаний, накладываемых типами существ из вашего
    // Гримуара монстров, с преимуществом»; аура 20 фт — то же союзникам
    const intervention = createEffect('Тайное вмешательство', {
      flags: ['save.advantage.vsSpell'],
      rollCondition: 'source.creatureType === "@choice.monster-manual"',
    });

    authoredScenario(intervention, 'feature');

    const actor = hunter([intervention]);
    const effects = engine.collectActiveEffects(actor);

    assert.deepEqual(
      engine.resolveSaveSourceAdjustments(effects, 'wisdom', {
        sourceCreatureType: 'fiend',
      }).flags,
      ['save.advantage.vsSpell'],
    );

    assert.deepEqual(
      engine.resolveSaveSourceAdjustments(effects, 'wisdom', {
        sourceCreatureType: 'dragon',
      }).flags,
      [],
    );

    // Аура несёт выбор того, кто её излучает, а не союзника в ней
    const ward = createEffect('Магическая защита', {
      aura: { radius: 20, target: 'allies', applyToSelf: true },
      flags: ['save.advantage.vsSpell'],
      rollCondition: 'source.creatureType === "@choice.monster-manual"',
    });

    authoredScenario(ward, 'feature');

    const auras = engine.collectAllAuraEffects(hunter([ward], ['aberration']));

    assert.equal(
      auras[0].rollCondition,
      'source.creatureType === "aberration"',
    );

    assert.deepEqual(
      engine.resolveSaveSourceAdjustments(auras, 'wisdom', {
        sourceCreatureType: 'aberration',
      }).flags,
      ['save.advantage.vsSpell'],
    );

    // Разбор условия в окне: ключ выбора вместо списка типов
    const parsed = engine.parseAnyCreatureTypeCondition(
      intervention.rollCondition,
    );

    assert.equal(parsed.condition.choiceKey, 'monster-manual');

    assert.equal(
      engine.writeCreatureTypeCondition(parsed.subject, parsed.condition),
      intervention.rollCondition,
    );

    assert.equal(
      engine.describeCreatureTypeCondition(parsed.subject, parsed.condition),
      'Источник спасброска — тип из выбора владельца (monster-manual)',
    );
  });

  it('[CS06] Защита от зла и добра, Истинная стойкость: иммунитет к состоянию от существ типа', () => {
    // «Не может быть одержима и получать состояния очарованный или испуганный
    // от таких существ»
    const protection = createEffect('Защита от зла и добра', {
      effectTarget: 'target',
      conditionImmunities: ['charmed', 'frightened'],
      rollCondition:
        'source.creatureType === "aberration, celestial, elemental, fey, fiend, undead"',
      duration: { type: 'minutes', value: 10 },
    });

    authoredScenario(protection, 'spell');

    const warded = createActor({ activeEffects: [protection] });

    assert.deepEqual(
      engine.getEntityConditionImmunities(warded, [], 'undead'),
      ['charmed', 'frightened'],
    );

    assert.deepEqual(
      engine.getEntityConditionImmunities(warded, [], 'humanoid'),
      [],
      'гуманоид пугает как обычно',
    );

    assert.deepEqual(
      engine.getEntityConditionImmunities(warded),
      [],
      'кто накладывает, неизвестно — иммунитета нет',
    );

    // Состояние от нежити не ложится, от гуманоида — ложится
    const fear = createEffect('Ужасающий взгляд', {
      conditionKey: 'frightened',
      effectTarget: 'target',
    });

    const fromUndead = engine.applyEffectsToEntity(
      warded,
      [{ ...fear, sourceCreatureType: 'undead' }],
      'spell',
    );

    assert.equal(
      fromUndead.some((effect) => effect.conditionKey === 'frightened'),
      false,
    );

    const fromBandit = engine.applyEffectsToEntity(
      warded,
      [{ ...fear, sourceCreatureType: 'humanoid' }],
      'spell',
    );

    assert.equal(
      fromBandit.some((effect) => effect.conditionKey === 'frightened'),
      true,
    );

    // Обычный иммунитет без условия действует всегда, как раньше
    const brave = createActor({
      activeEffects: [
        createEffect('Аура отваги', { conditionImmunities: ['frightened'] }),
      ],
    });

    assert.deepEqual(engine.getEntityConditionImmunities(brave), [
      'frightened',
    ]);

    // Истинная стойкость: типы — из Гримуара владельца
    const fortitude = createEffect('Истинная стойкость', {
      conditionImmunities: ['frightened'],
      rollCondition: 'source.creatureType === "@choice.monster-manual"',
    });

    authoredScenario(fortitude, 'feature');

    const carver = hunter([fortitude]);

    assert.deepEqual(engine.getEntityConditionImmunities(carver, [], 'fiend'), [
      'frightened',
    ]);

    assert.deepEqual(
      engine.getEntityConditionImmunities(carver, [], 'beast'),
      [],
    );
  });

  it('[CS07] Рассеивание добра и зла: снять состояния, наложенные существами типа', () => {
    // «Цель перестаёт быть одержимой, очарованной или испуганной такими
    // существами»
    const breakEnchantment = createEffect('Разрушение чар', {
      effectTarget: 'target',
      duration: { type: 'special' },
      triggers: [
        {
          id: 'trigger_break',
          event: 'applied',
          actions: [
            {
              type: 'removeCondition',
              conditionKey: 'charmed',
              fromCreatureTypes: ['fey', 'fiend', 'undead'],
            },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    authoredScenario(breakEnchantment, 'spell');

    const victim = createActor({
      activeEffects: [
        createEffect('Чары вампира', {
          conditionKey: 'charmed',
          sourceCreatureType: 'undead',
        }),
        createEffect('Чары барда', {
          conditionKey: 'charmed',
          sourceCreatureType: 'humanoid',
        }),
        createEffect('Чары без источника', { conditionKey: 'charmed' }),
      ],
    });

    engine.applyTriggerEffectActions(victim, sourceOf(breakEnchantment), false);

    assert.deepEqual(
      victim.activeEffects.map((effect) => effect.name),
      ['Чары барда', 'Чары без источника'],
      'снято только наложенное нежитью',
    );

    assert.match(
      engine.describeEffectTrigger(breakEnchantment.triggers[0], {
        formatDc: (save) => String(save.dc),
      }),
      /наложенное существом типа: Фея или Исчадие или Нежить/,
    );

    // Чужой тип в списке выбрасывается один
    const parsed = engine.ActiveEffectSchema.parse({
      ...breakEnchantment,
      triggers: [
        {
          ...breakEnchantment.triggers[0],
          actions: [
            { type: 'removeCondition', fromCreatureTypes: ['fey', 'robot'] },
          ],
        },
      ],
    });

    assert.deepEqual(parsed.triggers[0].actions[0].fromCreatureTypes, ['fey']);
  });

  it('[CS08] Когти вурдалака: паралич не ложится на нежить и эльфов', () => {
    // «Если цель — существо, которое не является нежитью или эльфом»
    const claws = createEffect('Когти', {
      conditionKey: 'paralyzed',
      effectTarget: 'target',
      applySave: { ability: 'constitution', dc: 10, onSuccess: 'negate' },
      landingCondition:
        'self.creatureType !== "undead" && self.species !== "эльф"',
      duration: { type: 'minutes', value: 1 },
    });

    authoredScenario(claws, 'creatureAction');

    const human = createActor();

    human.system = {
      ...human.system,
      species: { speciesKey: 'human', speciesName: 'Человек' },
    };

    const elf = createActor();

    elf.system = {
      ...elf.system,
      species: {
        speciesKey: 'elf',
        speciesName: 'Эльф',
        subspeciesName: 'Лесной эльф',
      },
    };

    const zombie = createCreature();

    zombie.system = { ...zombie.system, type: 'undead', subtype: '' };

    const elfScout = createCreature();

    elfScout.system = { ...elfScout.system, type: 'humanoid', subtype: 'Эльф' };

    const wolf = createCreature();

    wolf.system = { ...wolf.system, type: 'beast', subtype: '' };

    assert.equal(engine.passesLandingCondition(claws, human), true);
    assert.equal(engine.passesLandingCondition(claws, elf), false);
    assert.equal(engine.passesLandingCondition(claws, zombie), false);

    assert.equal(
      engine.passesLandingCondition(claws, elfScout),
      false,
      'подтип статблока — тот же «вид»',
    );

    assert.equal(
      engine.passesLandingCondition(claws, wolf),
      true,
      'существо без подтипа — точно не эльф',
    );

    // Условия о виде другой стороны и по списку
    assert.deepEqual(
      engine.parseTriggerConditionPart('target.species !== "эльф, дроу"'),
      {
        kind: 'otherSpeciesNot',
        value: 'эльф, дроу',
      },
    );

    assert.equal(
      engine.isTriggerConditionMet(
        human,
        { condition: 'target.species === "эльф, дроу"' },
        { other: elf },
      ),
      true,
    );

    assert.deepEqual(engine.listEntitySpeciesNames(elf), [
      'elf',
      'эльф',
      'лесной эльф',
    ]);
  });

  it('[CS09] Пояс дварфов: дополнительные свойства — только не дварфу', () => {
    // «Если вы — не дварф и не дуэргар, то получаете дополнительные эффекты»
    const belt = createEffect('Пояс дварфов', {
      changes: [
        change('sense.darkvision', '60', {
          mode: 'upgrade',
          condition: 'self.species !== "дварф, дуэргар"',
        }),
        change('ability.constitution', 'min(2, max(0, 20 - @con))'),
      ],
      flags: [],
    });

    authoredScenario(belt, 'item');

    const human = createActor({ activeEffects: [belt] });

    human.system = {
      ...human.system,
      species: { speciesKey: 'human', speciesName: 'Человек' },
    };

    const dwarf = createActor({ activeEffects: [belt] });

    dwarf.system = {
      ...dwarf.system,
      species: { speciesKey: 'dwarf', speciesName: 'Дварф' },
    };

    assert.equal(engine.resolveActorStats(human).senses.darkvision, 60);

    assert.equal(
      engine.resolveActorStats(dwarf).senses.darkvision,
      0,
      'условие о носителе считается на листе',
    );
  });

  it('[CS10] Похищение бессмертия: ещё один тип существа в дополнение к своему', () => {
    // «Вы получаете тип существа цели в дополнение к собственному»
    const stolen = createEffect('Похищение бессмертия: Фея', {
      changes: [change('creatureType.extra', 'fey', { mode: 'override' })],
      duration: { type: 'hours', value: 1 },
    });

    authoredScenario(stolen, 'spell');

    const caster = createActor({ activeEffects: [stolen] });

    assert.equal(engine.resolveEntityCreatureType(caster), 'humanoid');
    assert.deepEqual(engine.resolveEntityExtraCreatureTypes(caster), ['fey']);

    // Условия по типу считают оба типа: «из списка» — любой, «не из» — ни один
    const feyOnly = { types: ['fey'], negate: false };
    const notFey = { types: ['fey'], negate: true };

    assert.equal(
      engine.creatureTypeConditionHolds(feyOnly, 'humanoid', ['fey']),
      true,
    );

    assert.equal(
      engine.creatureTypeConditionHolds(notFey, 'humanoid', ['fey']),
      false,
    );

    assert.equal(engine.creatureTypeConditionHolds(notFey, 'humanoid'), true);

    // Условие о носителе на листе и в срабатывании
    assert.equal(
      engine.isTriggerConditionMet(caster, {
        condition: 'self.creatureType === "fey"',
      }),
      true,
    );

    assert.equal(
      engine.isTriggerConditionMet(caster, {
        condition: 'self.creatureType === "humanoid"',
      }),
      true,
      'свой тип остаётся',
    );

    // Тип, которого нет в справочнике, ничего не добавляет
    const broken = createActor({
      activeEffects: [
        createEffect('Сломанный', {
          changes: [change('creatureType.extra', 'robot')],
        }),
      ],
    });

    assert.deepEqual(engine.resolveEntityExtraCreatureTypes(broken), []);
  });

  it('[CS11] Сл «8 + БМ + модификатор характеристики, увеличенной этой чертой»', () => {
    // Телекинетик: «Сл. 8 + ваш бонус мастерства + ваш модификатор
    // характеристики, которую вы увеличили данной чертой»
    const shove = createEffect('Телекинетический толчок', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      originId: 'feat:feature_telekinetic',
      applySave: {
        ability: 'strength',
        dc: 10,
        dcFormula: '8 + @prof + @mod.feat',
        onSuccess: 'negate',
      },
      duration: { type: 'special' },
    });

    authoredScenario(shove, 'feature');

    const actor = createActor({ activeEffects: [shove] });

    actor.features = [
      {
        id: 'feature_telekinetic',
        name: 'Телекинетик',
        featData: {
          abilityScoreIncrease: { fromChoiceKey: 'spellcasting-ability' },
          choices: [
            { key: 'spellcasting-ability', type: 'spellcastingAbility' },
          ],
        },
        choices: { 'spellcasting-ability': ['charisma'] },
      },
    ];

    const [bound] = engine.bindOwnerTokens([shove], actor);

    assert.equal(bound.applySave.dcFormula, '8 + @prof + @mod.cha');

    // Черта с повышением характеристики по своему ключу — та же подстановка
    actor.features = [
      {
        id: 'feature_telekinetic',
        name: 'Отравитель',
        featData: { abilityScoreIncrease: { choice: { amount: 1 } } },
        choices: { [engine.ABILITY_INCREASE_CHOICE_KEY]: ['dexterity'] },
      },
    ];

    assert.equal(
      engine.bindOwnerTokens([shove], actor)[0].applySave.dcFormula,
      '8 + @prof + @mod.dex',
    );

    // Чужой эффект (не этой черты) и черта без выбора токен не трогают
    const foreign = { ...shove, originId: 'feat:feature_other' };

    assert.equal(
      engine.bindOwnerTokens([foreign], actor)[0].applySave.dcFormula,
      '8 + @prof + @mod.feat',
    );

    // Существо выборов не делает
    assert.equal(engine.bindOwnerTokens([shove], createCreature())[0], shove);
  });

  it('[CS12] Властное подчинение: Сл — итог проверки навыка применившего', () => {
    // «Совершите проверку Харизмы (Запугивание)… спасбросок Мудрости со Сл.,
    // равной результату вашей проверки»
    const dread = createEffect('Устрашение', {
      conditionKey: 'frightened',
      activation: { mode: 'use' },
      effectTarget: 'target',
      applySave: {
        ability: 'wisdom',
        dc: 10,
        dcSkill: 'intimidation',
        onSuccess: 'negate',
      },
      duration: { type: 'minutes', value: 1 },
    });

    const scenario = authoredScenario(dread, 'feature');

    assert.match(scenario, /при применении — итог проверки: Запугивание/);
    assert.deepEqual(engine.listSaveDcSkills([dread]), ['intimidation']);

    const stamped = engine.stampSkillCheckDc(dread, 'intimidation', 17);

    assert.equal(stamped.applySave.dc, 17);
    assert.equal(stamped.applySave.dcSkill, undefined);

    assert.equal(
      engine.stampSkillCheckDc(dread, 'persuasion', 17),
      dread,
      'проверка другого навыка эту Сл не задаёт',
    );

    assert.equal(
      engine.stampSkillCheckDc(dread, 'intimidation', -2).applySave.dc,
      1,
      'Сл не меньше единицы',
    );

    // Чужой навык из данных выбрасывается, спасбросок остаётся
    assert.equal(
      engine.ActiveEffectSchema.parse({
        ...dread,
        applySave: { ...dread.applySave, dcSkill: 'cooking' },
      }).applySave.dcSkill,
      undefined,
    );
  });

  it('[CS13] Ревность: спасбросок Силы или Ловкости — лучшей у цели', () => {
    // «Существо совершает спасбросок Силы или Ловкости (Сл. 8 + мод.
    // Телосложения + БМ)… схваченный до конца своего хода»
    const jealousy = createEffect('Ревность', {
      conditionKey: 'grappled',
      activation: { mode: 'use' },
      effectTarget: 'target',
      applySave: {
        ability: 'strength',
        altAbilities: ['dexterity'],
        dc: 10,
        dcFormula: '8 + @mod.con + @prof',
        onSuccess: 'negate',
      },
      duration: { type: 'turn', value: 1 },
    });

    const scenario = authoredScenario(jealousy, 'feature');

    assert.match(scenario, /спасбросок Силы или Ловкости/);

    const nimble = createActor();

    nimble.system = {
      ...nimble.system,
      abilities: { ...nimble.system.abilities, strength: 8, dexterity: 18 },
    };

    assert.equal(
      engine.pickSaveAbility(nimble, jealousy.applySave),
      'dexterity',
    );

    const strong = createActor();

    strong.system = {
      ...strong.system,
      abilities: { ...strong.system.abilities, strength: 18, dexterity: 8 },
    };

    assert.equal(
      engine.pickSaveAbility(strong, jealousy.applySave),
      'strength',
    );

    // Поровну — первая по записи; спасбросок сервера у зоны берёт ту же
    assert.equal(
      engine.pickSaveAbility(createActor(), jealousy.applySave),
      'strength',
    );

    assert.equal(
      engine.buildApplySaveSpec(jealousy, jealousy.applySave, nimble).ability,
      'dexterity',
    );

    // Срабатывание: тот же выбор
    const snare = createEffect('Призрачные путы', {
      triggers: [
        {
          id: 'trigger_snare',
          event: 'turnStart',
          save: { ability: 'strength', altAbilities: ['dexterity'], dc: 13 },
          actions: [{ type: 'applyCondition', conditionKey: 'grappled' }],
        },
      ],
    });

    assert.equal(
      engine.buildTriggerSaveSpec(snare, snare.triggers[0], {
        entity: nimble,
        eventData: {},
      }).ability,
      'dexterity',
    );

    // Чужая характеристика в списке выбрасывается одна
    assert.deepEqual(
      engine.ActiveEffectSchema.parse({
        ...jealousy,
        applySave: {
          ...jealousy.applySave,
          altAbilities: ['dexterity', 'luck'],
        },
      }).applySave.altAbilities,
      ['dexterity'],
    );
  });

  it('[CS14] Аспект тирании: штраф к спасброску за каждого пострадавшего — вариантом', () => {
    // «Штраф −1 к своему спасброску за каждое другое существо, пострадавшее…
    // в тот же ход» — сколько их, называет игрок при применении: вариант
    // группы со своей Сл
    const variants = [0, 1, 2].map((others) =>
      createEffect(`Аспект тирании: пострадало ещё ${others}`, {
        activation: { mode: 'use' },
        effectTarget: 'target',
        conditionKey: 'frightened',
        variant: { group: 'tyranny', label: `ещё ${others}` },
        applySave: {
          ability: 'wisdom',
          dc: 10,
          dcFormula: `8 + @prof + @mod.cha + ${others}`,
          onSuccess: 'negate',
        },
        duration: { type: 'turn', value: 1 },
      }),
    );

    for (const variant of variants) {
      authoredScenario(variant, 'feature');
    }

    assert.equal(
      new Set(variants.map((variant) => variant.applySave.dcFormula)).size,
      variants.length,
      'у каждого варианта своя Сл: +1 к Сл — тот же −1 к спасброску',
    );
  });

  it('[CS15] Перенаправление энергии: урон одного из выбранных типов', () => {
    // «Когда вы получаете урон одного из выбранных типов, реакцией…»
    const redirect = createEffect('Перенаправление энергии', {
      originId: 'feat:feature_boon',
      triggers: [
        {
          id: 'trigger_redirect',
          event: 'damageTaken',
          cost: 'reaction',
          condition: 'damage.type === "@choice.energy"',
          actions: [{ type: 'notify', text: 'Перенаправление' }],
        },
      ],
    });

    authoredScenario(redirect, 'feature');

    assert.deepEqual(
      engine.parseTriggerConditionPart(redirect.triggers[0].condition),
      { kind: 'damageTypeChosen', value: 'energy' },
    );

    assert.equal(
      engine.buildTriggerConditionPart({
        kind: 'damageTypeChosen',
        value: 'energy',
      }),
      redirect.triggers[0].condition,
    );

    const actor = createActor({ activeEffects: [redirect] });

    actor.features = [
      {
        id: 'feature_boon',
        name: 'Дар стойкости к энергии',
        choices: { energy: ['fire', 'cold'] },
      },
    ];

    const [bound] = engine.collectActiveEffects(actor);

    assert.equal(bound.triggers[0].condition, 'damage.type === "fire, cold"');

    const burned = { damage: { amount: 8, types: ['fire'], critical: false } };

    const shocked = {
      damage: { amount: 8, types: ['lightning'], critical: false },
    };

    assert.equal(
      engine.isTriggerConditionMet(actor, bound.triggers[0], burned),
      true,
    );

    assert.equal(
      engine.isTriggerConditionMet(actor, bound.triggers[0], shocked),
      false,
    );

    // Выбор не подставлен — условие не выполняется
    assert.equal(
      engine.isTriggerConditionMet(actor, redirect.triggers[0], burned),
      false,
    );
  });
});
