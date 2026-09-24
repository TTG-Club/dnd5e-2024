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
  setHitPoints,
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

  it('[F01b] Ярость: включение тратит ресурс, будит «При включении», по истечении выключается', () => {
    const rage = createEffect(engine.buildClassEffectId('barbarian', 'rage'), {
      name: 'Ярость',
      activation: { mode: 'toggle', counter: 'rage' },
      flags: ['resistance.slashing'],
      changes: [change('damage.melee', '2')],
      duration: { type: 'turn', turnAnchor: 'carrier', turnTiming: 'end' },
      triggers: [
        {
          id: 'trigger_rage_on',
          event: 'activate',
          actions: [{ type: 'applyTag', tag: 'raging', label: 'В ярости' }],
        },
      ],
    });

    assert.match(
      authoredScenario(rage, 'feature'),
      /^Пока эффект включён, тратит «rage»/,
    );

    const sheetRage = engine.withActivationDefaults(rage);

    assert.equal(
      sheetRage.disabled,
      true,
      'с листа умение приходит выключенным',
    );

    const barbarian = hero({
      classKey: 'barbarian',
      level: 3,
      overrides: { activeEffects: [sheetRage] },
    });

    assert.equal(engine.resolveActorStats(barbarian).damageBonuses.melee, 0);

    const counters = [{ counterKey: 'rage', current: 1, max: 2 }];

    assert.equal(engine.canPayActivation(counters, rage.activation), true);

    const paid = engine.payActivation(counters, rage.activation);

    assert.equal(paid[0].current, 0);
    assert.equal(engine.canPayActivation(paid, rage.activation), false);

    const raging = engine.activateEffectOnEntity(barbarian, rage.id);

    assert.equal(barbarian.activeEffects[0].disabled, true, 'лист не тронут');
    assert.equal(engine.resolveActorStats(raging).damageBonuses.melee, 2);

    assert.ok(
      raging.activeEffects.some((effect) => effect.tag === 'raging'),
      'сработало «При включении»',
    );

    engine.expireTurnEffects(raging, raging.id, 'end');

    const expired = raging.activeEffects.find(
      (effect) => effect.id === rage.id,
    );

    assert.equal(
      expired?.disabled,
      true,
      'умение осталось на листе выключенным',
    );

    assert.equal(engine.resolveActorStats(raging).damageBonuses.melee, 0);

    const again = engine.activateEffectOnEntity(raging, rage.id);

    engine.removeEffectsById(again, new Set([rage.id]));

    assert.equal(
      again.activeEffects.find((effect) => effect.id === rage.id)?.disabled,
      true,
      '«Снять эффект» выключает переключаемый',
    );
  });

  it('[F01c] Ярость: бонус урона только атакам Силой, в броске не удваивается', () => {
    const rage = createEffect(engine.buildClassEffectId('barbarian', 'rage'), {
      name: 'Ярость',
      changes: [
        change('damage.melee', '2', {
          condition: 'attack.ability === "strength"',
        }),
      ],
    });

    authoredScenario(rage, 'feature');

    const barbarian = hero({
      classKey: 'barbarian',
      level: 3,
      abilities: { strength: 16, dexterity: 18 },
      overrides: { activeEffects: [rage] },
    });

    const stats = engine.resolveActorStats(barbarian);

    /**
     * Прибавка эффектов в разборе урона оружия.
     *
     * @param {object} weapon - оружие
     * @returns {number} прибавка строки «Эффекты»
     */
    const effectsPart = (weapon) => {
      const parts = engine.describeWeaponDamage(barbarian, weapon, stats);
      const effects = parts.find((part) => part.key === 'effects');

      return effects ? effects.value : 0;
    };

    const weapon = (name, overrides) => ({
      id: name,
      name,
      type: 'weapon',
      rangeType: 'melee',
      damageParts: [{ formula: '1d8' }],
      ...overrides,
    });

    assert.equal(effectsPart(weapon('Секира')), 2, 'удар Силой — бонус есть');

    assert.equal(
      effectsPart(weapon('Рапира', { weaponProperties: ['finesse'] })),
      0,
      'фехтовальное оружие бьёт Ловкостью (18 > 16) — бонуса нет',
    );

    assert.equal(
      effectsPart(weapon('Лук', { rangeType: 'ranged' })),
      0,
      'дальнобойное бьёт Ловкостью, да и бонус заявлен рукопашному',
    );

    assert.equal(
      stats.damageBonuses.melee,
      0,
      'общий бонус рукопашного урона не растёт — только у оружия Силой',
    );

    assert.equal(
      engine.evaluateConditionalBonuses(
        barbarian.activeEffects,
        'damage.melee',
        {
          hasAdvantage: false,
          hasDisadvantage: false,
        },
      ),
      0,
      'в броске бонус второй раз не считается',
    );
  });

  it('[F16] Божественный канал: применение тратит ресурс, копия ложится на цель', () => {
    const turn = createEffect('Изгнание нечисти', {
      activation: { mode: 'use', counter: 'channelDivinity' },
      effectTarget: 'target',
      conditionKey: 'frightened',
      applySave: { ability: 'wisdom', dc: 0, onSuccess: 'negate' },
      duration: { type: 'minutes', value: 1 },
    });

    assert.match(
      authoredScenario(turn, 'ownEffects'),
      /^При применении — на выбранной цели, тратит «channelDivinity»/,
    );

    const cleric = createActor({ activeEffects: [turn] });

    assert.deepEqual(
      engine.resolveActorStats(cleric).activeFlags,
      engine.resolveActorStats(createActor()).activeFlags,
      'шаблон применения на листе не действует',
    );

    const spell = engine.buildEffectUseSpell(turn);

    assert.equal(spell.rollSource, 'effect');

    assert.deepEqual(
      engine.getTargetSpellEffects(spell).map((effect) => effect.name),
      ['Изгнание нечисти'],
    );

    assert.equal(
      engine.canPayActivation(
        [{ counterKey: 'channelDivinity', current: 0, max: 2 }],
        turn.activation,
      ),
      false,
    );
  });

  it('[F19] Божественная искра: варианты одного применения, ресурс и дальность', () => {
    const spark = (label, overrides) =>
      createEffect(engine.buildClassEffectId('cleric', `spark-${label}`), {
        name: label,
        origin: 'feature',
        originId: 'cleric',
        disabled: true,
        activation: { mode: 'use', counter: 'channel-divinity', range: 30 },
        variant: { group: 'Божественная искра', label },
        effectTarget: 'target',
        duration: { type: 'instantaneous' },
        ...overrides,
      });

    const heal = spark('Лечение', {
      triggers: [
        {
          id: 'spark-heal',
          event: 'applied',
          actions: [
            {
              type: 'damage',
              parts: [
                {
                  formula:
                    '(1 + steps(@classLevel, 7, 13, 18))к8@heal + @mod.wis',
                },
              ],
            },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    const radiant = spark('Излучение', {
      applySave: { ability: 'constitution', dc: 0, onSuccess: 'half' },
      damageParts: [
        {
          formula: '(1 + steps(@classLevel, 7, 13, 18))к8 + @mod.wis',
          type: 'radiant',
        },
      ],
    });

    const turnUndead = createEffect(
      engine.buildClassEffectId('cleric', 'turn-undead'),
      {
        name: 'Изгнание нежити',
        origin: 'feature',
        originId: 'cleric',
        disabled: true,
        activation: { mode: 'use', counter: 'channel-divinity' },
        effectTarget: 'target',
      },
    );

    const sheet = [heal, turnUndead, radiant];

    const group = engine.collectEffectUseGroup(sheet, radiant);

    assert.deepEqual(
      group.map((effect) => effect.name),
      ['Лечение', 'Излучение'],
      'варианты одной группы — одно применение, в порядке листа',
    );

    assert.deepEqual(
      engine.collectEffectUseGroup(sheet, turnUndead),
      [turnUndead],
      'тот же ресурс без группы — отдельное применение',
    );

    assert.equal(engine.effectUseGroupName(group), 'Божественная искра');

    const spell = engine.buildEffectGroupUseSpell(group);

    assert.equal(spell.range, 30, 'дальность из применения, а не касание');
    assert.equal(spell.deliveryType, 'none');

    assert.deepEqual(
      engine
        .listEffectVariantGroups(spell.activeEffects)
        .map((entry) => [entry.group, entry.labels]),
      [['Божественная искра', ['Лечение', 'Излучение']]],
      'окно выбора видит все варианты, шаблоны листа — включёнными',
    );

    assert.deepEqual(
      engine
        .pickEffectVariants(spell.activeEffects, {
          'Божественная искра': 'Излучение',
        })
        .map((effect) => effect.name),
      ['Излучение'],
    );

    // Жрец 7 уровня с Мудростью 16: вторая к8 и +3 — его, а не цели
    const cleric = hero({
      classKey: 'cleric',
      level: 7,
      abilities: { wisdom: 16 },
    });

    const [boundHeal, boundRadiant] = engine.bindTargetEffectsToSource(
      group,
      cleric,
      engine.buildFormulaContext(cleric),
    );

    assert.equal(
      boundHeal.triggers[0].actions[0].parts[0].formula,
      '2к8@heal + 3',
      'лечение срабатывания — числами жреца, кости по ступени уровня',
    );

    assert.equal(boundRadiant.damageParts[0].formula, '2к8 + 3');

    const healing = engine.rollEffectHealing(
      boundHeal.name,
      boundHeal.triggers[0].actions[0].parts,
    );

    assert.equal(
      healing?.healed,
      (healing?.values ?? []).reduce((sum, value) => sum + value, 3),
      'лечение — две к8 и Мудрость жреца',
    );

    assert.equal(healing?.values.length, 2, 'брошено две к8');
  });

  it('[F17] Аура защиты: радиус растёт с уровнем и гаснет у недееспособного', () => {
    const aura = createEffect(
      engine.buildClassEffectId('paladin', 'auraOfProtection'),
      {
        name: 'Аура защиты',
        aura: {
          radius: 10,
          radiusFormula: '10 + 20 * floor(@classLevel / 18)',
          whileCapable: true,
          target: 'allies',
          applyToSelf: true,
          visible: true,
        },
        changes: [change('save.wisdom', '@mod.cha')],
      },
    );

    assert.match(
      authoredScenario(aura, 'feature'),
      /floor\(@classLevel \/ 18\) фт \(союзники\), пока носитель дееспособен/,
    );

    const radiusAt = (level, extraEffects = []) =>
      engine
        .collectAllAuraEffects(
          hero({
            classKey: 'paladin',
            level,
            overrides: { activeEffects: [aura, ...extraEffects] },
          }),
        )
        .map((effect) => effect.aura.radius);

    assert.deepEqual(radiusAt(6), [10]);
    assert.deepEqual(radiusAt(18), [30]);

    const stunned = createEffect('Ошеломлён', { flags: ['incapacitated'] });

    assert.deepEqual(radiusAt(6, [stunned]), [], 'недееспособный ауру гасит');
  });

  it('[F18] Стойкий: преимущество на спасброски от смерти', () => {
    const durable = createEffect('Стойкий', {
      flags: ['save.advantage.death'],
      changes: [change('deathSave', '1')],
    });

    authoredScenario(durable, 'feature');

    const stats = engine.resolveActorStats(
      createActor({ activeEffects: [durable] }),
    );

    assert.equal(
      engine.resolveDeathSaveRollMode(stats.activeFlags),
      'advantage',
    );

    assert.equal(stats.deathSaveBonus, 1);

    assert.equal(
      stats.saves.constitution,
      engine.resolveActorStats(createActor()).saves.constitution,
    );
  });

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

  it('[F08] Увёртливость: успех спасброска Ловкости — без урона, провал — половина', () => {
    const evasion = createEffect('Увёртливость', {
      flags: ['save.evasion.dexterity'],
    });

    authoredScenario(evasion, 'feature');

    const { activeFlags } = engine.resolveActorStats(
      hero({ overrides: { activeEffects: [evasion] } }),
    );

    const defense = { flags: activeFlags, ability: 'dexterity' };

    assert.equal(engine.resolveSaveEffectScale('half', true, defense), 0);
    assert.equal(engine.resolveSaveEffectScale('half', false, defense), 0.5);

    // Спасбросок другой характеристики и «успех — без урона» не меняются
    assert.equal(
      engine.resolveSaveEffectScale('half', true, {
        ...defense,
        ability: 'wisdom',
      }),
      0.5,
    );

    assert.equal(engine.resolveSaveEffectScale('none', false, defense), 1);

    // Недееспособный Увёртливостью не пользуется
    assert.equal(
      engine.resolveSaveEffectScale('half', true, {
        ...defense,
        flags: new Set([...activeFlags, 'incapacitated']),
      }),
      0.5,
    );

    // Тот же исход у эффекта со своим спасбросоком «половина урона»
    const fireball = createEffect('Взрыв', {
      effectTarget: 'target',
      applySave: { ability: 'dexterity', dc: 15, onSuccess: 'half' },
      damageParts: [{ formula: '8d6@dmg.fire' }],
    });

    assert.equal(
      engine.resolveEffectApplication(fireball, {
        landed: true,
        applySaveSucceeded: true,
        targetFlags: activeFlags,
      }).damageMultiplier,
      0,
    );
  });

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

  it('[F12b] Боевой заклинатель: преимущество только на спасброски концентрации', () => {
    const warCaster = createEffect('Боевой заклинатель', {
      flags: ['save.advantage.vsConcentration'],
    });

    authoredScenario(warCaster, 'feature');

    const { activeFlags } = engine.resolveActorStats(
      hero({ overrides: { activeEffects: [warCaster] } }),
    );

    const rollMode = (circumstances) =>
      engine.resolveSavingThrowRollMode({
        flags: activeFlags,
        ability: 'constitution',
        ...circumstances,
      });

    assert.equal(rollMode({ againstConcentration: true }), 'advantage');
    assert.equal(rollMode({}), 'normal');
  });

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
      setHitPoints(orc, hitPoints, 20);
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

describe('каталог: урон и чувства умений', () => {
  it('[F14] Сила могилы: некротический урон игнорирует сопротивление', () => {
    const gravePower = createEffect('Сила могилы', {
      flags: ['damage.ignoreResistance.necrotic'],
    });

    authoredScenario(gravePower, 'feature');

    const necromancer = hero({ overrides: { activeEffects: [gravePower] } });

    const ignoredResistances = engine.listIgnoredResistances(
      engine.resolveActorStats(necromancer).activeFlags,
    );

    assert.deepEqual(ignoredResistances, ['necrotic']);

    const strike = (details) => {
      const target = setHitPoints(
        createActor({
          id: 'actor_wight',
          activeEffects: [
            createEffect('Сопротивление', {
              flags: ['resistance.necrotic', 'resistance.fire'],
            }),
          ],
        }),
        30,
      );

      engine.applyTargetDamage(target, 10, false, 'necrotic', details);

      return engine.resolveEntityCurrentHp(target);
    };

    assert.equal(strike({ critical: false, ignoredResistances }), 20);
    assert.equal(strike({ critical: false }), 25);
  });

  it('[F15] Совиный аспект: тёмное зрение +60 футов или 60, если его не было', () => {
    const owl = createEffect('Сова', {
      changes: [change('sense.darkvision', '60')],
    });

    authoredScenario(owl, 'feature');

    const darkvisionOf = (vision) =>
      engine.resolveActorStats(
        hero({ overrides: { activeEffects: [owl], token: { vision } } }),
      ).senses.darkvision;

    assert.equal(
      darkvisionOf({ enabled: true, range: 0, darkvision: 60, angle: 360 }),
      120,
    );

    assert.equal(darkvisionOf(undefined), 60);
  });
});
