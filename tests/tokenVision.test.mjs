import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

// Правило «нет блока зрения — зрение включено» живёт в движке одно на всех
const engine = await loadEngineBundle(
  "export * from './src/engine/visionUtils.ts';",
);

/** Умолчания зрения — как в `@/core/tokenConsts` хоста и `ui/actor/constants.ts` */
const PORTS = {
  TOKEN_VISION_RANGE_DEFAULT: 60,
  TOKEN_DARKVISION_DEFAULT: 0,
  TOKEN_VISION_ANGLE_DEFAULT: 360,
  isTokenVisionEnabled: engine.isTokenVisionEnabled,
};

it('нет блока зрения — обычное зрение, как у сцены, а не слепота', async () => {
  const read = await loadHandler(
    'src/client/ui/actor/tokenVision.ts',
    'readTokenVision',
    PORTS,
  );

  assert.deepEqual(
    { ...read(undefined) },
    { enabled: true, range: 60, darkvision: 0, angle: 360 },
    'у фишки без настроек зрение включено',
  );

  assert.deepEqual({ ...read({}) }, { ...read(undefined) });

  assert.equal(
    read({ vision: { enabled: false, range: 30, darkvision: 60, angle: 90 } })
      .enabled,
    false,
    'явное «выключено» остаётся выключенным',
  );
});
