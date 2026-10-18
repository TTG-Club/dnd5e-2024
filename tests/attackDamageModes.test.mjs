import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createCreature, engine, withHp } from './scenarios/_fixtures.mjs';

/**
 * Режимы урона в карточке чата: «Половина» и «Крит» под нанесённым или
 * отменённым уроном. Урон не перебрасывается — меняется, сколько записанного
 * броска досталось цели, а хиты правятся ровно на разницу.
 */

/** Максимум хитов цели */
const MAX_HP = 30;

/** Обычный удар: 2к6+3, выпало 4 и 2 */
const NORMAL_ROLL = { formula: '2d6+3', total: 9, values: [4, 2] };

/** Тот же удар критом: кости удвоены, вторая пара — кости крита */
const CRITICAL_ROLL = { formula: '4d6+3', total: 20, values: [4, 2, 5, 6] };

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
 * Наносит цели бросок, как это делает атака, и собирает запись об уроне.
 *
 * @param {object} target - цель до удара
 * @param {object} roll - брошенная формула, итог и кости
 * @param {object} options - крит и тип урона
 * @returns {{ entity: object, record: object }} цель после удара и запись
 */
function hit(target, roll, options = {}) {
  const entity = structuredClone(target);
  const details = { critical: options.critical ?? false };

  const result = engine.applyTargetDamage(
    entity,
    roll.total,
    false,
    options.damageType,
    details,
  );

  const record = engine.buildSingleTargetDamageRecord({
    label: 'Длинный меч',
    formula: roll.formula,
    damageType: options.damageType,
    targetId: target.id,
    result,
    details,
    roll: { total: roll.total, values: roll.values },
  });

  return { entity, record };
}

/**
 * Переключает режимы урона и возвращает цель и запись после переключения.
 *
 * @param {object} state - цель и запись сейчас
 * @param {object} next - новые режимы
 * @param {boolean} isApplied - урон сейчас нанесён
 * @returns {{ entity: object, record: object, change: object }} новое состояние
 */
function switchModes(state, next, isApplied = true) {
  const modes = { ...engine.readDamageModes(state.record), ...next };

  const change = engine.changeRecordedDamageModes(
    state.entity,
    state.record,
    state.record.targets[0],
    modes,
    isApplied,
  );

  return {
    entity: change.updatedEntity,
    record: { ...state.record, ...modes, targets: [change.target] },
    change,
  };
}

/**
 * Текущие хиты цели.
 *
 * @param {object} state - цель и запись
 * @returns {number} хиты
 */
function hp(state) {
  return engine.resolveEntityCurrentHp(state.entity);
}

