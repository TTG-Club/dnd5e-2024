import assert from 'node:assert/strict';

import { it } from 'vitest';

import { createActor, createEffect, engine } from './scenarios/_fixtures.mjs';

/**
 * Свет от эффекта (`entityLight.ts`): сильнейший, данные и кэш.
 */

it('сильнейший свет — по дальнему краю, при равенстве по яркому', () => {
  const wide = { bright: 10, dim: 30 };
  const bright = { bright: 20, dim: 20 };
  const small = { bright: 5, dim: 5 };

  assert.equal(engine.pickStrongestEffectLight([small, wide, bright]), bright);
  assert.equal(engine.pickStrongestEffectLight([]), undefined);
});

it('анимация и цвет доходят до излучателя, «ровный» не пишется', () => {
  assert.deepEqual(
    engine.toEntityLight({ bright: 5, dim: 0, animation: 'torch' }).animation,
    { type: 'torch', speed: 1, intensity: 0.3 },
  );

  assert.equal(
    engine.toEntityLight({ bright: 5, dim: 0, animation: 'none' }).animation,
    undefined,
  );
});

it('схема: свет без радиуса отбрасывается, негодный цвет — белый', () => {
  const parse = (light) =>
    engine.ActiveEffectSchema.parse(createEffect('Свет', { light })).light;

  assert.equal(parse({ bright: 0, dim: 0 }), undefined);

  assert.equal(parse({ bright: 10, dim: 10, color: 'red' }).color, undefined);
});

it('ответ считается по объекту сущности один раз', () => {
  const hero = createActor({
    activeEffects: [createEffect('Свет', { light: { bright: 20, dim: 20 } })],
  });

  assert.equal(
    engine.resolveEntityLight(hero),
    engine.resolveEntityLight(hero),
  );
});
