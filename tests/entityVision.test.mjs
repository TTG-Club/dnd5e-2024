import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  change,
  createActor,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Зрение сущности по правилам D&D — ответ хуку сцены `resolveEntityVision`:
 * тёмное зрение от эффектов, предметов и умений поверх настроек токена.
 */

/** «Аспект диких земель: Сова» — +60 фт тёмного зрения */
function owl() {
  return createEffect('Аспект: Сова', {
    changes: [change('sense.darkvision', '60')],
  });
}

/**
 * Кольцо тёмного зрения, требующее настройки.
 *
 * @param {object} overrides - надето, настроено
 * @returns {object} предмет
 */
function ring(overrides) {
  return {
    id: 'ring',
    name: 'Кольцо тёмного зрения',
    type: 'equipment',
    magicAttunement: 'required',
    activeEffects: [owl()],
    ...overrides,
  };
}

describe('зрение сущности для сцены', () => {
  it('без блока зрения и эффектов правила ничего не меняют', () => {
    assert.equal(engine.resolveEntityVision(createActor()), undefined);
  });

  it('«Сова» даёт тёмное зрение токену без настроек зрения', () => {
    assert.deepEqual(
      engine.resolveEntityVision(createActor({ activeEffects: [owl()] })),
      { darkvisionUnits: 60 },
    );
  });

  it('«Сова» поверх тёмного зрения вида: дальность растёт на 60', () => {
    const elf = createActor({
      token: {
        vision: { enabled: true, range: 60, darkvision: 60, angle: 360 },
      },
      activeEffects: [owl()],
    });

    assert.deepEqual(engine.resolveEntityVision(elf), { darkvisionUnits: 120 });
  });

  it('выключенное зрение эффект включает', () => {
    const blindfolded = createActor({
      token: {
        vision: { enabled: false, range: 60, darkvision: 0, angle: 360 },
      },
      activeEffects: [owl()],
    });

    assert.deepEqual(engine.resolveEntityVision(blindfolded), {
      darkvisionUnits: 60,
      enabled: true,
    });
  });

  it('кольцо работает надетым и настроенным', () => {
    const wearer = (item) => createActor({ equipment: [item] });

    assert.equal(
      engine.resolveEntityVision(wearer(ring({ equipped: true }))),
      undefined,
      'надето, но не настроено — не работает',
    );

    assert.deepEqual(
      engine.resolveEntityVision(
        wearer(ring({ equipped: true, isAttuned: true })),
      ),
      { darkvisionUnits: 60 },
    );

    assert.equal(
      engine.resolveEntityVision(
        wearer(ring({ equipped: false, isAttuned: true })),
      ),
      undefined,
      'снятое кольцо не работает',
    );
  });

  it('ответ кэшируется по объекту сущности', () => {
    const actor = createActor({ activeEffects: [owl()] });

    assert.equal(
      engine.resolveEntityVision(actor),
      engine.resolveEntityVision(actor),
    );
  });

  it('хук системы отвечает за сущность D&D', () => {
    const system = new engine.Dnd5eVttSystem();

    assert.deepEqual(
      system.resolveEntityVision(createActor({ activeEffects: [owl()] })),
      { darkvisionUnits: 60 },
    );
  });
});
