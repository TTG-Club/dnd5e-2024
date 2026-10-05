import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';
import {
  allCreaturesAura,
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
} from './scenarios/_fixtures.mjs';

/**
 * Условие ауры на накрытом (VTTG 0.9.601+): ядро кладёт на каждого, до кого
 * достаёт аура с флагами, эффект ауры целиком и пишет носителя ауры наложившим.
 * Раньше в записи были только имя, значок, числа и флаги — «Ореол: помеха
 * исчадиям и нежити» давал помеху любому в ауре и по любой цели.
 *
 * Система читает у условия условие броска и наложившего, а всё исполняемое из
 * него убирает (`shapeAuraCondition`): та же аура приходит ей ещё и списком
 * аур, и по обоим спискам срабатывания шли бы дважды.
 */

const system = new engine.Dnd5eVttSystem();

/** Носитель ореола */
const BEARER_ID = 'actor_bearer';

/** Префикс id условия ауры — как у ядра (`AURA_CONDITION_ID_PREFIX`) */
const AURA_CONDITION_ID_PREFIX = 'aura_cond_';

/**
 * «Ореол: помеха исчадиям и нежити» из «Книги возвышенных деяний», включённый:
 * аура 10 футов, помеха на атаки исчадий и нежити по носителю.
 */
const HALO_WARD = createEffect('effect-book-of-exalted-deeds-dmg-halo-ward', {
  name: 'Ореол: помеха исчадиям и нежити',
  icon: 'tabler:sun',
  origin: 'item',
  flags: ['attack.disadvantage'],
  aura: { radius: 10, target: 'all', applyToSelf: false, visible: false },
  effectTarget: 'self',
  rollCondition:
    'self.creatureType === "fiend, undead" && target.isSource === true',
  activation: { mode: 'toggle' },
});

/**
 * Условие ауры, каким его собирает ядро (`toAuraCondition`,
 * `vttg/packages/server/src/utils/auraConditions.ts`): эффект ауры целиком без
 * полей излучения, со своими id, описанием, происхождением и сроком, наложивший
 * — носитель ауры. Последнее слово — у системы.
 *
 * @param {object} ambient - эффект ауры у цели (от `calculateAmbientAuras`)
 * @param {object} sourceToken - фишка-источник ауры
 * @returns {object} условие, которое ляжет на накрытого
 */
function toCoreAuraCondition(ambient, sourceToken) {
  const { aura, areaTrigger, effectTarget, ...carried } = ambient;

  return system.shapeAuraCondition({
    ...carried,
    id: `${AURA_CONDITION_ID_PREFIX}${ambient.id}`,
    description: `Наложено аурой: ${ambient.name}`,
    disabled: false,
    origin: 'condition',
    transfer: false,
    duration: { type: 'permanent' },
    sourceActorId: ambient.sourceActorId ?? sourceToken.actorId,
  });
}

/**
 * Ауры носителя, достающие до фишки, и условия, которыми они ложатся на её
 * сущность.
 *
 * @param {object} bearer - носитель аур
 * @param {object} bearerToken - его фишка
 * @param {object} coveredToken - фишка накрытого
 * @returns {{ ambient: object[], conditions: object[] }} ауры и условия
 */
function coverWithAuras(bearer, bearerToken, coveredToken) {
  const ambient = system.calculateAmbientAuras(
    coveredToken,
    [{ token: bearerToken, effects: system.collectAuraEffects(bearer) }],
    GRID,
  );

  return {
    ambient,
    conditions: ambient
      .filter((effect) => effect.flags.length > 0)
      .map((effect) => toCoreAuraCondition(effect, bearerToken)),
  };
}

/**
 * Флаги броска атаки накрытого по цели — как их собирает окно броска:
 * эффекты «только в бросках», чьё условие выполнено.
 *
 * @param {object} attacker - атакующий с условиями аур в `activeEffects`
 * @param {string} targetId - по кому бьёт
 * @returns {string[]} флаги
 */
function attackRollFlags(attacker, targetId) {
  return engine.collectRollConditionFlags(
    engine.collectActiveEffects(attacker),
    {
      hasAdvantage: false,
      hasDisadvantage: false,
      target: { entityId: targetId, currentHp: 10, maxHp: 10, markedBy: [] },
      self: engine.buildCarrierContext(attacker),
    },
  );
}

/**
 * Существо заданного типа, стоящее в ореоле носителя.
 *
 * @param {string} id - id существа
 * @param {string} type - тип существа
 * @returns {object} существо с условием ауры
 */
