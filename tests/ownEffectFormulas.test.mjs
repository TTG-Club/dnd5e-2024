import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createTrait,
  engine,
  MAX_ROLL,
  strikeEntity,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Числа владельца в срабатываниях его собственного постоянного эффекта
 * (`ownEffectFormulas.ts`): эффект никто не накладывал, и `@mod.*`, `@prof`,
 * `@classLevel`, `@choice.*` подставляются, когда событие собирает
 * срабатывания носителя. Слагаемое, которое так и не посчиталось, видно в
 * сводке.
 */

/** Кто бьёт носителя */
const MAGE_ID = 'creature_mage';

/** Носитель эффекта */
const HERO_ID = 'actor_hero';

/** Хиты мага до ответного урона */
const MAGE_HP = 60;

/**
 * Варвар 6-го уровня с Телосложением 16 (модификатор +3, мастерство +3).
 *
 * @param {object[]} activeEffects - его эффекты
 * @param {object} overrides - поля сущности
 * @returns {object} персонаж
 */
function barbarian(activeEffects, overrides = {}) {
  const system = structuredClone(engine.DEFAULT_ACTOR.system);

  return withHp(
    createActor,
    20,
    {
      id: HERO_ID,
      system: {
        ...system,
        abilities: { ...system.abilities, constitution: 16 },
        classes: [{ classKey: 'barbarian', level: 6, hitDie: 12 }],
      },
      activeEffects,
      ...overrides,
    },
    40,
  );
}

/**
 * Срабатывание «получил урон»: урон тому, кто ударил.
 *
 * @param {string} formula - формула урона
 * @param {string} condition - условие срабатывания
 * @returns {object[]} срабатывания эффекта
 */
function retaliation(formula, condition) {
  return [
    {
      id: 'trigger_back',
      event: 'damageTaken',
      recipient: 'other',
      ...(condition ? { condition } : {}),
      actions: [{ type: 'damage', parts: [{ formula }] }],
    },
  ];
}

/**
 * Маг бьёт носителя огнём — срабатывают события урона носителя.
 *
 * @param {object} hero - носитель
 * @returns {{ mageHp: number, summaries: string }} хиты мага и сводки чата
 */
