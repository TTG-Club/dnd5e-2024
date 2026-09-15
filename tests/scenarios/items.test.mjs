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

/**
 * Персонаж с заданными хитами.
 *
 * @param {number} hitPoints - хиты
 * @param {object} overrides - поля персонажа
 * @returns {object} персонаж
 */
function heroWithHp(hitPoints, overrides = {}) {
  return createActor({
    system: {
      ...structuredClone(engine.DEFAULT_ACTOR.system),
      hitPoints: { current: hitPoints, max: hitPoints, temp: 0 },
    },
    ...overrides,
  });
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

    const wearing = heroWithHp(20, { equipment: [wornItem('ring', [ring])] });

    const pocket = heroWithHp(20, {
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

    const hero = heroWithHp(20, {
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

  it.todo(
    '[I11] Предмет с зарядами и включением действием («Сапоги скорости», «Брошь щита») — пробел',
  );
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

  it.todo(
    '[W01b] Бонус урона только этим оружием, а не всеми рукопашными — пробел',
  );

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
