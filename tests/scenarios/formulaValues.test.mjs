import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  change,
  createActor,
  createEffect,
  engine,
  MAX_ROLL,
  MIN_ROLL,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: значения формулой (`docs/EFFECT_SCENARIOS.md`, раздел «Значения»).
 *
 * Общее правило у всего раздела одно: формула, которую бросают, бросается ОДИН
 * раз — в момент наложения, — и дальше эффект живёт числом. Иначе конвейер
 * катал бы кость заново при каждом пересчёте листа.
 */

/** Часть урона эффекта */
function damagePart(formula, type = 'thunder') {
  return { formula, type };
}

/**
 * Заряды первого эффекта сущности.
 *
 * @param {object} entity - носитель
 * @returns {object} заряды
 */
function chargesOf(entity) {
  return entity.activeEffects[0].charges;
}

describe('каталог: значения формулой', () => {
  it('[V01] Вибрирующие жидкости: сохранённый бросок один на все тики', () => {
    const shaken = createEffect('Вибрирующие жидкости', {
      savedRoll: '2к6',
      duration: { type: 'rounds', value: 3 },
      changes: [change('armorClass', '-@roll')],
      recurringDamage: {
        damageParts: [damagePart('@roll')],
        timing: 'startOfTurn',
      },
    });

    // 2к6 на максимум — 12
    const applied = withRandom([MAX_ROLL], () =>
      engine.withInitializedDuration(shaken),
    );

    assert.equal(applied.savedRollValue, 12);
    assert.equal(applied.recurringDamage.damageParts[0].formula, '12');

    assert.equal(
      applied.changes[0].value,
      '-12',
      'то же число во всех формулах эффекта',
    );

    const again = withRandom([MIN_ROLL], () =>
      engine.withInitializedDuration(applied),
    );

    assert.equal(
      again.savedRollValue,
      12,
      'повторная подготовка кость не перебрасывает',
    );

    assert.equal(again.recurringDamage.damageParts[0].formula, '12');
  });

  it('[V02] Отрицательный сохранённый бросок не ломает формулу', () => {
    const drain = createEffect('Иссушение', {
      savedRoll: '1к4 - 5',
      changes: [change('hitPoints.max', '@roll')],
    });

    const applied = withRandom([MIN_ROLL], () =>
      engine.withInitializedDuration(drain),
    );

    assert.equal(applied.savedRollValue, -4);

    assert.equal(
      applied.changes[0].value,
      '(-4)',
      'минус в скобках — как у чисел источника',
    );
  });

  it('[V03] Числа заклинателя доходят до сохранённого броска', () => {
    const caster = createActor();

    caster.system.abilities.charisma = 18;

    const context = {
      ...engine.buildFormulaContext(caster),
      spellMod: 4,
    };

    const curse = createEffect('Проклятие', {
      savedRoll: '1к4 + @mod.spell',
      changes: [change('save.wisdom', '-@roll')],
    });

    const bound = engine.bindSourceEffectFormulas(curse, context);

    assert.equal(bound.savedRoll, '1к4 + 4', 'токен источника стал числом');

    const applied = withRandom([MIN_ROLL], () =>
      engine.withInitializedDuration(bound),
    );

    assert.equal(applied.savedRollValue, 5);
    assert.equal(applied.changes[0].value, '-5');
  });

  it('[V04] Замешательство: срок формулой', () => {
    const confusion = createEffect('Замешательство', {
      durationFormula: '1к4',
      duration: { type: 'rounds' },
    });

    const applied = withRandom([MAX_ROLL], () =>
      engine.withInitializedDuration(confusion),
    );

    assert.equal(applied.duration.value, 4);

    assert.equal(
      applied.duration.remaining,
      4,
      'раунды посчитались из брошенного срока',
    );

    const again = withRandom([MIN_ROLL], () =>
      engine.withInitializedDuration(applied),
    );

    assert.equal(again.duration.value, 4, 'срок не перебрасывается');
  });

  it('[V05] Срок формулой в минутах переводится в раунды', () => {
    const blessing = createEffect('Благословение предков', {
      durationFormula: '1 + 1',
      duration: { type: 'minutes' },
    });

    const applied = engine.withInitializedDuration(blessing);

    assert.equal(applied.duration.value, 2);
    assert.equal(applied.duration.remaining, 20, 'минута — десять раундов');
  });

  it('[V06] Несчитаемая формула пропускается целиком', () => {
    const broken = createEffect('Без заклинателя', {
      savedRoll: '1к4 + @mod.spell',
      durationFormula: '@mod.spell',
      duration: { type: 'rounds' },
      changes: [change('armorClass', '@roll')],
    });

    const applied = withRandom([MAX_ROLL], () =>
      engine.withInitializedDuration(broken),
    );

    assert.equal(
      applied.savedRollValue,
      undefined,
      'бросок с неподставленным токеном не считается наполовину',
    );

    assert.equal(
      applied.changes[0].value,
      '@roll',
      'формула осталась как была',
    );

    assert.equal(applied.duration.value, undefined, 'срок тоже не посчитан');
  });

  it('[V07] Эффект без сохранённого броска не трогают', () => {
    const plain = createEffect('Щит веры', {
      duration: { type: 'minutes', value: 10 },
      changes: [change('armorClass', '2')],
    });

    const applied = engine.withInitializedDuration(plain);

    assert.equal(applied.savedRollValue, undefined);
    assert.equal(applied.changes[0].value, '2');
    assert.equal(applied.duration.remaining, 100);
  });

  it('[V08] Огненный щит: заряды эффекта', () => {
    const shield = createEffect('Огненный щит', {
      charges: { max: 2, current: 2 },
      triggers: [
        {
          id: 'trigger_burn',
          event: 'damaged',
          actions: [{ type: 'applyTag', tag: 'burned' }],
        },
      ],
    });

    const hero = withHp(createActor, 30, { activeEffects: [shield] });

    const source = {
      effect: shield,
      trigger: shield.triggers[0],
      ambient: false,
      instance: true,
      scope: shield.id,
    };

    assert.equal(engine.admitTrigger(hero, source), true, 'первый заряд');
    assert.equal(chargesOf(hero).current, 1);

    assert.equal(engine.admitTrigger(hero, source), true, 'второй заряд');
    assert.equal(chargesOf(hero).current, 0);

    assert.equal(
      engine.admitTrigger(hero, source),
      false,
      'зарядов не осталось — срабатывание молчит',
    );
  });

  it('[V09] Последний заряд снимает эффект', () => {
    const spark = createEffect('Искра', {
      charges: { max: 1, current: 1, endsWhenEmpty: true },
      triggers: [
        {
          id: 'trigger_spark',
          event: 'damaged',
          actions: [{ type: 'applyTag', tag: 'sparked' }],
        },
      ],
    });

    const hero = withHp(createActor, 30, { activeEffects: [spark] });

    const source = {
      effect: spark,
      trigger: spark.triggers[0],
      ambient: false,
      instance: true,
      scope: spark.id,
    };

    assert.equal(engine.admitTrigger(hero, source), true);

    assert.deepEqual(
      hero.activeEffects,
      [],
      'эффект снят тем же заходом, а срабатывание доигрывает',
    );
  });

  it('[V10] У ауры и зоны зарядов нет: списывать некуда', () => {
    const aura = createEffect('Аура пламени', {
      charges: { max: 1, current: 0 },
      triggers: [
        {
          id: 'trigger_aura',
          event: 'damaged',
          actions: [{ type: 'applyTag', tag: 'scorched' }],
        },
      ],
    });

    const hero = withHp(createActor, 30, {});

    assert.equal(
      engine.admitTrigger(hero, {
        effect: aura,
        trigger: aura.triggers[0],
        ambient: true,
        instance: false,
        scope: aura.id,
      }),
      true,
      'пустые заряды чужой ауры срабатывание не держат',
    );
  });

  it('[V11] Нарастающая порча: изменение растёт каждый ход, до предела', () => {
    const rot = createEffect('Нарастающая порча', {
      changes: [
        change('abilityCheck', '-1', {
          step: { by: -1, per: 'turn', until: -5 },
        }),
      ],
    });

    const hero = withHp(createActor, 30, { activeEffects: [rot] });

    const modifierAfterTurns = (turns) => {
      for (let turn = 0; turn < turns; turn += 1) {
        engine.processTurnEffects(hero, 'startOfTurn');
      }

      return hero.activeEffects[0].changes[0].value;
    };

    assert.equal(modifierAfterTurns(1), '-2', 'первый ход');
    assert.equal(modifierAfterTurns(2), '-4', 'ещё два хода');

    assert.equal(
      modifierAfterTurns(5),
      '-5',
      'дальше предела не уходит, сколько бы ходов ни прошло',
    );
  });

  it('[V12] Шаг раунда двигается тиком длительностей, а не ходом', () => {
    const swell = createEffect('Нарастающий гул', {
      changes: [change('armorClass', '1', { step: { by: 1, per: 'round' } })],
    });

    const hero = withHp(createActor, 30, { activeEffects: [swell] });

    engine.processTurnEffects(hero, 'startOfTurn');

    assert.equal(
      hero.activeEffects[0].changes[0].value,
      '1',
      'ход шаг раунда не двигает',
    );

    engine.decrementActorEffectDurations(hero);

    assert.equal(hero.activeEffects[0].changes[0].value, '2');
  });

  it('[V13] Шаг не трогает формулу и выключенный эффект', () => {
    const dice = createEffect('Растущая кость', {
      changes: [change('damage.all', '1к6', { step: { by: 1, per: 'turn' } })],
    });

    const off = createEffect('Выключенный', {
      disabled: true,
      changes: [change('armorClass', '1', { step: { by: 1, per: 'turn' } })],
    });

    const hero = withHp(createActor, 30, { activeEffects: [dice, off] });

    engine.processTurnEffects(hero, 'startOfTurn');

    assert.equal(
      hero.activeEffects[0].changes[0].value,
      '1к6',
      'у формулы двигать нечего',
    );

    assert.equal(
      hero.activeEffects[1].changes[0].value,
      '1',
      'выключенный эффект в тишине не досчитывается',
    );
  });

  // Пробелы: этим значениям нужны либо сцена вокруг носителя в момент расчёта,
  // либо событие «удар прошёл» — их этап впереди
  it.todo('[V14] Лимит, общий на весь каст');
  it.todo('[V15] Токен «сколько существ в радиусе»');
  it.todo('[V16] Токен «нанесённый урон»');
  it.todo('[V17] Кости хитов как стоимость каста');
  it.todo('[V18] Апкаст меняет срок и концентрацию');
});
