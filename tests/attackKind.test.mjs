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

  it('спасбросок без вида атаки: дистанция — жёсткий предел без помехи', () => {
    /** «Ужасный облик» банши: спасбросок Мудрости, 60 фт., вида атаки нет */
    const horrifyingVisage = {
      name: 'Ужасный облик',
      description: [],
      saveType: 'wisdom',
      saveDC: 13,
      range: { normal: 60 },
      distanceUnit: 'ft',
    };

    for (const distance of [15, 60]) {
      assert.deepEqual(
        engine.checkCreatureActionRange(horrifyingVisage, distance),
        { allowed: true, disadvantage: false },
      );
    }

    assert.deepEqual(engine.checkCreatureActionRange(horrifyingVisage, 65), {
      allowed: false,
      disadvantage: false,
    });

    // Есть long — предел по нему, и всё равно без помехи
    const withLong = { ...horrifyingVisage, range: { normal: 30, long: 120 } };

    assert.deepEqual(engine.checkCreatureActionRange(withLong, 90), {
      allowed: true,
      disadvantage: false,
    });

    assert.equal(engine.checkCreatureActionRange(withLong, 125).allowed, false);
  });

  it('без дистанции и вида — досягаемость 5 фт.; melee — своя досягаемость', () => {
    const noRange = { name: 'Укус', description: [], attackBonus: 3 };

    assert.equal(engine.checkCreatureActionRange(noRange, 5).allowed, true);
    assert.equal(engine.checkCreatureActionRange(noRange, 10).allowed, false);

    const longReach = { ...noRange, rangeType: 'melee', reach: 10 };

    assert.deepEqual(engine.checkCreatureActionRange(longReach, 10), {
      allowed: true,
      disadvantage: false,
    });

    assert.equal(engine.checkCreatureActionRange(longReach, 15).allowed, false);

    // melee с дистанцией в записи — по-прежнему досягаемость, не дистанция
    assert.equal(
      engine.checkCreatureActionRange(
        { ...longReach, range: { normal: 60 } },
        15,
      ).allowed,
      false,
    );
  });

  it('дальнобойная атака: помеха между обычной и длинной дистанцией', () => {
    const bow = {
      name: 'Длинный лук',
      description: [],
      attackBonus: 5,
      rangeType: 'ranged',
      range: { normal: 150, long: 600 },
    };

    assert.deepEqual(engine.checkCreatureActionRange(bow, 150), {
      allowed: true,
      disadvantage: false,
    });

    assert.deepEqual(engine.checkCreatureActionRange(bow, 300), {
      allowed: true,
      disadvantage: true,
    });

    assert.equal(engine.checkCreatureActionRange(bow, 605).allowed, false);
  });

  it('сцена в метрах: пределы в футах пересчитываются в метры', () => {
    // Клетка 1,5 м: соседняя фишка — 1,5 м, округлённые до 2 (как у
    // `measureTokenDistanceOnScene`); через клетку — 3 м
    const bite = {
      name: 'Укус',
      description: [],
      attackBonus: 3,
      rangeType: 'melee',
      distanceUnit: 'ft',
    };

    assert.deepEqual(engine.checkCreatureActionRange(bite, 2, 'm'), {
      allowed: true,
      disadvantage: false,
    });

    assert.equal(engine.checkCreatureActionRange(bite, 3, 'm').allowed, false);

    // Без distanceUnit — футы по умолчанию
    const { distanceUnit: _unit, ...biteNoUnit } = bite;

    assert.equal(
      engine.checkCreatureActionRange(biteNoUnit, 2, 'm').allowed,
      true,
    );

    assert.equal(
      engine.checkCreatureActionRange(biteNoUnit, 3, 'm').allowed,
      false,
    );

    // Длинный лук 150/600 фт ≈ 46/183 м
    const bow = {
      name: 'Длинный лук',
      description: [],
      attackBonus: 5,
      rangeType: 'ranged',
      range: { normal: 150, long: 600 },
      distanceUnit: 'ft',
    };

    assert.deepEqual(engine.checkCreatureActionRange(bow, 45, 'm'), {
      allowed: true,
      disadvantage: false,
    });

    assert.deepEqual(engine.checkCreatureActionRange(bow, 47, 'm'), {
      allowed: true,
      disadvantage: true,
    });

    // 150 м — раньше сравнивалось с «150 фт» напрямую и давало помеху
    // на 151 м; теперь это ещё длинная дистанция
    assert.deepEqual(engine.checkCreatureActionRange(bow, 183, 'm'), {
      allowed: true,
      disadvantage: true,
    });

    assert.equal(engine.checkCreatureActionRange(bow, 184, 'm').allowed, false);

    // «Ужасный облик» банши без вида атаки: 60 фт ≈ 18 м
    const horrifyingVisage = {
      name: 'Ужасный облик',
      description: [],
      saveType: 'wisdom',
      saveDC: 13,
      range: { normal: 60 },
      distanceUnit: 'ft',
    };

    assert.deepEqual(
      engine.checkCreatureActionRange(horrifyingVisage, 18, 'm'),
      { allowed: true, disadvantage: false },
    );

    assert.equal(
      engine.checkCreatureActionRange(horrifyingVisage, 20, 'm').allowed,
      false,
    );

    // «Рукопашная или дальнобойная» копья: 5 фт ≈ 2 м, 30/120 фт ≈ 9/37 м
    assert.deepEqual(
      engine.listReachableCreatureActionAttackKinds(JAVELIN_ACTION, 2, 'm'),
      ['melee', 'ranged'],
    );

    assert.deepEqual(
      engine.listReachableCreatureActionAttackKinds(JAVELIN_ACTION, 9, 'm'),
      ['ranged'],
    );

    assert.deepEqual(engine.checkCreatureActionRange(JAVELIN_ACTION, 20, 'm'), {
      allowed: true,
      disadvantage: true,
    });

    assert.equal(
      engine.checkCreatureActionRange(JAVELIN_ACTION, 38, 'm').allowed,
      false,
    );

    // Сцена в футах — числа записи без пересчёта
    assert.equal(engine.checkCreatureActionRange(bow, 600, 'ft').allowed, true);

    assert.equal(
      engine.checkCreatureActionRange(bow, 605, 'ft').allowed,
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

  it('бонус +N оружия с обязательной настройкой ждёт настройки', () => {
    const hero = fighter(16, 10);

    const magicPart = (weapon) => {
      const parts = engine.describeWeaponAttack(hero, weapon, undefined);

      return parts.find((part) => part.key === 'magic')?.value;
    };

    const sword = {
      ...JAVELIN,
      isMagical: true,
      magicBonus: 2,
      magicAttunement: 'required',
    };

    assert.equal(magicPart(sword), undefined, 'без настройки бонуса нет');
    assert.equal(magicPart({ ...sword, isAttuned: true }), 2);

    assert.equal(
      magicPart({ ...sword, magicAttunement: 'none' }),
      2,
      'настройка не нужна — бонус есть',
    );
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
        measureDistanceToTarget: () =>
          distance === undefined ? undefined : { distance, units: 'ft' },
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
      listReachable: (distance, sceneUnit) =>
        engine.listReachableWeaponAttackKinds(weapon, distance, sceneUnit),
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

describe('дальность оружия на сцене в метрах', () => {
  it('досягаемость и дистанция броска пересчитываются из футов', () => {
    const struck = engine.withWeaponAttackKind(JAVELIN, 'melee');
    const thrown = engine.withWeaponAttackKind(JAVELIN, 'ranged');

    // 5 фт ≈ 2 м после округления, 30/120 фт ≈ 9/37 м
    assert.equal(engine.checkRange(struck, 2, 'm').allowed, true);
    assert.equal(engine.checkRange(struck, 3, 'm').allowed, false);

    assert.deepEqual(engine.checkRange(thrown, 9, 'm'), {
      allowed: true,
      disadvantage: false,
    });

    assert.deepEqual(engine.checkRange(thrown, 30, 'm'), {
      allowed: true,
      disadvantage: true,
    });

    assert.equal(engine.checkRange(thrown, 38, 'm').allowed, false);

    assert.deepEqual(engine.listReachableWeaponAttackKinds(JAVELIN, 6, 'm'), [
      'ranged',
    ]);

    // Сцена в футах — как раньше
    assert.equal(engine.checkRange(struck, 5, 'ft').allowed, true);
    assert.equal(engine.checkRange(struck, 10, 'ft').allowed, false);
  });
});