function strikeByMage(hero) {
  const mage = withHp(createCreature, MAGE_HP, { id: MAGE_ID });

  const entities = new Map([
    [hero.id, hero],
    [mage.id, mage],
  ]);

  const result = withRandom([MAX_ROLL], () =>
    strikeEntity(new engine.Dnd5eVttSystem(), hero, 6, 'fire', {
      details: { critical: false, sourceId: MAGE_ID },
      context: { getEntity: (entityId) => entities.get(entityId) },
    }),
  );

  return {
    mageHp: engine.resolveEntityCurrentHp(mage),
    summaries: [
      result?.chatSummary,
      ...(result?.related ?? []).map((related) => related.chatSummary),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

describe('свой постоянный эффект: числа владельца в срабатываниях', () => {
  it('модификатор и мастерство владельца идут в урон другой стороне', () => {
    const thorns = createEffect('Шипы', {
      triggers: retaliation('2d6@dmg.fire + @mod.con'),
    });

    assert.equal(
      strikeByMage(barbarian([thorns])).mageHp,
      MAGE_HP - 15,
      '2к6 на максимум и +3 Телосложения',
    );

    const proficient = createEffect('Шипы', {
      triggers: retaliation('@prof@dmg.fire'),
    });

    assert.equal(strikeByMage(barbarian([proficient])).mageHp, MAGE_HP - 3);
  });

  it('уровень своего класса — по метке класса в id эффекта', () => {
    const scaling = createEffect('class-effect:barbarian:thorns', {
      triggers: retaliation('(1 + steps(@classLevel, 5))d6@dmg.fire'),
    });

    assert.equal(
      strikeByMage(barbarian([scaling])).mageHp,
      MAGE_HP - 12,
      '6-й уровень варвара: 2к6',
    );
  });

  it('условие с выбором владельца читает ответ его листа', () => {
    const boon = createEffect('Дар', {
      originId: 'feat:feature_boon',
      triggers: retaliation(
        '2d6@dmg.fire',
        'damage.type === "@choice.damage-type"',
      ),
    });

    const chosen = barbarian([boon], {
      features: [
        {
          id: 'feature_boon',
          name: 'Дар',
          choices: { 'damage-type': ['fire', 'cold'] },
        },
      ],
    });

    assert.equal(strikeByMage(chosen).mageHp, MAGE_HP - 12);

    // Выбор не сделан — условие не выполняется, как и раньше
    assert.equal(strikeByMage(barbarian([boon])).mageHp, MAGE_HP);
  });

  it('лечение и урон на своей атаке считаются по атакующему', () => {
    const feast = createEffect('Кровавый пир', {
      triggers: [
        {
          id: 'trigger_feast',
          event: 'attackRoll',
          role: 'attacker',
          condition: 'attack.landed === true',
          actions: [
            { type: 'damage', parts: [{ formula: '6@heal + @mod.con' }] },
          ],
        },
        {
          id: 'trigger_brand',
          event: 'attackRoll',
          role: 'attacker',
          recipient: 'other',
          condition: 'attack.landed === true',
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '6 + @prof', type: 'radiant' }],
            },
          ],
        },
      ],
    });

    const hero = barbarian([feast]);
    const foe = withHp(createCreature, 50, { id: MAGE_ID });

    engine.settleAttackRollTriggers(hero, 'attacker', {
      other: foe,
      roll: {},
      landed: true,
      inCombat: true,
    });

    assert.equal(engine.resolveEntityCurrentHp(hero), 20 + 9);
    assert.equal(engine.resolveEntityCurrentHp(foe), 50 - 9);
  });

  it('урон каждый ход своего эффекта и черты существа считаются по носителю', () => {
    const regeneration = createEffect('Регенерация', {
      recurringDamage: {
        damageParts: [{ formula: '1@heal + @mod.con' }],
        timing: 'startOfTurn',
      },
    });

    const hero = barbarian([regeneration]);
    const turn = engine.processTurnEffects(hero, 'startOfTurn');

    assert.equal(engine.resolveEntityCurrentHp(hero), 20 + 4);
    assert.deepEqual(turn.notes, []);

    // Черта статблока: мастерство существа из его записи
    const troll = withHp(
      createCreature,
      30,
      {
        id: 'creature_troll',
        system: {
          ...structuredClone(engine.DEFAULT_CREATURE.system),
          proficiencyBonus: 3,
          traits: [
            createTrait('Живучесть', [
              createEffect('Живучесть', {
                recurringDamage: {
                  damageParts: [{ formula: '2@heal + @prof' }],
                  timing: 'startOfTurn',
                },
              }),
            ]),
          ],
        },
      },
      60,
    );

    engine.processTurnEffects(troll, 'startOfTurn');

    assert.equal(engine.resolveEntityCurrentHp(troll), 30 + 5);
  });

  it('запись на листе не меняется: числа подставляются в копию', () => {
    const thorns = createEffect('Шипы', {
      triggers: retaliation('2d6@dmg.fire + @mod.con'),
    });

    const hero = barbarian([thorns]);

    strikeByMage(hero);

    assert.equal(
      hero.activeEffects[0].triggers[0].actions[0].parts[0].formula,
      '2d6@dmg.fire + @mod.con',
    );
  });

  it('эффект без токенов владельца возвращается тем же объектом', () => {
    const plain = createEffect('Шипы', {
      triggers: retaliation('2d6@dmg.fire'),
    });

    const [bound] = engine.bindOwnEffectFormulas([plain], barbarian([plain]));

    assert.equal(bound, plain);
  });

  it('аура чужого токена числа носителя не получает: её владелец — другой', () => {
    const aura = createEffect('Аура', {
      triggers: retaliation('@mod.con@dmg.fire'),
    });

    const [source] = engine.buildTriggerSources(
      [aura],
      engine.EFFECT_TRIGGER_SOURCE_KINDS.aura,
      (effect) => effect.triggers,
    );

    assert.equal(
      source.trigger.actions[0].parts[0].formula,
      '@mod.con@dmg.fire',
    );
  });
});

describe('свой постоянный эффект: непосчитанное видно', () => {
  it('слагаемое с неподставленным токеном уходит строкой в сводку', () => {
    // Круг ячейки ставит только каст: у постоянного эффекта его нет
    const broken = createEffect('Шипы', {
      triggers: retaliation('2d6@dmg.fire + @castLevel'),
    });

    const { mageHp, summaries } = strikeByMage(barbarian([broken]));

    assert.equal(mageHp, MAGE_HP, 'наполовину формула не считается');

    assert.match(
      summaries,
      /Шипы: не посчитано автоматически — 2d6 ?\+ ?@castLevel/,
    );
  });

  it('лечение с неподставленным токеном — тоже', () => {
    const broken = createEffect('Пир', {
      recurringDamage: {
        damageParts: [{ formula: '6@heal + @castLevel' }],
        timing: 'startOfTurn',
      },
    });

    const hero = barbarian([broken]);
    const turn = engine.processTurnEffects(hero, 'startOfTurn');

    assert.equal(engine.resolveEntityCurrentHp(hero), 20);
    assert.equal(turn.notes.length, 1);
    assert.match(turn.notes[0], /^Пир: не посчитано автоматически — /);
  });
});