function coveredCreature(id, type) {
  const creature = createCreature({ id });

  creature.system.type = type;

  const bearer = createActor({ id: BEARER_ID, activeEffects: [HALO_WARD] });

  creature.activeEffects = coverWithAuras(
    bearer,
    createToken(BEARER_ID, 0, 0),
    createToken(id, 1, 0),
  ).conditions;

  return creature;
}

describe('«Ореол: помеха исчадиям и нежити» условием ауры', () => {
  it('условие несёт условие броска и носителя ауры наложившим', () => {
    const [condition] = coveredCreature(
      'creature_devil',
      'fiend',
    ).activeEffects;

    assert.equal(condition.id.startsWith(AURA_CONDITION_ID_PREFIX), true);
    assert.equal(condition.rollCondition, HALO_WARD.rollCondition);
    assert.equal(condition.sourceActorId, BEARER_ID);
    assert.deepEqual(condition.flags, ['attack.disadvantage']);
  });

  it('исчадие в ауре бьёт носителя — помеха', () => {
    const devil = coveredCreature('creature_devil', 'fiend');

    assert.deepEqual(attackRollFlags(devil, BEARER_ID), [
      'attack.disadvantage',
    ]);
  });

  it('гуманоид в ауре бьёт носителя — без помехи', () => {
    const bandit = coveredCreature('creature_bandit', 'humanoid');

    assert.deepEqual(attackRollFlags(bandit, BEARER_ID), []);
  });

  it('исчадие в ауре бьёт третье существо — без помехи', () => {
    const devil = coveredCreature('creature_devil', 'fiend');

    assert.deepEqual(attackRollFlags(devil, 'creature_bystander'), []);
  });

  it('в числа листа помеха не входит ни у кого: она только в броске', () => {
    for (const type of ['fiend', 'humanoid']) {
      assert.equal(
        engine
          .resolveActorStats(coveredCreature(`creature_${type}`, type))
          .activeFlags.has('attack.disadvantage'),
        false,
        type,
      );
    }
  });

  it('у накрытого нет кнопки чужого переключателя', () => {
    const [condition] = coveredCreature(
      'creature_devil',
      'fiend',
    ).activeEffects;

    assert.equal('activation' in condition, false);
  });
});

describe('условие ауры остаётся пассивным', () => {
  it('каждое поле эффекта либо несётся накрытому, либо убирается — третьего нет', () => {
    const source = readFileSync(
      join(systemRoot, 'src/engine/activeEffectTypes.ts'),
      'utf8',
    );

    const start = source.indexOf('export interface ActiveEffect extends');
    const body = source.slice(start, source.indexOf('\n}\n', start));

    const fields = [...body.matchAll(/^ {2}([a-zA-Z]+)\??:/gmu)].map(
      (match) => match[1],
    );

    assert.ok(fields.length > 40, 'поля эффекта прочитаны');

    const decided = [
      ...engine.AURA_CONDITION_CARRIED_FIELDS,
      ...engine.AURA_CONDITION_DROPPED_FIELDS,
    ];

    assert.deepEqual([...decided].sort(), [...fields].sort());
    assert.equal(new Set(decided).size, decided.length, 'поле решено один раз');
  });

  it('остаётся ровно то, что названо несомым', () => {
    const everything = Object.fromEntries(
      [
        ...engine.AURA_CONDITION_CARRIED_FIELDS,
        ...engine.AURA_CONDITION_DROPPED_FIELDS,
      ].map((field) => [field, `value:${field}`]),
    );

    assert.deepEqual(
      Object.keys(engine.shapeAuraCondition(everything)).sort(),
      [...engine.AURA_CONDITION_CARRIED_FIELDS].sort(),
    );
  });

  it('поле без значения в условие не пишется', () => {
    const shaped = engine.shapeAuraCondition(createEffect('Аура'));

    assert.equal('rollCondition' in shaped, false);
    assert.equal('sourceActorId' in shaped, false);
  });

  it('аура со срабатыванием на ходу бьёт накрытого один раз, а не дважды', () => {
    // Аура с флагом (значит, ляжет условием) и уроном в начале хода накрытого
    const searing = createEffect('Жгучая аура', {
      aura: allCreaturesAura(10),
      flags: ['attack.disadvantage'],
      triggers: [
        {
          id: 'trigger_searing',
          event: 'turnStart',
          actions: [{ type: 'damage', parts: [{ formula: '4@dmg.fire' }] }],
        },
      ],
    });

    const bearer = createActor({ id: BEARER_ID, activeEffects: [searing] });
    const hero = withHp(createActor, 30, { id: 'actor_hero' });

    const { ambient, conditions } = coverWithAuras(
      bearer,
      createToken(BEARER_ID, 0, 0),
      createToken(hero.id, 1, 0),
    );

    hero.activeEffects = conditions;

    assert.equal(conditions.length, 1);
    assert.equal('triggers' in conditions[0], false);

    withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(hero, 'startOfTurn', {
        ambientEffects: ambient,
      }),
    );

    assert.equal(engine.resolveEntityCurrentHp(hero), 26, 'урон один раз');
  });

  it('кость ауры к спасброску считается один раз: условие и аура — одно и то же', () => {
    const blessing = createEffect('Благая аура', {
      aura: allCreaturesAura(10),
      flags: ['save.advantage.wisdom'],
      changes: [change('save.constitution', '1d4')],
    });

    const bearer = createActor({ id: BEARER_ID, activeEffects: [blessing] });
    const hero = createActor({ id: 'actor_hero' });

    const { ambient, conditions } = coverWithAuras(
      bearer,
      createToken(BEARER_ID, 0, 0),
      createToken(hero.id, 1, 0),
    );

    hero.activeEffects = conditions;

    const context = engine.buildEffectSavingThrowContext(hero, ambient);

    assert.deepEqual(
      context.effects.map((effect) => effect.name),
      ['Благая аура'],
    );
  });
});

