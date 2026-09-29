import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/** Метательное копьё гоблина: +4, досягаемость 5 фт. или дистанция 30/120 фт. */
const JAVELIN_ACTION = {
  name: 'Метательное копьё',
  description: [],
  attackBonus: 4,
  rangeType: 'meleeOrRanged',
  reach: 5,
  range: { normal: 30, long: 120 },
  damageParts: [{ formula: '1к6+2@dmg.piercing' }],
};

/** Метательное копьё персонажа: рукопашное, «Метательное» 30/120 */
const JAVELIN = {
  id: 'javelin',
  name: 'Метательное копьё',
  type: 'weapon',
  rangeType: 'melee',
  weaponProperties: ['thrown'],
  range: { normal: 30, long: 120 },
  damageParts: [{ formula: '1к6', type: 'piercing' }],
};

/** Кинжал: «Фехтовальное», «Лёгкое», «Метательное» 20/60 */
const DAGGER = {
  ...JAVELIN,
  id: 'dagger',
  name: 'Кинжал',
  weaponProperties: ['finesse', 'light', 'thrown'],
  range: { normal: 20, long: 60 },
};

/** Дротик 2024: дальнобойное оружие с «Метательным» — выбора у него нет */
const DART = {
  ...JAVELIN,
  id: 'dart',
  name: 'Дротик',
  rangeType: 'ranged',
  weaponProperties: ['finesse', 'thrown'],
  range: { normal: 20, long: 60 },
};

/**
 * Персонаж с заданными Силой и Ловкостью.
 *
 * @param {number} strength - Сила
 * @param {number} dexterity - Ловкость
 * @returns {object} актёр
 */
function fighter(strength, dexterity) {
  return {
    id: 'hero',
    entityType: 'actor',
    system: {
      abilities: {
        strength,
        dexterity,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      },
    },
  };
}

describe('виды атаки у действия существа', () => {
  it('«рукопашная или дальнобойная» атакует обоими видами', () => {
    assert.deepEqual(engine.listCreatureActionAttackKinds(JAVELIN_ACTION), [
      'melee',
      'ranged',
    ]);
  });

  it('старые записи и записи без поля — одним видом, как раньше', () => {
    const { rangeType: _omitted, ...withoutType } = JAVELIN_ACTION;

    assert.deepEqual(
      engine.listCreatureActionAttackKinds({
        ...JAVELIN_ACTION,
        rangeType: 'melee',
      }),
      ['melee'],
    );

    assert.deepEqual(
      engine.listCreatureActionAttackKinds({
        ...JAVELIN_ACTION,
        rangeType: 'ranged',
      }),
      ['ranged'],
    );

    assert.deepEqual(engine.listCreatureActionAttackKinds(withoutType), [
      'melee',
    ]);
  });

  it('у области вид не спрашивается', () => {
    assert.deepEqual(
      engine.listCreatureActionAttackKinds({
        ...JAVELIN_ACTION,
        areaOfEffect: { shape: 'cone', size: 15, unit: 'ft' },
      }),
      ['melee'],
    );
  });

  it('выбранный вид — копия с конкретной дальностью, запись не меняется', () => {
    const thrown = engine.withCreatureActionAttackKind(
      JAVELIN_ACTION,
      'ranged',
    );

    assert.equal(thrown.rangeType, 'ranged');
    assert.deepEqual(thrown.range, JAVELIN_ACTION.range);
    assert.equal(JAVELIN_ACTION.rangeType, 'meleeOrRanged');
  });

  it('бонусы и флаги берутся по выбранному виду', () => {
    const struck = engine.withCreatureActionAttackKind(JAVELIN_ACTION, 'melee');

    const thrown = engine.withCreatureActionAttackKind(
      JAVELIN_ACTION,
      'ranged',
    );

    assert.equal(engine.getAttackBonusKey(struck.rangeType), 'attack.melee');
    assert.equal(engine.getAttackBonusKey(thrown.rangeType), 'attack.ranged');
    assert.equal(engine.getDamageBonusKey(thrown.rangeType), 'damage.ranged');
    assert.equal(engine.getAttackFlagCategory(thrown.rangeType), 'ranged');

    // Без выбора — рукопашная, как эти записи работали до выбора
    assert.equal(
      engine.getAttackBonusKey(JAVELIN_ACTION.rangeType),
      'attack.melee',
    );
  });

  it('расстояние: досягаемость, дистанция и помеха за обычной дистанцией', () => {
    const struck = engine.withCreatureActionAttackKind(JAVELIN_ACTION, 'melee');

    const thrown = engine.withCreatureActionAttackKind(
      JAVELIN_ACTION,
      'ranged',
    );

    assert.deepEqual(engine.checkCreatureActionRange(struck, 5), {
      allowed: true,
      disadvantage: false,
    });

    assert.equal(engine.checkCreatureActionRange(struck, 10).allowed, false);

    assert.deepEqual(engine.checkCreatureActionRange(thrown, 5), {
      allowed: true,
      disadvantage: false,
    });

    assert.deepEqual(engine.checkCreatureActionRange(thrown, 60), {
      allowed: true,
      disadvantage: true,
    });

    assert.equal(engine.checkCreatureActionRange(thrown, 125).allowed, false);
  });

  it('без выбора проверка берёт досягаемость, а дальше — дистанцию', () => {
    assert.deepEqual(engine.checkCreatureActionRange(JAVELIN_ACTION, 5), {
      allowed: true,
      disadvantage: false,
    });

    assert.deepEqual(engine.checkCreatureActionRange(JAVELIN_ACTION, 60), {
      allowed: true,
      disadvantage: true,
    });

    assert.equal(
      engine.checkCreatureActionRange(JAVELIN_ACTION, 125).allowed,
      false,
    );
  });

  it('по расстоянию остаются виды, которыми цель достаётся', () => {
    assert.deepEqual(
      engine.listReachableCreatureActionAttackKinds(JAVELIN_ACTION, 5),
      ['melee', 'ranged'],
    );

    assert.deepEqual(
      engine.listReachableCreatureActionAttackKinds(JAVELIN_ACTION, 25),
      ['ranged'],
    );

    assert.deepEqual(
      engine.listReachableCreatureActionAttackKinds(JAVELIN_ACTION, 125),
      [],
    );
  });
});

