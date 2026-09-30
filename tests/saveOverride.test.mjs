import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * «Провал спасброска — вместо этого успех» за ресурс (`saveOverride.ts`):
 * откуда берётся возможность, сколько осталось, как списывается и когда
 * восстанавливается.
 */

/**
 * Босс с «Легендарным сопротивлением (3/день)» числом у черты.
 *
 * @param {number} perDay - раз в день
 * @returns {object} существо
 */
function boss(perDay = 3) {
  const creature = createCreature({ id: 'creature_aboleth', name: 'Аболет' });

  creature.system.traits = [
    {
      name: 'Легендарное сопротивление',
      description: [],
      saveSuccessPerDay: perDay,
    },
  ];

  return creature;
}

/**
 * Сущность с полями после траты.
 *
 * @param {object} entity - носитель
 * @param {object} source - возможность
 * @returns {object} носитель после траты
 */
function spent(entity, source) {
  return {
    ...entity,
    system: {
      ...entity.system,
      ...engine.spendSaveOverride(entity, source),
    },
  };
}

describe('провал в успех: число у черты существа', () => {
  it('три раза в день, затем платить нечем', () => {
    let creature = boss();

    for (const remaining of [3, 2, 1]) {
      const available = engine.findSaveOverride(creature);

      assert.equal(available.remaining, remaining);
      assert.equal(available.source.label, 'Легендарное сопротивление');

      creature = spent(creature, available.source);
    }

    assert.equal(engine.findSaveOverride(creature), null);
  });

  it('долгий отдых возвращает счёт, короткий — нет', () => {
    const creature = boss(1);
    const { source } = engine.findSaveOverride(creature);
    const exhausted = spent(creature, source);

    const afterShort = {
      ...exhausted,
      system: {
        ...exhausted.system,
        effectUsage: engine.pruneTriggerUsage(
          exhausted,
          engine.restLimitPeriodsOf('short'),
        ),
      },
    };

    assert.equal(engine.findSaveOverride(afterShort), null);

    const afterLong = {
      ...exhausted,
      system: {
        ...exhausted.system,
        effectUsage: engine.pruneTriggerUsage(
          exhausted,
          engine.restLimitPeriodsOf('long'),
        ),
      },
    };

    assert.equal(engine.findSaveOverride(afterLong).remaining, 1);
  });

  it('трата не меняет саму сущность — только отдаёт поля для патча', () => {
    const creature = boss();
    const { source } = engine.findSaveOverride(creature);

    engine.spendSaveOverride(creature, source);

    assert.equal(creature.system.effectUsage, undefined);
  });
});

describe('провал в успех: поле эффекта', () => {
  it('своим счётчиком — у эффекта листа игрока', () => {
    const boon = createEffect('Дар удачи', {
      saveOverride: { limit: { max: 1, per: 'shortRest' } },
    });

    const hero = createActor({ activeEffects: [boon] });
    const { source, remaining } = engine.findSaveOverride(hero);

    assert.equal(remaining, 1);
    assert.equal(engine.findSaveOverride(spent(hero, source)), null);
  });

  it('ресурсом листа — тратится ресурс, свой счётчик не ведётся', () => {
    const luck = createEffect('Удачливый', {
      saveOverride: { counter: 'luck' },
    });

    const hero = createActor({ activeEffects: [luck] });

    hero.system.classCounters = [
      { counterKey: 'luck', current: 2, max: 3, recovery: 'longRest' },
    ];

    const { source, remaining } = engine.findSaveOverride(hero);

    assert.equal(remaining, 2);

    const after = spent(hero, source);

    assert.equal(after.system.classCounters[0].current, 1);
    assert.equal(after.system.effectUsage, hero.system.effectUsage);
  });

  it('выключенный эффект возможности не даёт', () => {
    const hero = createActor({
      activeEffects: [
        createEffect('Дар удачи', {
          disabled: true,
          saveOverride: { limit: { max: 1, per: 'longRest' } },
        }),
      ],
    });

    assert.equal(engine.findSaveOverride(hero), null);
  });

  it('схема: блок без счётчика и ресурса отбрасывается', () => {
    const parse = (saveOverride) =>
      engine.ActiveEffectSchema.parse(createEffect('Эффект', { saveOverride }))
        .saveOverride;

    assert.deepEqual(parse({ limit: { max: 3, per: 'longRest' } }), {
      limit: { max: 3, per: 'longRest' },
    });

    assert.equal(parse({}), undefined);
    assert.equal(parse({ limit: { max: 0, per: 'longRest' } }), undefined);
  });

  it('сводка и вопрос называют возможность словами', () => {
    assert.equal(
      engine.describeSaveOverride({ limit: { max: 3, per: 'longRest' } }),
      'провал спасброска — вместо этого успех, 3 раза до долгого отдыха',
    );

    assert.equal(
      engine.formatSaveOverrideQuestion(
        'Аболет',
        'wisdom',
        'Легендарное сопротивление',
      ),
      'Аболет проваливает спасбросок Мудрости. Легендарное сопротивление: преуспеть вместо провала?',
    );
  });

  it('окно: поле работает на носителе и не работает у эффекта «на цели»', () => {
    const effect = createEffect('Легендарное сопротивление', {
      saveOverride: { limit: { max: 3, per: 'longRest' } },
    });

    const onTrait = engine.resolveEffectFormLayout('creatureTrait', effect);

    assert.deepEqual(engine.listInertEffectFields(effect, onTrait), []);

    const onTarget = { ...effect, effectTarget: 'target' };

    assert.ok(
      engine
        .listInertEffectFields(
          onTarget,
          engine.resolveEffectFormLayout('weapon', onTarget),
        )
        .includes('saveOverride'),
    );
  });
});

describe('провал в успех: броски сервера', () => {
  it('существо с авто-спасбросками и ресурсом бросает запросом владельцу', () => {
    const requestRoll = () => Promise.resolve({ status: 'noRecipient' });
    const creature = boss();

    creature.autoSaves = true;

    assert.equal(engine.shouldRequestEffectSave(creature, requestRoll), true);

    const plain = createCreature({ id: 'creature_goblin' });

    plain.autoSaves = true;

    assert.equal(
      engine.shouldRequestEffectSave(plain, requestRoll),
      false,
      'без ресурса сервер бросает сам, как раньше',
    );

    assert.equal(engine.shouldRequestEffectSave(creature, undefined), false);
  });
});
