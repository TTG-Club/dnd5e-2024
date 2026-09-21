import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  change,
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  MAX_ROLL,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: магические предметы и оружие
 * (`docs/EFFECT_SCENARIOS.md`, разделы «Предметы» и «Оружие»).
 */

/** Контекст броска без преимущества и помехи */
const PLAIN_ROLL = { hasAdvantage: false, hasDisadvantage: false };

/** Все характеристики — для «+1 ко всем спасброскам» */
const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/**
 * Надетый предмет с эффектами.
 *
 * @param {string} id - идентификатор
 * @param {object[]} effects - эффекты предмета
 * @param {object} overrides - настройка, категория
 * @returns {object} предмет
 */
function wornItem(id, effects, overrides = {}) {
  return {
    id,
    name: id,
    type: 'equipment',
    equipped: true,
    activeEffects: effects,
    ...overrides,
  };
}

/**
 * Статы персонажа с предметами.
 *
 * @param {object[]} equipment - предметы
 * @returns {object} статы
 */
function statsWithItems(equipment) {
  return engine.resolveActorStats(createActor({ equipment }));
}

describe('каталог: предметы', () => {
  it('[I01] Плащ защиты: +1 КД и спасброски, только с настройкой', () => {
    const cloak = createEffect('Плащ защиты', {
      changes: [
        change('armorClass', '1'),
        ...ABILITIES.map((ability) => change(`save.${ability}`, '1')),
      ],
    });

    authoredScenario(cloak, 'item');

    const attuned = statsWithItems([
      wornItem('cloak', [cloak], {
        magicAttunement: 'required',
        isAttuned: true,
      }),
    ]);

    const notAttuned = statsWithItems([
      wornItem('cloak', [cloak], {
        magicAttunement: 'required',
        isAttuned: false,
      }),
    ]);

    assert.equal(attuned.armorClass, 11);
    assert.equal(attuned.saves.wisdom, 1);
    assert.equal(notAttuned.armorClass, 10);
  });

  it('[I02] Кольцо сопротивления огню: снятое кольцо не защищает', () => {
    const ring = createEffect('Кольцо сопротивления', {
      flags: ['resistance.fire'],
    });

    authoredScenario(ring, 'item');

    const wearing = withHp(createActor, 20, {
      equipment: [wornItem('ring', [ring])],
    });

    const pocket = withHp(createActor, 20, {
      equipment: [wornItem('ring', [ring], { equipped: false })],
    });

    assert.equal(
      engine.applyTargetDamage(wearing, 10, false, 'fire').hpAfter,
      15,
    );

    assert.equal(
      engine.applyTargetDamage(pocket, 10, false, 'fire').hpAfter,
      10,
    );
  });

  it('[I03] Адамантиновый доспех: критическое попадание становится обычным', () => {
    const adamantine = createEffect('Адамантин', {
      flags: ['defense.critImmunity'],
    });

    authoredScenario(adamantine, 'item');

    const flags = statsWithItems([
      wornItem('plate', [adamantine], {
        equipmentCategory: 'heavy',
        baseArmorAC: 18,
      }),
    ]).activeFlags;

    const result = engine.resolveAttackRoll({
      total: 25,
      attackModifier: 5,
      naturalRoll: 20,
      targetAc: 18,
      targetFlags: flags,
    });

    assert.equal(result.isHit, true);
    assert.equal(result.isCriticalHit, false);
  });

  it('[I04] Талисман от яда: иммунитет к урону ядом и к «Отравленному»', () => {
    const periapt = createEffect('Талисман от яда', {
      flags: ['immunity.poison'],
      conditionImmunities: ['poisoned'],
    });

    authoredScenario(periapt, 'item');

    const hero = withHp(createActor, 20, {
      equipment: [wornItem('periapt', [periapt])],
    });

    assert.equal(
      engine.applyTargetDamage(hero, 10, false, 'poison').hpAfter,
      20,
    );

    assert.deepEqual(
      engine.applyEffectsToEntity(
        hero,
        [engine.buildConditionActiveEffect('poisoned')],
        'weapon',
      ),
      [],
    );
  });

  it('[I05] Сапоги эльфов: преимущество на Скрытность', () => {
    const boots = createEffect('Сапоги эльфов', {
      flags: ['skill.stealth.advantage'],
    });

    authoredScenario(boots, 'item');

    assert.equal(
      engine.resolveAbilityCheckRollMode({
        flags: statsWithItems([wornItem('boots', [boots])]).activeFlags,
        ability: 'dexterity',
        skill: 'stealth',
      }),
      'advantage',
    );
  });

  it('[I06] Сапоги скорости [≈]: скорость вдвое (включение действием — пробел)', () => {
    const boots = createEffect('Сапоги скорости', {
      changes: [change('movement.walk', '2', { mode: 'multiply' })],
    });

    authoredScenario(boots, 'item');

    assert.equal(
      statsWithItems([wornItem('boots', [boots])]).movement.walk,
      60,
    );
  });

  it('[I07] Оружие предупреждения: преимущество на инициативу', () => {
    const warning = createEffect('Предупреждение', {
      flags: ['initiative.advantage'],
    });

    authoredScenario(warning, 'item');

    assert.equal(
      engine.resolveInitiativeRollMode(
        statsWithItems([wornItem('sword', [warning])]).activeFlags,
      ),
      'advantage',
    );
  });

  it('[I08] Эффект предмета «на цели» не действует на владельца', () => {
    const frost = createEffect('Ледяной укус', {
      effectTarget: 'target',
      changes: [change('movement.walk', '-10')],
      duration: { type: 'rounds', value: 1 },
    });

    authoredScenario(frost, 'weapon');

    assert.equal(
      statsWithItems([wornItem('frost', [frost], { type: 'weapon' })]).movement
        .walk,
      30,
    );
  });

  it('[I09] Знамя (аура предмета): +1 к спасброскам союзникам в 10 фт, не себе', () => {
    const banner = createEffect('Знамя', {
      aura: { radius: 10, target: 'allies', applyToSelf: false, visible: true },
      changes: ABILITIES.map((ability) => change(`save.${ability}`, '1')),
    });

    authoredScenario(banner, 'item');

    const bearer = createActor({
      id: 'actor_bearer',
      equipment: [wornItem('banner', [banner])],
    });

    const ally = createActor({ id: 'actor_ally' });
    const enemy = createCreature({ id: 'creature_enemy' });

    const source = {
      token: createToken(bearer.id, 0, 0, { disposition: 'friendly' }),
      effects: engine.collectAllAuraEffects(bearer),
    };

    const allyAmbient = engine.calculateAmbientAuras(
      createToken(ally.id, 1, 0, { disposition: 'friendly' }),
      [source],
      GRID,
    );

    const enemyAmbient = engine.calculateAmbientAuras(
      createToken(enemy.id, 1, 1, { disposition: 'hostile' }),
      [source],
      GRID,
    );

    assert.equal(
      engine.resolveActorStats(ally, allyAmbient).saves.dexterity,
      1,
    );

    assert.equal(enemyAmbient.length, 0);
    assert.equal(engine.resolveActorStats(bearer).saves.dexterity, 0);
  });

  it('[I10] Зелье силы великана: Сила 21 на час, если своя ниже', () => {
    const potion = createEffect('Сила великана', {
      changes: [change('ability.strength', '21', { mode: 'upgrade' })],
      duration: { type: 'hours', value: 1 },
    });

    authoredScenario(potion, 'ownEffects');

    const hero = createActor();

    hero.activeEffects = engine.applyEffectsToEntity(hero, [potion], 'manual');

    const stats = engine.resolveActorStats(hero);

    assert.equal(stats.abilities.strength, 21);
    assert.equal(stats.abilityMods.strength, 5);
    assert.equal(hero.activeEffects[0].duration.remaining, 600);
  });

  it('[I11] Жезл с зарядами: эффект только при применении, заряд тратится', () => {
    const shield = createEffect('Щит жезла', {
      activation: { mode: 'use' },
      changes: [change('armorClass', '5')],
      duration: { type: 'rounds', value: 1 },
    });

    assert.match(
      authoredScenario(shield, 'item'),
      /^После применения — на применившем/,
    );

    const wand = wornItem('wand', [shield], {
      uses: { max: 3, current: 1, recovery: 'dawn' },
    });

    const worn = statsWithItems([wand]);
    const bare = statsWithItems([]);

    assert.equal(
      worn.armorClass,
      bare.armorClass,
      'пока жезл не применили, щита нет',
    );

    assert.equal(engine.canUseItem(wand), true);

    const [spent] = engine.spendItemUse([wand], 'wand');

    assert.equal(spent.uses.current, 0);
    assert.equal(engine.canUseItem(spent), false, 'заряды кончились');

    const spell = engine.buildItemUseSpell(wand);

    assert.equal(spell.rollSource, 'item');
    assert.equal(engine.isSpellRoll(spell), false);
    assert.equal(engine.isMagicRoll(spell), true, 'магический предмет — магия');

    // Удар оружием и действие существа — не магия: «Магическое сопротивление»
    // от них не спасает
    for (const rollSource of ['weapon', 'creatureAction']) {
      assert.equal(
        engine.isMagicRoll(
          engine.buildPseudoSpell({
            id: rollSource,
            name: rollSource,
            rollSource,
          }),
        ),
        false,
        rollSource,
      );
    }

    const [applied] = engine.getCasterSpellEffects(spell);

    assert.equal(applied.activation, undefined, 'копия действует сама');

    const hero = createActor({ activeEffects: [applied] });

    assert.equal(
      engine.resolveActorStats(hero).armorClass,
      bare.armorClass + 5,
    );
  });

  it('[I16] Зелье лечения: расходуемое, лечит при наложении, на нуле остаётся закончившимся', () => {
    const healing = createEffect('Зелье лечения', {
      activation: { mode: 'use' },
      triggers: [
        {
          id: 'trigger_heal',
          event: 'applied',
          actions: [
            { type: 'damage', parts: [{ formula: '7@heal' }] },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    authoredScenario(healing, 'item');

    const potion = wornItem('potion', [healing], {
      equipped: false,
      consumable: true,
      quantity: 2,
    });

    assert.equal(engine.canUseItem(potion), true);

    const [[left], [last]] = [
      engine.spendItemUse([potion], 'potion'),
      engine.spendItemUse([{ ...potion, quantity: 1 }], 'potion'),
    ];

    assert.equal(left.quantity, 1);
    assert.equal(last.quantity, 0, 'последнее зелье остаётся строкой');
    assert.equal(engine.isItemDepleted(last), true);
    assert.equal(engine.canUseItem(last), false);

    assert.deepEqual(
      engine.spendItemUse([last], 'potion'),
      [last],
      'ниже нуля не тратится',
    );

    assert.deepEqual(engine.describeItemUseAvailability(left), {
      remaining: 1,
    });

    assert.deepEqual(engine.describeItemUseAvailability(last), {
      blocked: 'depleted',
      remaining: 0,
    });

    assert.deepEqual(engine.describeItemUseAvailability(undefined), {
      blocked: 'missing',
    });

    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 3, {}, 20);
    const drinking = structuredClone(hero);

    drinking.activeEffects = engine.getCasterSpellEffects(
      engine.buildItemUseSpell(potion),
    );

    system.settleCombatState(hero, engine.pickCombatState(drinking));

    assert.equal(engine.resolveEntityCurrentHp(hero), 10);
    assert.deepEqual(hero.activeEffects, [], 'зелье не висит на персонаже');
  });

  it('[I16] зелье с костями: одна карточка броска с восстановленным', () => {
    const healing = createEffect('Зелье лечения', {
      activation: { mode: 'use' },
      triggers: [
        {
          id: 'trigger_heal',
          event: 'applied',
          actions: [
            { type: 'damage', parts: [{ formula: '2d4@heal+2' }] },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    const potion = wornItem('potion', [healing], {
      equipped: false,
      consumable: true,
      quantity: 1,
    });

    const system = new engine.Dnd5eVttSystem();

    const drink = (hitPoints) => {
      const hero = withHp(createActor, hitPoints, {}, 20);
      const drinking = structuredClone(hero);

      drinking.activeEffects = engine.getCasterSpellEffects(
        engine.buildItemUseSpell(potion),
      );

      const result = withRandom([MAX_ROLL, MAX_ROLL], () =>
        system.settleCombatState(hero, engine.pickCombatState(drinking)),
      );

      return { hero, result };
    };

    const wounded = drink(3);

    assert.equal(engine.resolveEntityCurrentHp(wounded.hero), 13);

    assert.equal(
      wounded.result.chatSummary,
      null,
      'итог уже в карточке броска',
    );

    assert.equal(wounded.result.chatRolls.length, 1);

    const [roll] = wounded.result.chatRolls;

    assert.equal(roll.formula, '2к4 + 2');
    assert.equal(roll.total, 10);
    assert.equal(roll.details, '[4, 4] + 2');

    assert.equal(roll.label, `Зелье лечения → ${wounded.hero.name}: +10 HP`);

    assert.deepEqual(
      roll.dice.map((group) => [group.count, group.sides, [...group.values]]),
      [[2, 4, [4, 4]]],
    );

    const almostFull = drink(18);

    assert.equal(engine.resolveEntityCurrentHp(almostFull.hero), 20);

    assert.equal(almostFull.result.chatSummary, null);

    assert.equal(
      almostFull.result.chatRolls[0].label,
      `Зелье лечения → ${almostFull.hero.name}: +2 HP (хиты полные)`,
    );

    // Зелье на персонаже не остаётся — в список наложенного оно не входит
    assert.equal(engine.removesItselfOnApply(healing), true);

    assert.equal(
      engine.removesItselfOnApply(
        createEffect('Сила великана', {
          changes: [change('ability.strength', '21', { mode: 'upgrade' })],
        }),
      ),
      false,
    );
  });

  it('[I16] закончившийся предмет не действует, не надет и не бьёт', () => {
    const cloak = wornItem('cloak', [
      createEffect('Защита', { changes: [change('armorClass', '1')] }),
    ]);

    const hero = createActor({ equipment: [{ ...cloak, quantity: 0 }] });

    assert.equal(engine.itemEffectsActive({ ...cloak, quantity: 0 }), false);

    assert.equal(
      engine.itemEffectsActive(cloak),
      true,
      'без количества — есть',
    );

    assert.equal(engine.isItemWorn({ equipped: true, quantity: 0 }), false);
    assert.equal(engine.isItemWorn({ equipped: true, quantity: 2 }), true);
    assert.deepEqual([...engine.listEquippedItemEffects(hero)], []);

    const dagger = {
      id: 'dagger',
      name: 'Кинжал',
      type: 'weapon',
      quantity: 0,
      activeEffects: [],
    };

    assert.deepEqual(
      engine.describeWeaponAttackAvailability([dagger], dagger),
      { blocked: 'depleted', remaining: 0 },
    );

    assert.deepEqual(
      engine.describeWeaponAttackAvailability([], { ...dagger, quantity: 1 }),
      {},
      'оружие без боеприпасов остатка не показывает',
    );

    assert.deepEqual(engine.describeWeaponAttackAvailability([], undefined), {
      blocked: 'missing',
    });

    assert.equal(engine.normalizeItemQuantity(0), 0);
    assert.equal(engine.normalizeItemQuantity(-3), 0);
    assert.equal(engine.normalizeItemQuantity(2.7), 2);
    assert.equal(engine.normalizeItemQuantity(Number.NaN), undefined);
  });

  it('[I17] Стрела +1: бонус и эффект в выстрел, стрела тратится', () => {
    const longbow = {
      id: 'longbow',
      name: 'Длинный лук',
      type: 'weapon',
      quantity: 1,
      weaponProperties: ['ammunition', 'heavy', 'two-handed'],
      ammunitionType: 'arrows',
      activeEffects: [],
    };

    const slaying = createEffect('Стрела убийства', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      damageParts: [{ formula: '6d10', type: 'piercing' }],
    });

    authoredScenario(slaying, 'item');

    const arrows = {
      id: 'arrows',
      name: 'Стрелы +1',
      type: 'equipment',
      quantity: 2,
      ammunitionType: 'arrows',
      isMagical: true,
      magicBonus: 1,
      activeEffects: [slaying],
    };

    assert.equal(engine.tracksWeaponAmmunition([longbow], longbow), false);

    const quiver = { ...arrows, id: 'quiver', quantity: 3, isMagical: false };

    assert.equal(
      engine.countWeaponAmmunition([longbow, arrows, quiver], longbow),
      5,
    );

    assert.deepEqual(
      engine.describeWeaponAttackAvailability(
        [longbow, arrows, quiver],
        longbow,
      ),
      { remaining: 5 },
    );

    assert.deepEqual(
      engine.describeWeaponAttackAvailability(
        [longbow, { ...arrows, quantity: 0 }],
        longbow,
      ),
      { blocked: 'noAmmunition', remaining: 0 },
    );

    assert.deepEqual(
      engine.describeWeaponAttackAvailability([longbow], longbow),
      {},
      'лист стрел не ведёт — лук стреляет как раньше',
    );

    assert.equal(
      engine.tracksWeaponAmmunition([longbow, arrows], longbow),
      true,
    );

    const found = engine.findWeaponAmmunition([longbow, arrows], longbow);
    const shot = engine.withAmmunition(longbow, found);

    assert.equal(shot.magicBonus, 1);
    assert.equal(shot.isMagical, true);

    assert.deepEqual(
      shot.activeEffects.map((effect) => [effect.name, effect.activation]),
      [['Стрела убийства', undefined]],
    );

    const [, spent] = engine.spendAmmunition([longbow, arrows], 'arrows');

    assert.equal(spent.quantity, 1);

    assert.equal(
      engine.findWeaponAmmunition(
        [longbow, { ...arrows, quantity: 0 }],
        longbow,
      ),
      undefined,
      'стрелы кончились — стрелять нечем',
    );

    assert.equal(
      engine.tracksWeaponAmmunition(
        [longbow, { ...arrows, quantity: 0 }],
        longbow,
      ),
      true,
      'учёт остаётся и с пустым колчаном',
    );

    // Магические стрелы компендиума приходят записью-оружием
    const weaponArrows = {
      ...arrows,
      id: 'weapon-arrows',
      type: 'weapon',
      weaponProperties: [],
    };

    assert.equal(
      engine.findWeaponAmmunition([longbow, weaponArrows], longbow)?.id,
      'weapon-arrows',
      'оружие без свойства «Боеприпасы» — боеприпас',
    );

    const spareBow = { ...longbow, id: 'spare-bow' };

    assert.equal(
      engine.tracksWeaponAmmunition([longbow, spareBow], longbow),
      false,
      'второй лук стрелой не считается',
    );
  });

  it('[I17] оружие заряжают любым расходуемым предметом инвентаря', () => {
    const sling = {
      id: 'sling',
      name: 'Праща',
      type: 'weapon',
      quantity: 1,
      weaponProperties: ['ammunition'],
      activeEffects: [],
    };

    const stones = {
      id: 'stones',
      name: 'Камни',
      type: 'equipment',
      quantity: 3,
      consumable: true,
      activeEffects: [],
    };

    const potion = { ...stones, id: 'potion', name: 'Зелье', quantity: 1 };
    const rope = { ...stones, id: 'rope', name: 'Верёвка', consumable: false };
    const crossbow = { ...sling, id: 'crossbow', consumable: true };
    const equipment = [sling, stones, potion, rope, crossbow];

    assert.deepEqual(
      engine.listLoadableAmmunition(equipment, sling).map((item) => item.id),
      ['stones', 'potion'],
      'расходуемое, кроме самого оружия и того, что стреляет само',
    );

    assert.deepEqual(
      engine.listLoadableAmmunition(equipment, { ...stones, id: 'x' }),
      [],
      'не стрелковое оружие не заряжают',
    );

    // Не заряжено и типа нет — праща стреляет, ничего не тратя
    assert.equal(engine.tracksWeaponAmmunition(equipment, sling), false);
    assert.equal(engine.findLoadedAmmunition(equipment, sling), undefined);

    const loaded = engine.loadWeaponAmmunition(equipment, 'sling', 'stones');
    const loadedSling = loaded[0];

    assert.equal(loadedSling.loadedAmmunitionId, 'stones');
    assert.equal(engine.tracksWeaponAmmunition(loaded, loadedSling), true);
    assert.equal(engine.countWeaponAmmunition(loaded, loadedSling), 3);
    assert.equal(engine.findWeaponAmmunition(loaded, loadedSling).id, 'stones');

    const [, spentStones] = engine.spendAmmunition(loaded, 'stones');

    assert.equal(spentStones.quantity, 2);

    // Кончились — выстрела нет, но заряд остаётся
    const empty = loaded.map((item) =>
      item.id === 'stones' ? { ...item, quantity: 0 } : item,
    );

    assert.equal(engine.findWeaponAmmunition(empty, loadedSling), undefined);
    assert.equal(engine.findLoadedAmmunition(empty, loadedSling).id, 'stones');

    assert.deepEqual(
      engine.describeWeaponAttackAvailability(empty, loadedSling),
      { blocked: 'noAmmunition', remaining: 0 },
    );

    // Заряженный предмет убрали — праща снова свободна
    assert.equal(
      engine.tracksWeaponAmmunition(
        loaded.filter((item) => item.id !== 'stones'),
        loadedSling,
      ),
      false,
    );

    const unloaded = engine.loadWeaponAmmunition(loaded, 'sling', undefined);

    assert.equal('loadedAmmunitionId' in unloaded[0], false);

    // Заряд важнее подбора по типу: стрелы из компендиума не мешают
    const bow = {
      ...sling,
      id: 'bow',
      ammunitionType: 'arrows',
      loadedAmmunitionId: 'potion',
    };

    const arrows = { ...stones, id: 'arrows', ammunitionType: 'arrows' };

    assert.equal(
      engine.findWeaponAmmunition([bow, arrows, potion], bow).id,
      'potion',
    );

    assert.equal(
      engine.findWeaponAmmunition([bow, arrows], bow).id,
      'arrows',
      'заряда нет в инвентаре — подбор по типу',
    );
  });

  it('[I18] Боеприпас убийства: добивающая часть только по нанесённому урону', () => {
    const slaying = createEffect('Убийство', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      landingCondition: 'self.creatureType === "dragon"',
      applySave: { ability: 'constitution', dc: 17, onSuccess: 'half' },
      damageParts: [{ formula: '6d10', type: 'force', requiresDamage: true }],
    });

    authoredScenario(slaying, 'item');

    const target = createCreature();
    const stats = engine.resolveActorStats(target);

    assert.equal(
      engine.rollEffectDamageParts(slaying.damageParts, stats, target, {
        damageDealt: false,
      }).total,
      0,
      'выстрел не нанёс урона — добивания нет',
    );

    assert.ok(
      engine.rollEffectDamageParts(slaying.damageParts, stats, target, {
        damageDealt: true,
      }).total > 0,
      'урон прошёл — добивание катается',
    );
  });

  it('карточка эффекта называет применение и переключатель', () => {
    const applicationOf = (effect) => {
      const application = engine
        .buildActiveEffectDetails(effect)
        .find((section) => section.key === 'application');

      return application?.lines ?? [];
    };

    const turnUndead = createEffect('Изгнание', {
      activation: { mode: 'use', counter: 'channelDivinity' },
      effectTarget: 'target',
      conditionKey: 'frightened',
    });

    assert.deepEqual(applicationOf(turnUndead), [
      'Сам не действует — только при применении',
      'Копия ложится на выбранную цель',
    ]);

    const rage = createEffect('Ярость', { activation: { mode: 'toggle' } });

    assert.deepEqual(applicationOf(rage), ['Включается переключателем']);

    const venom = createEffect('Яд', { effectTarget: 'target' });

    assert.deepEqual(applicationOf(venom), [
      'Накладывается на цель при попадании атакой',
    ]);
  });
});

describe('каталог: оружие', () => {
  it('[W01] Язык пламени [≈]: +2к6 огнём к рукопашным атакам владельца', () => {
    const flameTongue = createEffect('Язык пламени', {
      changes: [change('damage.melee', '2d6@dmg.fire')],
    });

    authoredScenario(flameTongue, 'weapon');

    const effects = engine.collectActiveEffects(
      createActor({
        equipment: [wornItem('flame', [flameTongue], { type: 'weapon' })],
      }),
    );

    assert.deepEqual(
      engine
        .collectBonusDamageFormulas(effects, 'damage.melee', PLAIN_ROLL)
        .map((formula) => formula.formula),
      ['2d6@dmg.fire'],
    );
  });

  it('[W01b] Магическое оружие: бонус достаётся именно этому предмету', () => {
    const enchantment = createEffect('Магическое оружие', {
      changes: [
        change('damage.weapon', '1d4@dmg.force'),
        change('attack.weapon', '1'),
      ],
    });

    authoredScenario(enchantment, 'weapon');

    const hero = createActor({
      equipment: [
        wornItem('blade', [enchantment], { type: 'weapon' }),
        wornItem('club', [], { type: 'weapon' }),
      ],
    });

    const effects = engine.collectActiveEffects(hero);

    const bonusOf = (itemId) =>
      engine
        .collectBonusDamageFormulas(effects, 'damage.melee', {
          ...PLAIN_ROLL,
          ...(itemId === undefined ? {} : { itemId }),
        })
        .map((formula) => formula.formula);

    assert.deepEqual(
      bonusOf('blade'),
      ['1d4@dmg.force'],
      'зачарованный клинок',
    );

    assert.deepEqual(bonusOf('club'), [], 'дубина осталась обычной');

    assert.deepEqual(
      bonusOf(undefined),
      [],
      'бросок не предметом такую строку не считает',
    );

    const attackBonus = (itemId) =>
      engine.evaluateConditionalBonuses(effects, 'attack.melee', {
        ...PLAIN_ROLL,
        ...(itemId === undefined ? {} : { itemId }),
      });

    assert.equal(attackBonus('blade'), 1, 'прибавка к атаке — этому клинку');
    assert.equal(attackBonus('club'), 0);

    assert.equal(
      engine.resolveActorStats(hero).attackBonuses.melee,
      engine.resolveActorStats(createActor()).attackBonuses.melee,
      'на листе такая строка не считается: каким предметом бьют, лист не знает',
    );
  });

  // Пробел: объект должен быть виден на сцене и пережить перезагрузку мира —
  // это хозяйство хоста, а не системы
  it.todo('[W09] Призванный объект как центр области');

  it('[W02] Приём «Опрокидывание»: спасбросок Телосложения Сл оружия или «Лежащий ничком»', () => {
    const topple = engine.applyConditionPresetToEffect(
      createEffect('Опрокидывание', {
        effectTarget: 'target',
        applySave: { ability: 'constitution', dc: 0, onSuccess: 'negate' },
      }),
      engine.buildConditionActiveEffect('prone'),
    );

    authoredScenario(topple, 'weapon');

    assert.equal(engine.resolveEffectFormLayout('weapon', topple).minSaveDc, 0);

    const weaponDc = 8 + 3 + 2;
    const stamped = engine.stampSourceSaveDcs(topple, weaponDc);

    assert.equal(stamped.applySave.dc, weaponDc);
  });

  it('[W03] Приём «Ослабление»: помеха на следующую атаку цели, снимается после неё', () => {
    const sap = createEffect('Ослабление', {
      effectTarget: 'target',
      flags: ['attack.disadvantage'],
      consumeOn: 'carrierAttack',
      duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'start' },
    });

    authoredScenario(sap, 'weapon');

    const enemy = createCreature();

    enemy.activeEffects = engine.applyEffectsToEntity(enemy, [sap], 'weapon');

    assert.equal(enemy.activeEffects[0].consumeOn, 'carrierAttack');

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: engine.resolveActorStats(enemy).activeFlags,
        attackType: 'melee',
      }),
      'disadvantage',
    );
  });

  it('[W04] Приём «Замедление»: −10 фт скорости до начала своего хода', () => {
    const fighterId = 'actor_fighter';

    const slow = engine.stampTurnDuration(
      createEffect('Замедление', {
        effectTarget: 'target',
        changes: [change('movement.walk', '-10')],
        duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'start' },
      }),
      {
        carrierId: 'creature_wolf',
        sourceId: fighterId,
        activeTurnActorId: fighterId,
      },
    );

    authoredScenario({ ...slow, sourceActorId: undefined }, 'weapon');

    const wolf = createCreature({ activeEffects: [slow] });

    assert.equal(
      engine.resolveActorStats(wolf).movement.walk,
      engine.resolveActorStats(createCreature()).movement.walk - 10,
    );

    engine.expireTurnEffects(
      wolf,
      fighterId,
      'start',
      new Set([fighterId, wolf.id]),
    );

    assert.equal(wolf.activeEffects.length, 0);
  });

  it.todo(
    '[W05] Приём «Досада»: преимущество на следующую атаку именно по этой цели — пробел (флаг не знает цель)',
  );

  it('[W06] Отравленный клинок: 1к4 ядом и «Отравленный» при провале Телосложения', () => {
    const poison = engine.applyConditionPresetToEffect(
      createEffect('Яд', {
        effectTarget: 'target',
        applySave: { ability: 'constitution', dc: 10, onSuccess: 'half' },
        damageParts: [{ formula: '1d4', type: 'poison' }],
        duration: { type: 'rounds', value: 10 },
      }),
      engine.buildConditionActiveEffect('poisoned'),
    );

    authoredScenario(poison, 'weapon');

    assert.deepEqual(
      engine.resolveEffectApplication(poison, {
        landed: true,
        applySaveSucceeded: false,
      }),
      {
        applyEffect: true,
        damageMultiplier: 1,
      },
    );

    assert.deepEqual(
      engine.resolveEffectApplication(poison, {
        landed: true,
        applySaveSucceeded: true,
      }),
      {
        applyEffect: false,
        damageMultiplier: 0.5,
      },
    );
  });

  it('[W07] Улучшенный крит: порог 19 у атак оружием', () => {
    const improved = createEffect('Улучшенный крит', {
      changes: [change('critThreshold', '19', { mode: 'downgrade' })],
    });

    authoredScenario(improved, 'feature');

    const stats = engine.resolveActorStats(
      createActor({ activeEffects: [improved] }),
    );

    assert.equal(stats.critThreshold, 19);

    assert.equal(
      engine.resolveAttackRoll({
        total: 24,
        attackModifier: 5,
        naturalRoll: 19,
        targetAc: 30,
        critThreshold: stats.critThreshold,
      }).isCriticalHit,
      true,
    );
  });
});

describe('каталог: проверки и заклинания', () => {
  it('[I12] Камень удачи: +1 ко всем проверкам характеристик и спасброскам', () => {
    const stone = createEffect('Камень удачи', {
      changes: [
        change('abilityCheck', '1'),
        ...[
          'strength',
          'dexterity',
          'constitution',
          'intelligence',
          'wisdom',
          'charisma',
        ].map((ability) => change(`save.${ability}`, '1')),
      ],
    });

    authoredScenario(stone, 'item');

    const bearer = createActor();
    const base = engine.resolveActorStats(bearer);

    const lucky = engine.resolveActorStats({
      ...bearer,
      activeEffects: [stone],
    });

    assert.equal(lucky.abilityCheckBonus, 1);
    assert.equal(lucky.skills.stealth - base.skills.stealth, 1);
    assert.equal(lucky.saves.wisdom - base.saves.wisdom, 1);
  });

  it('[I13] Кольцо отражения заклинаний: преимущество только против заклинаний', () => {
    const ring = createEffect('Кольцо отражения заклинаний', {
      flags: ['save.advantage.vsSpell'],
    });

    authoredScenario(ring, 'item');

    const flags = engine.resolveActorStats(
      createActor({ activeEffects: [ring] }),
    ).activeFlags;

    const rollMode = (circumstances) =>
      engine.resolveSavingThrowRollMode({
        flags,
        ability: 'dexterity',
        ...circumstances,
      });

    assert.equal(
      rollMode({ againstMagic: true, againstSpell: true }),
      'advantage',
    );

    assert.equal(rollMode({ againstMagic: true }), 'normal');

    // Эффект заклинания на сервере — «против заклинания»
    assert.deepEqual(
      engine.resolveEffectMagicCircumstances(
        createEffect('Удержание', { origin: 'spell' }),
      ),
      { againstMagic: true, againstSpell: true },
    );
  });

  it('[I14] Щит заклинаний: помеха атакам заклинаниями по носителю', () => {
    const shield = createEffect('Щит заклинаний', {
      flags: ['attacksAgainst.spell.disadvantage'],
    });

    authoredScenario(shield, 'item');

    const targetFlags = engine.resolveActorStats(
      createActor({ activeEffects: [shield] }),
    ).activeFlags;

    const rollMode = (attackType) =>
      engine.resolveAttackRollMode({
        attackerFlags: new Set(),
        attackType,
        targetFlags,
      });

    assert.equal(rollMode('spell'), 'disadvantage');
    assert.equal(rollMode('ranged'), 'normal');
  });
});

describe('каталог: условие наложения и варианты', () => {
  it('[W08] Приём оружия ложится только у владеющего приёмом', () => {
    const topple = engine.applyConditionPresetToEffect(
      createEffect('Опрокидывание', {
        effectTarget: 'target',
        landingCondition: 'source.weaponMastery === true',
        applySave: { ability: 'constitution', dc: 0, onSuccess: 'negate' },
      }),
      engine.buildConditionActiveEffect('prone'),
    );

    authoredScenario(topple, 'weapon');

    const quarterstaff = { baseType: 'quarterstaff', mastery: 'topple' };
    const fighter = createActor();
    const target = createCreature();

    const landsFor = (attacker) =>
      engine.passesLandingCondition(topple, target, {
        source: attacker,
        weaponMastery: engine.entityHasWeaponMastery(attacker, quarterstaff),
      });

    assert.equal(landsFor(fighter), false, 'без владения приёмом — нет');

    fighter.system.proficiencies.weaponMasteries = ['quarterstaff'];
    assert.equal(landsFor(fighter), true, 'приём вида оружия');

    fighter.system.proficiencies.weaponMasteries = [];
    fighter.system.proficiencies.masteryProperties = ['topple'];
    assert.equal(landsFor(fighter), true, 'сам приём («Тактический мастер»)');

    assert.equal(
      engine.passesLandingCondition(topple, target, { weaponMastery: false }),
      false,
      'существо статблока приёмами не владеет',
    );
  });

  it('[I15] Доспех сопротивления: один тип сопротивления из вариантов', () => {
    const variants = ['fire', 'cold', 'acid'].map((damageType) =>
      createEffect(`Сопротивление: ${damageType}`, {
        flags: [`resistance.${damageType}`],
        variant: { group: 'тип', label: damageType },
      }),
    );

    const [group] = engine.listEffectVariantGroups(variants);

    assert.deepEqual(group, {
      group: 'тип',
      pick: 'choose',
      labels: ['fire', 'cold', 'acid'],
    });

    assert.deepEqual(
      engine
        .pickEffectVariants(variants, { тип: 'cold' })
        .map((effect) => effect.flags[0]),
      ['resistance.cold'],
    );
  });
});