describe('метательное оружие', () => {
  it('рукопашное метательное — удар и бросок, остальное — своим видом', () => {
    assert.deepEqual(engine.listWeaponAttackKinds(JAVELIN), [
      'melee',
      'ranged',
    ]);

    assert.deepEqual(engine.listWeaponAttackKinds(DART), ['ranged']);

    assert.deepEqual(
      engine.listWeaponAttackKinds({ ...JAVELIN, weaponProperties: [] }),
      ['melee'],
    );

    assert.equal(
      engine.isThrowableMeleeWeapon({ ...JAVELIN, range: undefined }),
      false,
      'без дистанции броска бросать некуда',
    );
  });

  it('брошенное оружие — дальнобойная атака Силой', () => {
    const hero = fighter(16, 18);
    const thrown = engine.withWeaponAttackKind(JAVELIN, 'ranged');

    assert.equal(thrown.rangeType, 'ranged');
    assert.equal(engine.resolveWeaponAttackAbility(hero, thrown), 'strength');

    // Обычное дальнобойное без своей характеристики — Ловкостью
    assert.equal(
      engine.resolveWeaponAttackAbility(hero, {
        ...JAVELIN,
        rangeType: 'ranged',
        weaponProperties: [],
      }),
      'dexterity',
    );

    // Своя характеристика оружия сохраняется и у броска
    assert.equal(
      engine.resolveWeaponAttackAbility(
        hero,
        engine.withWeaponAttackKind(
          { ...JAVELIN, attackAbility: 'wisdom' },
          'ranged',
        ),
      ),
      'wisdom',
    );
  });

  it('«Фехтовальное» бросают лучшей из Силы и Ловкости', () => {
    const thrown = engine.withWeaponAttackKind(DAGGER, 'ranged');

    assert.equal(
      engine.resolveWeaponAttackAbility(fighter(16, 18), thrown),
      'dexterity',
    );

    assert.equal(
      engine.resolveWeaponAttackAbility(fighter(18, 12), thrown),
      'strength',
    );
  });

  it('прибавка attack.ranged идёт только броску', () => {
    const hero = fighter(16, 10);

    const stats = {
      abilities: hero.system.abilities,
      attackBonuses: { melee: 1, ranged: 3 },
      damageBonuses: { melee: 0, ranged: 0 },
      abilityDamageBonuses: { melee: {}, ranged: {} },
    };

    const effectsPart = (weapon) => {
      const parts = engine.describeWeaponAttack(hero, weapon, stats);

      return parts.find((part) => part.key === 'effects')?.value;
    };

    assert.equal(effectsPart(engine.withWeaponAttackKind(JAVELIN, 'melee')), 1);

    assert.equal(
      effectsPart(engine.withWeaponAttackKind(JAVELIN, 'ranged')),
      3,
    );

    assert.equal(effectsPart(JAVELIN), 1, 'без выбора — удар');
  });

  it('удар меряет досягаемость, бросок — дистанцию с помехой за обычной', () => {
    assert.equal(
      engine.checkRange(engine.withWeaponAttackKind(JAVELIN, 'melee'), 10)
        .allowed,
      false,
    );

    assert.deepEqual(
      engine.checkRange(engine.withWeaponAttackKind(JAVELIN, 'ranged'), 40),
      { allowed: true, disadvantage: true },
    );

    assert.deepEqual(engine.listReachableWeaponAttackKinds(JAVELIN, 5), [
      'melee',
      'ranged',
    ]);

    assert.deepEqual(engine.listReachableWeaponAttackKinds(JAVELIN, 25), [
      'ranged',
    ]);
  });
});

