import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';

const helperPath = 'src/client/ui/effect/effectFormOptions.ts';

/** Типы длительности с числом единиц */
const COUNTED_TYPES = new Set(['rounds', 'minutes', 'hours', 'days']);

const ports = {
  isCountedDuration: (type) => COUNTED_TYPES.has(type),
};

ports.writeDurationType = await loadHandler(
  helperPath,
  'writeDurationType',
  ports,
);

const writeDurationValue = await loadHandler(
  helperPath,
  'writeDurationValue',
  ports,
);

it('правка числа длительности запускает отсчёт заново', () => {
  const running = {
    type: 'minutes',
    value: 1,
    remaining: 10,
    expiresAt: 1060,
  };

  // Копия — объект из VM другого контекста иначе не равен по прототипу
  assert.deepEqual(
    { ...writeDurationValue(running, 5) },
    {
      type: 'minutes',
      value: 5,
      turnAnchor: undefined,
      turnTiming: undefined,
    },
  );

  assert.equal(running.value, 1, 'исходная длительность не тронута');
});
