import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createActor, createEffect, engine } from './scenarios/_fixtures.mjs';

/**
 * Круг ячейки каста — токен `@castLevel`: число ставит каст
 * (`bindSourceEffectFormulas` с `castLevel` в контексте), и дальше оно живёт в
 * эффекте. Общий обход формул — `effectTokenBinding.ts`.
 */

/**
 * Контекст каста заклинателя.
 *
 * @param {number} castLevel - круг ячейки
 * @returns {object} контекст формул
 */
function castContext(castLevel) {
  return { ...engine.buildFormulaContext(createActor()), castLevel };
}

describe('@castLevel: подстановка при касте', () => {
  it('урон срабатывания зоны: число костей по кругу («Лунный луч»)', () => {
    const moonbeam = createEffect('Лунный луч', {
      triggers: [
        {
          id: 'beam',
          event: 'turnStart',
          save: { ability: 'constitution', dc: 0 },
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '(@castLevel)к10@dmg.radiant' }],
              halfOnSave: true,
            },
          ],
        },
      ],
    });

    const bound = engine.bindSourceEffectFormulas(moonbeam, castContext(4));

    assert.equal(
      bound.triggers[0].actions[0].parts[0].formula,
      '4к10@dmg.radiant',
    );
  });

  it('модификатор цели тоже получает круг, хотя числа цели остаются её («Подмога»)', () => {
    const aid = createEffect('Подмога', {
      effectTarget: 'target',
      changes: [
        {
          key: 'hitPoints.max',
          mode: 'add',
          value: '5 * (@castLevel - 1)',
          priority: 20,
        },
        { key: 'armorClass', mode: 'add', value: '@mod.dex', priority: 20 },
      ],
    });

    const [bound] = engine.bindTargetEffectsToSource(
      [aid],
      createActor(),
      castContext(4),
    );

    assert.equal(bound.changes[0].value, '5 * (4 - 1)');
    assert.equal(bound.changes[1].value, '@mod.dex', 'Ловкость — цели');

    const target = createActor({ id: 'actor_target', activeEffects: [bound] });

    assert.equal(
      engine.resolveActorStats(target).hitPointsMax
        - engine.resolveActorStats(createActor({ id: 'actor_target' }))
          .hitPointsMax,
      15,
    );
  });

  it('временные хиты, радиус ауры, срок и Сл — тоже', () => {
    const effect = createEffect('Всё сразу', {
      aura: { radius: 10, radiusFormula: '10 * @castLevel', target: 'all' },
      durationFormula: '@castLevel',
      applySave: {
        ability: 'wisdom',
        dc: 10,
        dcFormula: '10 + @castLevel',
        onSuccess: 'negate',
      },
      triggers: [
        {
          id: 'hp',
          event: 'applied',
          actions: [{ type: 'tempHp', amount: '5 * @castLevel' }],
        },
      ],
    });

    const bound = engine.bindSourceEffectFormulas(effect, castContext(3));

    assert.equal(bound.aura.radiusFormula, '10 * 3');
    assert.equal(bound.durationFormula, '3');
    assert.equal(bound.applySave.dc, 13);
    assert.equal(bound.triggers[0].actions[0].amount, '5 * 3');
  });

  it('без каста токен остаётся, а сам по себе — ошибка формулы', () => {
    const effect = createEffect('Без каста', {
      changes: [
        { key: 'armorClass', mode: 'add', value: '@castLevel', priority: 20 },
      ],
    });

    assert.equal(
      engine.bindSourceEffectFormulas(
        effect,
        engine.buildFormulaContext(createActor()),
      ).changes[0].value,
      '@castLevel',
    );

    assert.throws(() =>
      engine.evaluateFormula(
        '@castLevel',
        engine.buildFormulaContext(createActor()),
      ),
    );

    assert.equal(engine.evaluateFormula('@castLevel + 1', castContext(5)), 6);
  });

  it('подсказка формулы знает токен', () => {
    assert.deepEqual(
      engine.previewDamagePart({ formula: '(@castLevel)к10' }).unknownTokens,
      [],
    );
  });
});