describe('импорт из компендиума', () => {
  /**
   * Существо компендиума с записями всех блоков.
   *
   * @param {unknown} rangeType - тип дальности записей
   * @returns {object} существо
   */
  function compendiumCreature(rangeType) {
    const action = { ...JAVELIN_ACTION, rangeType };

    return {
      id: 'goblin',
      name: 'Гоблин',
      system: {
        size: 'small',
        abilities: {
          strength: 8,
          dexterity: 14,
          constitution: 10,
          intelligence: 10,
          wisdom: 8,
          charisma: 8,
        },
        traits: [],
        actions: [action],
        bonusActions: [{ ...action }],
        reactions: [],
        legendary: { count: 1, actions: [{ ...action }] },
        lair: { name: 'Логово', description: null, effects: [{ ...action }] },
      },
    };
  }

  /**
   * Типы дальности всех записей после нормализации.
   *
   * @param {object} creature - существо
   * @returns {unknown[]} типы
   */
  function rangeTypesOf(creature) {
    const { system } = creature;

    return [
      ...system.actions,
      ...system.bonusActions,
      ...system.legendary.actions,
      ...system.lair.effects,
    ].map((action) => action.rangeType);
  }

  for (const value of ['meleeOrRanged', 'MELEE_OR_RANGE', 'melee_or_ranged']) {
    it(`«${value}» становится meleeOrRanged`, () => {
      const creature = compendiumCreature(value);

      engine.normalizeCreature(creature);

      assert.deepEqual(
        rangeTypesOf(creature),
        Array.from({ length: 4 }).fill('meleeOrRanged'),
      );
    });
  }

  it('старые melee и ranged остаются как были', () => {
    const melee = compendiumCreature('melee');
    const ranged = compendiumCreature('RANGE');

    engine.normalizeCreature(melee);
    engine.normalizeCreature(ranged);

    assert.deepEqual(
      rangeTypesOf(melee),
      Array.from({ length: 4 }).fill('melee'),
    );

    assert.deepEqual(
      rangeTypesOf(ranged),
      Array.from({ length: 4 }).fill('ranged'),
    );
  });

  it('незнакомое значение и запись без поля не трогаются', () => {
    const creature = compendiumCreature('sideways');

    creature.system.reactions = [{ name: 'Парирование', description: [] }];

    engine.normalizeCreature(creature);

    assert.deepEqual(
      rangeTypesOf(creature),
      Array.from({ length: 4 }).fill('sideways'),
    );

    assert.equal('rangeType' in creature.system.reactions[0], false);
  });

  it('старая выгрузка (melee с дальностью) остаётся рукопашной', () => {
    const creature = compendiumCreature('melee');

    engine.normalizeCreature(creature);

    assert.deepEqual(
      engine.listCreatureActionAttackKinds(creature.system.actions[0]),
      ['melee'],
    );
  });
});

