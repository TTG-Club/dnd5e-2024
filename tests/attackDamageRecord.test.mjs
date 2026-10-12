import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Запись об уроне атаки в карточке чата: кнопка «Отменить урон» возвращает
 * цели ровно снятое (с временными хитами), «Нанести урон» перебрасывает только
 * кости урона — по тем же целям, с той же долей спасброска.
 */

/** Максимум хитов цели */
const MAX_HP = 30;

/**
 * Цель с текущими и временными хитами.
 *
 * @param {number} current - текущие хиты
 * @param {number} temp - временные хиты
 * @returns {object} существо
 */
function createTarget(current, temp = 0) {
  const target = withHp(createCreature, current, {}, MAX_HP);

  target.system.hitPoints.temp = temp;

  return target;
}

/**
 * Запись об уроне одной формулой по одной цели.
 *
 * @param {object} target - цель
 * @param {object} result - итог применения урона
 * @param {string|undefined} damageType - тип урона
 * @returns {object} запись
 */
function buildRecord(target, result, damageType = undefined) {
  return engine.buildSingleTargetDamageRecord({
    label: 'Длинный меч',
    formula: '2d8+3',
    damageType,
    targetId: target.id,
    result,
    details: { critical: true, sourceId: 'actor_hero' },
  });
}

describe('запись об уроне атаки', () => {
  it('переживает дорогу через чат строкой', () => {
    const target = createTarget(20);
    const copy = structuredClone(target);
    const result = engine.applyTargetDamage(copy, 7, false);
    const record = buildRecord(target, result);

    assert.deepEqual(
      engine.parseAttackDamageRecord(
        engine.serializeAttackDamageRecord(record),
      ),
      record,
    );

    assert.equal(record.critical, true);
    assert.equal(record.targets[0].hpLost, 7);
  });

  it('негодная строка записи не читается', () => {
    assert.equal(engine.parseAttackDamageRecord(undefined), null);
    assert.equal(engine.parseAttackDamageRecord('не json'), null);
    assert.equal(engine.parseAttackDamageRecord('{"label":"x"}'), null);
  });

  it('отмена возвращает и текущие, и временные хиты', () => {
    const target = createTarget(20, 5);
    const damaged = structuredClone(target);
    const result = engine.applyTargetDamage(damaged, 9, false);
    const record = buildRecord(target, result);

    assert.equal(engine.resolveEntityCurrentHp(damaged), 16);
    assert.equal(engine.resolveEntityTempHp(damaged), 0);

    assert.deepEqual(
      [record.targets[0].hpLost, record.targets[0].tempLost],
      [4, 5],
    );

    const restored = engine.revertRecordedDamage(damaged, record.targets[0]);

    assert.equal(engine.resolveEntityCurrentHp(restored), 20);
    assert.equal(engine.resolveEntityTempHp(restored), 5);
    // Цель из мира не тронута: в мир пишет только ответ сервера
    assert.equal(engine.resolveEntityCurrentHp(damaged), 16);
  });

  it('отмена считает от нынешних хитов и не превышает максимум', () => {
    const target = createTarget(28);
    const damaged = structuredClone(target);
    const result = engine.applyTargetDamage(damaged, 6, false);
    const record = buildRecord(target, result);

    // После удара цель подлечили почти до максимума
    engine.writeEntityHitPoints(damaged, { current: 27, temp: 0 });

    const restored = engine.revertRecordedDamage(damaged, record.targets[0]);

    assert.equal(engine.resolveEntityCurrentHp(restored), MAX_HP);
  });

  it('повтор наносит новый бросок той же цели и считает снятое заново', () => {
    const target = createTarget(20, 3);

    const record = buildRecord(target, {
      actorName: target.name,
      hpBefore: 20,
      hpAfter: 20,
    });

    const applied = engine.applyRecordedDamage(
      target,
      record,
      record.targets[0],
      [10],
    );

    assert.equal(applied.hpBefore, 20);
    assert.equal(applied.hpAfter, 13);
    assert.equal(applied.tempLost, 3);
    assert.equal(engine.resolveEntityCurrentHp(applied.updatedEntity), 13);
    assert.equal(engine.resolveEntityTempHp(applied.updatedEntity), 0);

    assert.deepEqual(applied.parts, [
      { part: 0, applied: 10, outcome: 'normal' },
    ]);
  });

  it('повтор помнит долю спасброска и учитывает защиты цели', () => {
    const target = createTarget(20);

    target.system.defenses = {
      ...target.system.defenses,
      immunities: ['fire'],
    };

    const record = {
      label: 'Огненный клинок',
      critical: false,
      parts: [
        { formula: '1d8', types: ['slashing'] },
        { formula: '2d6', types: ['fire'] },
      ],
      targets: [
        {
          entityId: target.id,
          name: target.name,
          hpLost: 0,
          tempLost: 0,
          contributions: [
            { part: 0, scale: 0.5 },
            { part: 1, scale: 1 },
          ],
        },
      ],
    };

    const applied = engine.applyRecordedDamage(
      target,
      record,
      record.targets[0],
      [7, 9],
    );

    // Половина от 7 с округлением вниз; огонь цель не берёт
    assert.equal(applied.parts[0].applied, 3);
    assert.equal(applied.parts[1].applied, 0);
    assert.equal(applied.parts[1].outcome, 'immunity');
    assert.equal(applied.hpAfter, 17);
  });
});

