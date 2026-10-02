import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';
import { createActor, engine } from './scenarios/_fixtures.mjs';

/**
 * Ресурс, который набирают действием, а не получают с умением и не возвращают
 * отдыхом. «Очки мутации» друида круга мутации появляются от потраченной
 * ячейки: у нового персонажа их ноль, и отдых их не восполняет. Раньше система
 * читала у определения только откат одним словом (продолжительный отдых у него
 * возвращает всё всегда) и заводила счётчик полным — 10 из 10.
 */

/** «Отдых ничего не возвращает» */
const NONE = { mode: 'none', amount: 1 };

/** Запись «Очков мутации», как её отдаёт выгрузка сайта */
const MUTATION_POINTS = {
  key: 'mutation-points',
  name: 'Очки мутации',
  max: '10',
  recovery: 'long',
  shortRest: NONE,
  longRest: NONE,
  startsEmpty: true,
};

/** Обычный ресурс: одно слово отката, новых полей нет */
const LUCK = { key: 'luck', name: 'Очки удачи', max: '3', recovery: 'long' };

describe('отдых ресурса из определения', () => {
  it('раздельные правила едут на счётчик вместе со словом отката', () => {
    const rest = engine.counterDefinitionRest(MUTATION_POINTS);

    assert.deepEqual(rest, {
      recovery: 'long',
      shortRest: NONE,
      longRest: NONE,
    });

    assert.deepEqual(engine.getCounterRecoveryRules(rest), {
      shortRest: NONE,
      longRest: NONE,
    });
  });

  it('определение без правил читается как раньше — одним словом', () => {
    const rest = engine.counterDefinitionRest(LUCK);

    assert.deepEqual(rest, { recovery: 'long' });
    assert.equal(engine.getCounterRecoveryRules(rest).longRest.mode, 'all');
    assert.equal(engine.getCounterRecoveryRules(rest).shortRest.mode, 'none');
  });

  it('правило с незнакомым режимом не читается, число зарядов — не меньше одного', () => {
    assert.deepEqual(
      engine.counterDefinitionRest({
        recovery: 'short',
        shortRest: { mode: 'NONE', amount: 1 },
        longRest: { mode: 'amount', amount: 0 },
      }),
      { recovery: 'short', longRest: { mode: 'amount', amount: 1 } },
    );
  });
});

describe('первое значение ресурса', () => {
  it('«появляется пустым» — ноль, без поля — полный, как раньше', () => {
    assert.equal(engine.initialCounterCurrent(MUTATION_POINTS, 10), 0);
    assert.equal(engine.initialCounterCurrent(LUCK, 3), 3);
    assert.equal(engine.initialCounterCurrent({ startsEmpty: false }, 3), 3);
  });

  it('ресурс записи заводится пустым и не возвращается отдыхом', () => {
    const actor = createActor({ id: 'actor_druid' });

    const feat = {
      id: 'feature_mutation',
      featData: { counters: [MUTATION_POINTS, LUCK] },
    };

    const [points, luck] = engine.buildFeatCounters(feat, actor);

    assert.equal(points.current, 0);
    assert.equal(points.max, 10);
    assert.equal(luck.current, 3, 'обычный ресурс приходит полным');

    // Набранное действием пересчёт не трогает и не восполняет
    const [kept] = engine.buildFeatCounters(feat, actor, [
      { ...points, current: 4 },
    ]);

    assert.equal(kept.current, 4);

    actor.system.classCounters = [
      { ...points, current: 4 },
      { ...luck, current: 0 },
    ];

    const rested = engine.applyActorRest(actor, 'long').system.classCounters;

    assert.equal(rested[0].current, 4, 'отдых «Очки мутации» не возвращает');
    assert.equal(rested[1].current, 3, 'обычный ресурс отдых возвращает');
  });
});

describe('откат ресурса в форме мастерской', () => {
  it('«отдых не восстанавливает» — отдельный выбор и раздельные правила в записи', () => {
    assert.deepEqual(engine.readCounterRecoveryForm(MUTATION_POINTS), {
      choice: 'none',
    });

    assert.deepEqual(engine.buildCounterRecoveryForm({ choice: 'none' }), {
      recovery: 'long',
      shortRest: NONE,
      longRest: NONE,
    });
  });

  it('слово отката без правил возвращается в запись прежним — без новых полей', () => {
    assert.deepEqual(engine.readCounterRecoveryForm(LUCK), { choice: 'long' });

    assert.deepEqual(engine.buildCounterRecoveryForm({ choice: 'short-one' }), {
      recovery: 'short-one',
    });
  });

  it('правила, которые выбором не сказать, форма несёт как есть', () => {
    const custom = {
      recovery: 'short-one',
      shortRest: { mode: 'amount', amount: 2 },
      longRest: { mode: 'all', amount: 1 },
    };

    const form = engine.readCounterRecoveryForm(custom);

    assert.equal(form.choice, 'short-one');
    assert.deepEqual(engine.buildCounterRecoveryForm(form), custom);
  });
});

it('мастер класса заводит счётчик по тем же правилам определения', () => {
  const wizard = readFileSync(
    join(systemRoot, 'src/client/ui/actor/class/wizard/useClassWizard.ts'),
    'utf8',
  );

  assert.match(
    wizard,
    /current: initialCounterCurrent\(counterDef, maxValue\)/u,
  );

  assert.match(wizard, /\.\.\.counterDefinitionRest\(counterDef\)/u);
});