describe('вопрос о виде атаки перед броском', () => {
  /** Подписи вопроса как у оружия */
  const PROMPT = { melee: 'Удар', ranged: 'Бросок' };
  const CHAT = { melee: 'удар', ranged: 'бросок' };

  /**
   * Настоящий хелпер вопроса с портами: плашка, чат и расстояние до цели.
   *
   * @param {number | undefined} distance - расстояние до цели (нет — цели нет)
   * @returns {Promise<object>} хелпер и записи
   */
  async function loadChoice(distance) {
    const modals = [];
    const messages = [];

    const run = await loadHandler(
      'src/client/composables/attackKindChoice.ts',
      'runWithAttackKind',
      {
        useModalManager: () => ({
          openModal: (name, props) => modals.push({ name, props }),
        }),
        useChatStore: () => ({
          sendMessage: (text) => messages.push(text),
        }),
        measureDistanceToTarget: () => distance,
        generateId: (prefix) => `${prefix}_test`,
        ATTACK_KIND_MODAL_KEY_PREFIX: 'attack-kind',
        ATTACK_KIND_PROMPT_LABELS: {
          group: 'Вид атаки',
          chatSeparator: ': ',
          byDistanceSuffix: ' — по расстоянию',
        },
        EFFECT_VARIANT_PROMPT_MODAL: 'EffectVariantPromptModal',
      },
    );

    return { run, modals, messages };
  }

  /**
   * Настройка вопроса для метательного копья.
   *
   * @param {object} weapon - оружие
   * @returns {object} виды, отбор по расстоянию и применение вида
   */
  function weaponSetup(weapon) {
    return {
      kinds: engine.listWeaponAttackKinds(weapon),
      listReachable: (distance) =>
        engine.listReachableWeaponAttackKinds(weapon, distance),
      apply: (kind) => engine.withWeaponAttackKind(weapon, kind),
      promptLabels: PROMPT,
      chatLabels: CHAT,
    };
  }

  it('без цели спрашивает «Удар / Бросок» и бросает выбранным видом', async () => {
    const { run, modals, messages } = await loadChoice(undefined);
    const chosen = [];

    run(JAVELIN, weaponSetup(JAVELIN), 'hero', (weapon) => chosen.push(weapon));

    assert.equal(modals.length, 1);
    assert.equal(modals[0].name, 'EffectVariantPromptModal');

    // Объекты собраны в VM — сравниваются по содержимому, без прототипов
    assert.deepEqual(JSON.parse(JSON.stringify(modals[0].props.groups)), [
      { group: 'Вид атаки', pick: 'choose', labels: ['Удар', 'Бросок'] },
    ]);

    assert.equal(chosen.length, 0, 'до ответа броска нет');

    modals[0].props.onConfirm({ 'Вид атаки': 'Бросок' });

    assert.equal(chosen[0].rangeType, 'ranged');
    assert.deepEqual(messages, ['Метательное копьё: бросок']);
  });

  it('цель за досягаемостью — сразу бросок, без вопроса', async () => {
    const { run, modals, messages } = await loadChoice(25);
    const chosen = [];

    run(JAVELIN, weaponSetup(JAVELIN), 'hero', (weapon) => chosen.push(weapon));

    assert.equal(modals.length, 0);
    assert.equal(chosen[0].rangeType, 'ranged');
    assert.deepEqual(messages, ['Метательное копьё: бросок — по расстоянию']);
  });

  it('цель вне обеих дальностей — дальнобойной, проверка скажет сама', async () => {
    const { run, modals, messages } = await loadChoice(500);
    const chosen = [];

    run(JAVELIN, weaponSetup(JAVELIN), 'hero', (weapon) => chosen.push(weapon));

    assert.equal(modals.length, 0);
    assert.equal(chosen[0].rangeType, 'ranged');
    assert.deepEqual(messages, []);
  });

  it('оружие одного вида идёт без вопроса и без строки чата', async () => {
    const { run, modals, messages } = await loadChoice(5);
    const chosen = [];

    run(DART, weaponSetup(DART), 'hero', (weapon) => chosen.push(weapon));

    assert.equal(modals.length, 0);
    assert.equal(chosen[0], DART);
    assert.deepEqual(messages, []);
  });
});