/**
 * Отмена урона снимает и то, что удар изменил помимо хитов: наложенные вместе
 * с ним эффекты и провалы спасбросков от смерти — и только это.
 */
describe('отмена урона снимает последствия удара', () => {
  /**
   * Удар по цели с эффектами: копия после удара и запись цели.
   *
   * @param {object} before - цель до удара
   * @param {number} amount - урон
   * @param {object[]} effects - эффекты цели после удара
   * @param {boolean} critical - критический ли удар
   * @returns {{ after: object, target: object }} копия и цель записи
   */
  function strike(before, amount, effects = undefined, critical = false) {
    const after = structuredClone(before);

    const result = engine.applyTargetDamage(after, amount, false, undefined, {
      critical,
    });

    if (effects) {
      after.activeEffects = effects;
    }

    return {
      after,
      target: {
        entityId: before.id,
        name: before.name,
        hpLost: result.hpBefore - result.hpAfter,
        tempLost: result.tempAbsorbed ?? 0,
        contributions: [{ part: 0, scale: 1 }],
        ...engine.captureHitConsequences(before, after),
      },
    };
  }

  /**
   * Персонаж на нуле хитов с серией спасбросков от смерти.
   *
   * @param {object} deathSaves - серия
   * @returns {object} персонаж
   */
  function createDownedActor(deathSaves) {
    const actor = withHp(createActor, 0, {}, MAX_HP);

    actor.system.deathSaves = deathSaves;

    return actor;
  }

  /**
   * Состояние с заданным id.
   *
   * @param {string} id - идентификатор эффекта
   * @param {string} conditionKey - ключ состояния
   * @param {string} name - имя
   * @returns {object} эффект-состояние
   */
  function createCondition(id, conditionKey, name) {
    return createEffect(id, { name, conditionKey });
  }

  it('удар только по хитам последствий не оставляет', () => {
    const before = createTarget(20);
    const { target } = strike(before, 5);

    assert.equal(target.addedEffectIds, undefined);
    assert.equal(target.replacedEffects, undefined);
    assert.equal(target.deathSaves, undefined);
  });

  it('снимает наложенное ударом и не трогает бывшее раньше и позже', () => {
    const blessed = createEffect('effect_bless', { name: 'Благословение' });
    const before = createTarget(20);

    before.activeEffects = [blessed];

    const poisoned = createCondition('effect_poison', 'poisoned', 'Отравлен');
    const { after, target } = strike(before, 5, [blessed, poisoned]);

    assert.deepEqual(target.addedEffectIds, ['effect_poison']);

    // После удара на цель лёг ещё один эффект — отмена его не касается
    const later = createEffect('effect_later', { name: 'Замедление' });

    after.activeEffects = [...after.activeEffects, later];

    const restored = engine.revertRecordedDamage(after, target);

    assert.deepEqual(
      restored.activeEffects.map((effect) => effect.id),
      ['effect_bless', 'effect_later'],
    );

    assert.equal(engine.resolveEntityCurrentHp(restored), 20);
  });

  it('такое же состояние от другого источника остаётся', () => {
    const before = createTarget(20);

    const { after, target } = strike(before, 5, [
      createCondition('effect_prone_hit', 'prone', 'Сбит с ног'),
    ]);

    // Состояние удара сняли, а позже цель сбили с ног заново
    after.activeEffects = [
      createCondition('effect_prone_other', 'prone', 'Сбит с ног'),
    ];

    const restored = engine.revertRecordedDamage(after, target);

    assert.deepEqual(
      restored.activeEffects.map((effect) => effect.id),
      ['effect_prone_other'],
    );
  });

  it('возвращает эффект, который удар заменил своим', () => {
    const oldPoison = createCondition(
      'effect_poison_old',
      'poisoned',
      'Отравлен',
    );

    const before = createTarget(20);

    before.activeEffects = [oldPoison];

    const { after, target } = strike(before, 5, [
      createCondition('effect_poison_new', 'poisoned', 'Отравлен'),
    ]);

    assert.deepEqual(target.addedEffectIds, ['effect_poison_new']);
    assert.deepEqual(target.replacedEffects, [oldPoison]);

    const restored = engine.revertRecordedDamage(after, target);

    assert.deepEqual(restored.activeEffects, [oldPoison]);

    // Эффект удара уже сняли руками — возвращать прежний не на что
    after.activeEffects = [];

    assert.deepEqual(
      engine.revertRecordedDamage(after, target).activeEffects,
      [],
    );
  });

  it('последствия переживают дорогу через чат', () => {
    const before = createTarget(20);

    before.activeEffects = [
      createCondition('effect_poison_old', 'poisoned', 'Отравлен'),
    ];

    const { target } = strike(before, 5, [
      createCondition('effect_poison_new', 'poisoned', 'Отравлен'),
    ]);

    const record = {
      label: 'Отравленный клинок',
      critical: false,
      parts: [{ formula: '1d6', types: ['piercing'] }],
      targets: [target],
    };

    const [parsed] = engine.parseAttackDamageRecord(
      engine.serializeAttackDamageRecord(record),
    ).targets;

    assert.deepEqual(parsed.addedEffectIds, ['effect_poison_new']);

    assert.deepEqual(
      parsed.replacedEffects.map((effect) => effect.id),
      ['effect_poison_old'],
    );
  });

  it('слишком большая запись уходит без заменённых эффектов', () => {
    const before = createTarget(20);

    before.activeEffects = [
      createEffect('effect_big', { description: 'я'.repeat(20_000) }),
    ];

    const { target } = strike(before, 5, [createEffect('effect_new')]);

    const parsed = engine.parseAttackDamageRecord(
      engine.serializeAttackDamageRecord({
        label: 'Удар',
        critical: false,
        parts: [{ formula: '1d6', types: [] }],
        targets: [target],
      }),
    );

    assert.equal(parsed.targets[0].replacedEffects, undefined);
    assert.deepEqual(parsed.targets[0].addedEffectIds, ['effect_new']);
    assert.equal(parsed.targets[0].hpLost, 5);
  });

  it('удар по лежащему на нуле: отмена снимает его провал', () => {
    const before = createDownedActor({ successes: 1, failures: 1 });
    const { after, target } = strike(before, 4);

    assert.deepEqual(target.deathSaves, {
      before: { successes: 1, failures: 1 },
      after: { successes: 1, failures: 2 },
      killed: false,
    });

    // Сервер записал провал в лист
    after.system.deathSaves = { successes: 1, failures: 2 };

    assert.deepEqual(engine.revertRecordedDeathSaves(after, target), {
      successes: 1,
      failures: 1,
    });
  });

  it('критический удар по лежащему — два провала, отмена снимает оба', () => {
    const before = createDownedActor({ successes: 0, failures: 0 });
    const { after, target } = strike(before, 4, undefined, true);

    assert.equal(target.deathSaves.after.failures, 2);

    // После удара персонаж успел бросить спасбросок и получил успех
    after.system.deathSaves = { successes: 1, failures: 2 };

    assert.deepEqual(engine.revertRecordedDeathSaves(after, target), {
      successes: 1,
      failures: 0,
    });
  });

  it('удар, убивший лежащего: отмена снимает метку смерти и провалы', () => {
    const before = createDownedActor({ successes: 0, failures: 2 });
    const { after, target } = strike(before, 4);

    assert.equal(target.deathSaves.killed, true);

    // Сервер записал смерть: три провала и метка «Мёртв»
    after.system.deathSaves = { successes: 0, failures: 3 };
    after.activeEffects = engine.withActorDeathMark([], true);

    assert.equal(engine.isActorDead(after), true);

    const restored = engine.revertRecordedDamage(after, target);

    assert.equal(engine.isActorDead(restored), false);

    assert.deepEqual(engine.revertRecordedDeathSaves(after, target), {
      successes: 0,
      failures: 2,
    });
  });

  it('хиты после отмены выше нуля — серию закрывает сервер', () => {
    const before = withHp(createActor, 5, {}, MAX_HP);
    const { after, target } = strike(before, 5 + MAX_HP);

    // Урон не меньше максимума сверх остатка хитов — мгновенная смерть
    assert.equal(target.deathSaves.killed, true);
    assert.equal(target.hpLost, 5);

    after.system.deathSaves = { successes: 0, failures: 3 };

    assert.equal(engine.revertRecordedDeathSaves(after, target), null);

    assert.equal(
      engine.resolveEntityCurrentHp(engine.revertRecordedDamage(after, target)),
      5,
    );
  });

  it('существо серии не ведёт', () => {
    const before = createTarget(0);
    const { after, target } = strike(before, 4);

    assert.equal(target.deathSaves, undefined);
    assert.equal(engine.revertRecordedDeathSaves(after, target), null);
  });

  it('повтор урона по лежащему заново считает провал серии', () => {
    const downed = createDownedActor({ successes: 0, failures: 1 });

    const record = {
      label: 'Длинный меч',
      critical: false,
      parts: [{ formula: '1d8', types: ['slashing'] }],
      targets: [
        {
          entityId: downed.id,
          name: downed.name,
          hpLost: 0,
          tempLost: 0,
          contributions: [{ part: 0, scale: 1 }],
        },
      ],
    };

    const applied = engine.applyRecordedDamage(
      downed,
      record,
      record.targets[0],
      [6],
    );

    assert.deepEqual(
      engine.captureHitConsequences(downed, applied.updatedEntity).deathSaves,
      {
        before: { successes: 0, failures: 1 },
        after: { successes: 0, failures: 2 },
        killed: false,
      },
    );
  });

  it('запись одной формулой несёт последствия удара', () => {
    const downed = createDownedActor({ successes: 0, failures: 0 });
    const details = { critical: false, sourceId: 'actor_hero' };

    const record = engine.buildSingleTargetDamageRecord({
      label: 'Длинный меч',
      formula: '1d8',
      damageType: 'slashing',
      targetId: downed.id,
      result: { actorName: downed.name, hpBefore: 0, hpAfter: 0 },
      details,
      consequences: engine.previewDamageConsequences(
        downed,
        6,
        'slashing',
        details,
      ),
    });

    assert.equal(record.targets[0].deathSaves.after.failures, 1);
    // Цель предварительным расчётом не тронута
    assert.deepEqual(downed.system.deathSaves, { successes: 0, failures: 0 });
  });
});
