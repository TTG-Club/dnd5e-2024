import assert from 'node:assert/strict';

import { it } from 'vitest';

import {
  createActor,
  createEffect,
  engine,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Спасбросок против того, кто его вызвал (`saveSourceConditions.ts`):
 * эффект с условием `source.creatureType` включается только в спасброске от
 * существа нужного типа — на клиенте, в запросе и на сервере.
 */

/** «Защита от зла и добра»: преимущество и +1 к спасброскам от исчадий и нежити */
const WARD = createEffect('Защита от зла и добра', {
  flags: ['save.advantage'],
  changes: [{ key: 'save.wisdom', mode: 'add', value: '1', priority: 20 }],
  rollCondition: 'source.creatureType === "fiend, undead"',
});

it('условие об источнике: флаги и прибавка только от нужного типа', () => {
  const byFiend = engine.resolveSaveSourceAdjustments([WARD], 'wisdom', {
    sourceCreatureType: 'fiend',
  });

  assert.deepEqual(byFiend, { flags: ['save.advantage'], bonus: 1 });

  assert.deepEqual(
    engine.resolveSaveSourceAdjustments([WARD], 'wisdom', {
      sourceCreatureType: 'beast',
    }),
    { flags: [], bonus: 0 },
  );

  assert.deepEqual(
    engine.resolveSaveSourceAdjustments([WARD], 'wisdom', {}),
    { flags: [], bonus: 0 },
    'источник неизвестен — ничего',
  );
});

it('на листе такой эффект не действует', () => {
  const hero = createActor({ activeEffects: [WARD] });

  assert.equal(
    engine.resolveActorStats(hero).activeFlags.has('save.advantage'),
    false,
  );
});

it('сервер: спасбросок эффекта, наложенного исчадием, — с преимуществом', () => {
  const hero = createActor({ activeEffects: [WARD] });
  const context = engine.buildEffectSavingThrowContext(hero);
  const stats = engine.resolveActorStats(hero);

  // Первая кость 1, вторая 20: с преимуществом берётся 20
  const roll = (sourceCreatureType) =>
    withRandom([0, 0.999], () =>
      engine.rollEffectSavingThrow('wisdom', 15, stats, context, {
        againstMagic: true,
        sourceCreatureType,
      }),
    );

  assert.equal(roll('fiend').roll, 20);
  assert.equal(roll('beast').roll, 1);
});

it('тип наложившего едет в спецификации и в нагрузке запроса', () => {
  const hold = createEffect('Удержание', {
    sourceCreatureType: 'fiend',
    applySave: { ability: 'wisdom', dc: 14, onSuccess: 'negate' },
  });

  const spec = engine.buildApplySaveSpec(hold, hold.applySave);

  assert.equal(spec.sourceCreatureType, 'fiend');

  const request = engine.buildEffectSaveRollRequest(
    createActor(),
    spec,
    'Зона',
  );

  assert.equal(
    engine.parseSavingThrowRequestPayload(request.payload).sourceCreatureType,
    'fiend',
  );

  assert.equal(
    engine.ActiveEffectSchema.parse({
      ...hold,
      sourceCreatureType: 'dragonkin',
    }).sourceCreatureType,
    undefined,
    'незнакомый тип отбрасывается',
  );
});
