import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from '../helpers/engineBundle.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  MIN_ROLL,
  strikeEntity,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: получатели и отбор (`docs/EFFECT_SCENARIOS.md`, раздел
 * «Получатели»).
 *
 * Четвёртая ось срабатывания — кому достанутся действия. Правило раздела:
 * умолчание не меняется, а новый вид отбора всегда отдельное значение —
 * прежние карточки «всем в радиусе» не должны начать задевать носителя.
 */

/** Кто наложил эффект в сценариях раздела */
const CASTER_ID = 'actor_caster';

/**
 * Сцена вокруг субъекта из списка соседей.
 *
 * @param {object} subject - субъект
 * @param {object[]} neighbors - соседи с расстоянием в клетках
 * @returns {object} сцена
 */
function sceneAround(subject, neighbors) {
  return {
    token: createToken(subject.id, 0, 0),
    gridSettings: GRID,
    neighbors: neighbors.map(({ entity, cells }) => ({
      token: createToken(entity.id, cells, 0),
      entity,
    })),
  };
}

describe('каталог: получатели и отбор', () => {
  it('[R01] Маяк надежды: «союзников и носителя» задевает и его', () => {
    const cleric = createActor({ id: 'actor_cleric' });
    const ally = createActor({ id: 'actor_ally' });
    const foe = createCreature({ id: 'creature_foe' });

    cleric.token = { ...cleric.token, disposition: 'friendly' };
    ally.token = { ...ally.token, disposition: 'friendly' };
    foe.token = { ...foe.token, disposition: 'hostile' };

    const surroundings = sceneAround(cleric, [
      { entity: ally, cells: 2 },
      { entity: foe, cells: 3 },
    ]);

    const pick = (target) =>
      engine
        .findEntitiesInArea(surroundings, { radius: 30, target }, cleric)
        .map((entity) => entity.id)
        .sort();

    assert.deepEqual(pick('allies'), [ally.id], 'умолчание осталось прежним');

    assert.deepEqual(
      pick('alliesWithSelf'),
      [ally.id, cleric.id].sort(),
      'носитель добавлен системой: ядро отдаёт соседей без него',
    );

    assert.deepEqual(
      pick('allWithSelf'),
      [ally.id, cleric.id, foe.id].sort(),
      '«всех и носителя» отношения не разбирает',
    );

    assert.deepEqual(
      pick('all'),
      [ally.id, foe.id].sort(),
      'прежние карточки «всем в радиусе» носителя не задевают',
    );
  });

  it('[R02] Свой носитель попадает в список один раз', () => {
    const cleric = createActor({ id: 'actor_cleric' });

    // Ядро иногда отдаёт самого субъекта среди соседей (у него две фишки)
    const surroundings = sceneAround(cleric, [{ entity: cleric, cells: 1 }]);

    assert.deepEqual(
      engine
        .findEntitiesInArea(
          surroundings,
          { radius: 30, target: 'allWithSelf' },
          cleric,
        )
        .map((entity) => entity.id),
      [cleric.id],
    );
  });

  it('[R03] Сводка называет новый отбор', () => {
    const beacon = createEffect('Маяк надежды', {
      triggers: [
        {
          id: 'trigger_beacon',
          event: 'damageTaken',
          recipient: 'area',
          area: { radius: 30, target: 'alliesWithSelf' },
          actions: [{ type: 'damage', parts: [{ formula: '@heal 5' }] }],
        },
      ],
    });

    assert.match(
      engine.describeEffectScenario(beacon, 'spell'),
      /союзников и себя/,
    );
  });

  it('[R04] Прикосновение вампира: получатель «наложивший»', () => {
    const drain = createEffect('Прикосновение вампира', {
      triggers: [
        {
          id: 'trigger_drain',
          event: 'damageTaken',
          recipient: 'source',
          actions: [{ type: 'tempHp', amount: '5' }],
        },
      ],
    });

    const system = new engine.Dnd5eVttSystem();
    const caster = withHp(createActor, 30, { id: CASTER_ID });
    const victim = withHp(createCreature, 30, { id: 'creature_victim' });

    victim.activeEffects = [{ ...drain, sourceActorId: CASTER_ID }];

    withRandom([MIN_ROLL], () =>
      strikeEntity(system, victim, 5, 'necrotic', {
        details: { critical: false, sourceId: CASTER_ID },
        context: { getEntity: (id) => (id === CASTER_ID ? caster : undefined) },
      }),
    );

    assert.equal(
      engine.resolveEntityTempHp(caster),
      5,
      'временные хиты достались наложившему, а не носителю',
    );

    assert.equal(engine.resolveEntityTempHp(victim), 0);
  });

  it('[R05] Наложившего нет — срабатывание молчит', () => {
    const drain = createEffect('Прикосновение из компендиума', {
      triggers: [
        {
          id: 'trigger_drain',
          event: 'damageTaken',
          recipient: 'source',
          actions: [{ type: 'tempHp', amount: '5' }],
        },
      ],
    });

    const system = new engine.Dnd5eVttSystem();
    const victim = withHp(createCreature, 30, { id: 'creature_victim' });

    victim.activeEffects = [drain];

    withRandom([MIN_ROLL], () =>
      strikeEntity(system, victim, 5, 'necrotic', { context: {} }),
    );

    assert.equal(
      engine.resolveEntityTempHp(victim),
      0,
      'неизвестного наложившего движок не подменяет носителем',
    );
  });

  it('[R06] «Наложившему» предлагается только там, где движок его ищет', () => {
    const served = engine.triggerEventAcceptsSource('damageTaken');
    const notServed = engine.triggerEventAcceptsSource('turnStart');

    assert.equal(served, true, 'событие урона выполняет сервер со сценой');

    assert.equal(
      notServed,
      false,
      'на границе хода действия идут прямо на носителя',
    );
  });

  it('[R07] Больше двадцати выбранных целей', async () => {
    assert.ok(
      engine.MAX_TRIGGER_CHOICE_COUNT > 20,
      'потолок выбора больше не двадцать',
    );

    const { CHOICE_SEARCH_THRESHOLD } = await loadEngineBundle(
      "export { CHOICE_SEARCH_THRESHOLD } from './src/client/ui/effect/constants.ts';",
    );

    assert.ok(
      CHOICE_SEARCH_THRESHOLD > 0,
      'плашка выбора знает, с какого числа показывать поиск',
    );

    const crowd = createCreature({ id: 'creature_hub' });

    const others = Array.from({ length: 25 }, (_, index) =>
      createCreature({ id: `creature_${index}`, name: `Существо ${index}` }),
    );

    const surroundings = sceneAround(
      crowd,
      others.map((entity, index) => ({ entity, cells: (index % 5) + 1 })),
    );

    const candidates = engine.listChoiceCandidates(
      crowd,
      { radius: 60, count: engine.MAX_TRIGGER_CHOICE_COUNT },
      {
        listEntitiesInArea: (subject, area) =>
          engine.findEntitiesInArea(surroundings, area, subject),
      },
    );

    assert.equal(candidates.length, others.length, 'кандидаты не обрезаны');
  });

  // Пробелы: их не выразить, пока выбор при касте собирает только цели
  it.todo('[R08] Именной состав ауры или зоны');
  it.todo('[R09] Свой вариант для каждой цели');
  it.todo('[R10] Смена выбранного варианта');
  it.todo('[R11] Память о прежних целях каста');
});