describe('бросок части урона в записи', () => {
  it('обычный бросок помнит кости и кости возможного крита', () => {
    assert.deepEqual(
      engine.describeDamagePartRoll({ ...NORMAL_ROLL, critical: false }),
      { formula: '2d6+3', total: 9, dice: [4, 2], critFormula: '2d6' },
    );
  });

  it('бросок критом делится: вторая половина костей — крит', () => {
    assert.deepEqual(
      engine.describeDamagePartRoll({ ...CRITICAL_ROLL, critical: true }),
      {
        formula: '2d6+3',
        total: 9,
        dice: [4, 2],
        critFormula: '2d6',
        critTotal: 11,
        critDice: [5, 6],
      },
    );
  });

  it('несколько костей делятся по слагаемым, с учётом знака', () => {
    const roll = engine.describeDamagePartRoll({
      formula: '2d8+4d6-2d4+1',
      total: 20,
      values: [3, 7, 1, 2, 5, 6, 2, 4],
      critical: true,
    });

    assert.equal(roll.formula, '1d8+2d6-1d4+1');
    assert.equal(roll.critFormula, '1d8 + 2d6 - 1d4');
    assert.deepEqual(roll.dice, [3, 1, 2, 2]);
    assert.deepEqual(roll.critDice, [7, 5, 6, 4]);
    assert.equal(roll.critTotal, 7 + 5 + 6 - 4);
    assert.equal(roll.total, 20 - 14);
  });

  it('без костей броска крит — половина суммы костей вниз', () => {
    const roll = engine.describeDamagePartRoll({
      formula: '4d6+3',
      total: 20,
      critical: true,
    });

    // Кости дали 17: половина вниз — 8, обычному урону остаётся 12
    assert.equal(roll.critTotal, 8);
    assert.equal(roll.total, 12);
    assert.equal(roll.formula, '2d6+3');
  });

  it('вычет из урона и урон без костей крита не имеют', () => {
    assert.equal(
      engine.describeDamagePartRoll({
        formula: '-1d8',
        total: -5,
        values: [5],
        critical: true,
      }).critFormula,
      undefined,
    );

    assert.deepEqual(
      engine.describeDamagePartRoll({
        formula: '5',
        total: 5,
        critical: true,
      }),
      { formula: '5', total: 5 },
    );
  });

  it('запись с бросками и режимами переживает дорогу через чат', () => {
    const state = switchModes(
      hit(createTarget(30), CRITICAL_ROLL, { critical: true }),
      {
        half: true,
      },
    );

    assert.deepEqual(
      engine.parseAttackDamageRecord(
        engine.serializeAttackDamageRecord(state.record),
      ),
      state.record,
    );
  });

  it('старая запись без бросков режимов не знает', () => {
    const record = {
      label: 'Длинный меч',
      critical: false,
      parts: [{ formula: '2d6+3', types: [] }],
      targets: [],
    };

    assert.equal(engine.supportsDamageModes(record), false);
    assert.equal(engine.hasCritDice(record), false);
  });
});

describe('половина урона', () => {
  it('полный → половина → полный возвращает ровно прежние хиты', () => {
    const full = hit(createTarget(30), NORMAL_ROLL);

    assert.equal(hp(full), 21);
    assert.deepEqual(full.record.targets[0].totals, { normal: 9 });

    // Половина от 9 вниз — 4: цели возвращается 5
    const half = switchModes(full, { half: true });

    assert.equal(hp(half), 26);
    assert.equal(half.record.half, true);
    assert.equal(half.record.targets[0].hpLost, 4);
    assert.equal(half.change.damage, 4);

    assert.deepEqual(half.change.hpChange, {
      hpBefore: 21,
      hpAfter: 26,
      tempBefore: 0,
      tempAfter: 0,
      isPublic: half.change.hpChange.isPublic,
    });

    const back = switchModes(half, { half: false });

    assert.equal(hp(back), 21);
    assert.equal(back.record.targets[0].hpLost, 9);
  });

  it('половинится урон после защит цели, а не бросок', () => {
    const target = createTarget(30);

    target.system.defenses = {
      ...target.system.defenses,
      resistances: ['fire'],
    };

    // Сопротивление: 9 → 4; половина от 4 — 2
    const full = hit(target, NORMAL_ROLL, { damageType: 'fire' });

    assert.equal(hp(full), 26);

    const half = switchModes(full, { half: true });

    assert.equal(hp(half), 28);
    assert.equal(half.change.total, 4);
    assert.equal(half.change.damage, 2);
  });

  it('возвращает сперва текущие хиты, потом временные', () => {
    const full = hit(createTarget(20, 5), NORMAL_ROLL);

    assert.equal(hp(full), 16);
    assert.equal(engine.resolveEntityTempHp(full.entity), 0);

    // Удар снял 5 временных и 4 текущих; вернуть надо 5
    const half = switchModes(full, { half: true });

    assert.equal(hp(half), 20);
    assert.equal(engine.resolveEntityTempHp(half.entity), 1);
    assert.equal(half.record.targets[0].hpLost, 0);
    assert.equal(half.record.targets[0].tempLost, 4);

    const back = switchModes(half, { half: false });

    assert.equal(hp(back), 16);
    assert.equal(engine.resolveEntityTempHp(back.entity), 0);
    assert.equal(back.record.targets[0].hpLost, 4);
    assert.equal(back.record.targets[0].tempLost, 5);
  });

  it('у цели, которой не хватило хитов, возвращает только лишнее', () => {
    const full = hit(createTarget(5), NORMAL_ROLL);

    assert.equal(hp(full), 0);
    assert.equal(full.record.targets[0].hpLost, 5);

    // Половина — 4 урона из 5 хитов: остаётся 1
    const half = switchModes(full, { half: true });

    assert.equal(hp(half), 1);

    const back = switchModes(half, { half: false });

    assert.equal(hp(back), 0);
    assert.equal(back.record.targets[0].hpLost, 5);
  });

  it('считает от нынешних хитов: лечение после удара остаётся', () => {
    const full = hit(createTarget(30), NORMAL_ROLL);

    // Цель подлечили на 8 после удара
    engine.writeEntityHitPoints(full.entity, { current: 29, temp: 0 });

    const half = switchModes(full, { half: true });

    // Вернуть надо 5, но выше максимума хиты не поднимаются
    assert.equal(hp(half), MAX_HP);
    assert.equal(half.record.targets[0].hpLost, 4);
  });

  it('отменённый урон наносится половиной записанного броска', () => {
    const full = hit(createTarget(30), NORMAL_ROLL);

    const reverted = {
      entity: engine.revertRecordedDamage(full.entity, full.record.targets[0]),
      record: full.record,
    };

    assert.equal(hp(reverted), 30);

    const half = switchModes(reverted, { half: true }, false);

    assert.equal(hp(half), 26);
    assert.equal(half.record.targets[0].hpLost, 4);
    assert.deepEqual(half.record.targets[0].totals, { normal: 9 });

    // Удар записан для событий урона на сервере — как при «Нанести урон»
    assert.equal(engine.readDamageHits(half.entity).length, 1);
  });
});