describe('ауры без условия и ауры с отношением — как раньше', () => {
  it('аура из одних чисел условием не ложится и считается из списка аур', () => {
    // «Аура защиты» паладина: модификатор Харизмы носителя к спасброскам
    const protection = createEffect('Аура защиты', {
      aura: { radius: 10, target: 'allies', applyToSelf: true, visible: true },
      changes: [change('save.wisdom', '3')],
    });

    const paladin = createActor({ id: BEARER_ID, activeEffects: [protection] });
    const ally = createActor({ id: 'actor_ally' });

    const { ambient, conditions } = coverWithAuras(
      paladin,
      createToken(BEARER_ID, 0, 0, { disposition: 'friendly' }),
      createToken(ally.id, 1, 0, { disposition: 'friendly' }),
    );

    assert.deepEqual(conditions, [], 'числа условием не ложатся');
    assert.equal(ambient.length, 1);
    assert.equal(ambient[0].sourceActorId, BEARER_ID);

    const alone = engine.resolveActorStats(ally).saves.wisdom;
    const covered = engine.resolveActorStats(ally, ambient).saves.wisdom;

    assert.equal(covered - alone, 3);
  });

  it('аура «союзникам» до врага не достаёт, аура «врагам» — до союзника', () => {
    const forAllies = createEffect('Союзникам', {
      aura: { radius: 10, target: 'allies', applyToSelf: false, visible: true },
      flags: ['save.advantage.wisdom'],
    });

    const forEnemies = createEffect('Врагам', {
      aura: {
        radius: 10,
        target: 'enemies',
        applyToSelf: false,
        visible: true,
      },
      flags: ['attack.disadvantage'],
    });

    const bearer = createActor({
      id: BEARER_ID,
      activeEffects: [forAllies, forEnemies],
    });

    const bearerToken = createToken(BEARER_ID, 0, 0, {
      disposition: 'friendly',
    });

    const names = (disposition) =>
      coverWithAuras(
        bearer,
        bearerToken,
        createToken('creature_other', 1, 0, { disposition }),
      ).conditions.map((condition) => condition.name);

    assert.deepEqual(names('friendly'), ['Союзникам']);
    assert.deepEqual(names('hostile'), ['Врагам']);
    assert.deepEqual(names('neutral'), []);
  });

  it('одна аура от двух носителей — два условия, у каждого свой наложивший', () => {
    const second = createActor({
      id: 'actor_second',
      activeEffects: [HALO_WARD],
    });

    const first = createActor({ id: BEARER_ID, activeEffects: [HALO_WARD] });
    const devilToken = createToken('creature_devil', 1, 0);

    const conditions = [
      ...coverWithAuras(first, createToken(BEARER_ID, 0, 0), devilToken)
        .conditions,
      ...coverWithAuras(second, createToken(second.id, 2, 0), devilToken)
        .conditions,
    ];

    assert.equal(new Set(conditions.map((entry) => entry.id)).size, 2);

    assert.deepEqual(
      conditions.map((entry) => entry.sourceActorId),
      [BEARER_ID, 'actor_second'],
    );

    const devil = createCreature({ id: 'creature_devil' });

    devil.system.type = 'fiend';
    devil.activeEffects = conditions;

    // Помеха — по каждому из двух носителей, и только по ним
    assert.deepEqual(attackRollFlags(devil, BEARER_ID), [
      'attack.disadvantage',
    ]);

    assert.deepEqual(attackRollFlags(devil, 'actor_second'), [
      'attack.disadvantage',
    ]);

    assert.deepEqual(attackRollFlags(devil, 'creature_bystander'), []);
  });
});