describe('крит под уроном', () => {
  /**
   * Запись обычного удара с брошенными костями крита: 2к6 → 5 и 2.
   *
   * @param {object} state - цель и запись
   * @returns {object} то же с костями крита в записи
   */
  function withCritRoll(state) {
    assert.deepEqual(engine.listUnrolledCritDice(state.record), [
      { part: 0, formula: '2d6' },
    ]);

    return {
      ...state,
      record: engine.withCritDiceRolls(state.record, [
        { part: 0, total: 7, values: [5, 2] },
      ]),
    };
  }

  it('«Крит» добавляет кости крита, «Не крит» убирает ровно их', () => {
    const full = withCritRoll(hit(createTarget(30), NORMAL_ROLL));
    const critical = switchModes(full, { critical: true });

    assert.equal(hp(critical), 14);
    assert.equal(critical.record.critical, true);
    assert.equal(critical.record.targets[0].hpLost, 16);

    assert.deepEqual(critical.record.targets[0].totals, {
      normal: 9,
      critical: 16,
    });

    assert.deepEqual(critical.record.parts[0].roll.critDice, [5, 2]);

    const normal = switchModes(critical, { critical: false });

    assert.equal(hp(normal), 21);
    assert.equal(normal.record.targets[0].hpLost, 9);

    // Кости крита остаются в записи: повторный «Крит» их не перебрасывает
    assert.deepEqual(engine.listUnrolledCritDice(normal.record), []);
  });

  it('попадание критом: «Не крит» снимает кости крита из броска', () => {
    const critical = hit(createTarget(30), CRITICAL_ROLL, { critical: true });

    assert.equal(hp(critical), 10);
    assert.deepEqual(engine.listUnrolledCritDice(critical.record), []);
    assert.equal(engine.hasCritDice(critical.record), true);

    // Кости крита 5 и 6: цели возвращается 11
    const normal = switchModes(critical, { critical: false });

    assert.equal(hp(normal), 21);
    assert.equal(normal.record.critical, false);

    const back = switchModes(normal, { critical: true });

    assert.equal(hp(back), 10);
    assert.equal(back.record.targets[0].hpLost, 20);
  });

  it('половина и крит вместе — половина от урона с костями крита', () => {
    const full = withCritRoll(hit(createTarget(30), NORMAL_ROLL));

    // (9 + 7) / 2 = 8
    const both = switchModes(full, { half: true, critical: true });

    assert.equal(hp(both), 22);
    assert.equal(both.change.total, 16);
    assert.equal(both.change.damage, 8);

    // По шагам выходит то же: сперва крит, потом половина
    const stepped = switchModes(switchModes(full, { critical: true }), {
      half: true,
    });

    assert.equal(hp(stepped), 22);

    // «Не крит» при половине: половина от 9 — 4
    const halfOnly = switchModes(both, { critical: false });

    assert.equal(hp(halfOnly), 26);

    const normal = switchModes(halfOnly, { half: false });

    assert.equal(hp(normal), 21);
  });

  it('отмена после крита и половины возвращает всё снятое', () => {
    const state = switchModes(
      withCritRoll(hit(createTarget(22, 4), NORMAL_ROLL)),
      { critical: true },
    );

    // 16 урона: 4 временных и 12 текущих
    assert.equal(hp(state), 10);
    assert.equal(state.record.targets[0].tempLost, 4);

    const reverted = engine.revertRecordedDamage(
      state.entity,
      state.record.targets[0],
    );

    assert.equal(engine.resolveEntityCurrentHp(reverted), 22);
    assert.equal(engine.resolveEntityTempHp(reverted), 4);

    const half = switchModes(state, { half: true });

    const revertedHalf = engine.revertRecordedDamage(
      half.entity,
      half.record.targets[0],
    );

    assert.equal(engine.resolveEntityCurrentHp(revertedHalf), 22);
    assert.equal(engine.resolveEntityTempHp(revertedHalf), 4);
  });

  it('отменённый урон наносится с костями крита одним шагом', () => {
    const full = withCritRoll(hit(createTarget(30), NORMAL_ROLL));

    const reverted = {
      entity: engine.revertRecordedDamage(full.entity, full.record.targets[0]),
      record: full.record,
    };

    const critical = switchModes(reverted, { critical: true }, false);

    assert.equal(hp(critical), 14);
    assert.equal(critical.record.targets[0].hpLost, 16);

    const [recorded] = engine.readDamageHits(critical.entity);

    assert.equal(recorded.critical, true);
  });

  it('цели без хитов крит больше ничего не снимает', () => {
    const full = withCritRoll(hit(createTarget(5), NORMAL_ROLL));
    const critical = switchModes(full, { critical: true });

    assert.equal(hp(critical), 0);
    assert.equal(critical.record.targets[0].hpLost, 5);

    // Обратно: урон 9 всё ещё больше пяти хитов — возвращать нечего
    const normal = switchModes(critical, { critical: false });

    assert.equal(hp(normal), 0);
  });

  it('сохраняет урон сверх частей записи при смене режима', () => {
    const full = withCritRoll(hit(createTarget(30), NORMAL_ROLL));

    // Сводка заклинания записала 12: три — доп. урон наложенного эффекта
    full.record.targets[0].totals = { normal: 12 };

    const critical = switchModes(full, { critical: true });

    assert.deepEqual(critical.record.targets[0].totals, {
      normal: 12,
      critical: 19,
    });
  });
});

describe('повторный урон в режимах', () => {
  it('перебрасывает с удвоенными костями, пока стоит крит', () => {
    const { record } = hit(createTarget(30), CRITICAL_ROLL, { critical: true });
    const plan = engine.planDamageReroll(record, record.parts[0]);

    assert.deepEqual(plan, { formula: '4d6+3', critical: true });

    const part = engine.withRerolledDamage(record.parts[0], plan, {
      total: 15,
      values: [1, 2, 3, 6],
    });

    assert.equal(part.roll.total, 6);
    assert.equal(part.roll.critTotal, 9);

    // Крит снят кнопкой — бросается формула без костей крита
    assert.deepEqual(
      engine.planDamageReroll({ critical: false }, record.parts[0]),
      { formula: '2d6+3', critical: false },
    );
  });

  it('наносит половину, если она стоит в записи', () => {
    const target = createTarget(30);
    const { record } = hit(target, NORMAL_ROLL);

    const applied = engine.applyRecordedDamage(
      target,
      { ...record, half: true },
      record.targets[0],
      [11],
    );

    assert.equal(applied.total, 11);
    assert.equal(applied.damage, 5);
    assert.equal(applied.hpAfter, 25);
  });
});
