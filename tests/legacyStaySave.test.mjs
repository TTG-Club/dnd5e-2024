import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  allCreaturesAura,
  createCreature,
  createEffect,
  createRequestRoll,
  createZone,
  engine,
  MAX_ROLL,
  MIN_ROLL,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Старые эффекты зоны и ауры «пока внутри» со спасброском: прежнее окно
 * позволяло собрать такую пару, и эффект ложился без броска. Теперь он
 * срабатывает на входе.
 */

/** Сл старого эффекта */
const LEGACY_DC = 12;

/** Идентификатор зоны */
const ZONE_ID = 'ca_legacy';

/**
 * Старый эффект «пока внутри» со спасброском: момента срабатывания нет.
 *
 * @param {object} overrides - доставка, аура
 * @returns {object} эффект
 */
function legacyStaySave(overrides = {}) {
  return createEffect('Старое болото', {
    conditionKey: 'poisoned',
    applySave: { ability: 'constitution', dc: LEGACY_DC, onSuccess: 'negate' },
    ...overrides,
  });
}

/**
 * Синхронизация «сущность вошла в зону».
 *
 * @param {object} entity - сущность
 * @param {object[]} zones - зоны сцены
 * @param {object} options - запрос броска
 * @returns {object} результат
 */
function enter(entity, zones, options = {}) {
  return engine.syncActorAreaEffects(
    entity,
    new Set(),
    new Set(zones.map((zone) => zone.id)),
    zones,
    options,
  );
}

/**
 * Висит ли на сущности отравление.
 *
 * @param {object} entity - сущность
 * @returns {boolean} `true`, если висит
 */
function isPoisoned(entity) {
  return entity.activeEffects.some(
    (effect) => effect.conditionKey === 'poisoned',
  );
}

describe('старый «пока внутри» со спасброском', () => {
  it('переводится во вход, остальные эффекты не трогает', () => {
    const legacy = legacyStaySave();

    assert.equal(engine.upgradeStaySaveEffect(legacy).areaTrigger, 'enter');

    const plainStay = createEffect('Трясина');

    assert.equal(engine.upgradeStaySaveEffect(plainStay), plainStay);

    const onExit = legacyStaySave({ areaTrigger: 'exit' });

    assert.equal(engine.upgradeStaySaveEffect(onExit), onExit);
  });

  it('зона: провал спасброска — эффект есть, успех — нет', () => {
    const failed = createCreature();

    withRandom([MIN_ROLL], () =>
      enter(failed, [createZone(ZONE_ID, [legacyStaySave()])], {
        requestRoll: createRequestRoll().requestRoll,
      }),
    );

    assert.ok(isPoisoned(failed), 'провал — отравлен');

    const passed = createCreature();

    const result = withRandom([MAX_ROLL], () =>
      enter(passed, [createZone(ZONE_ID, [legacyStaySave()])], {
        requestRoll: createRequestRoll().requestRoll,
      }),
    );

    assert.equal(result.saveOutcomes[0].passed, true);
    assert.equal(isPoisoned(passed), false, 'успех — без эффекта');
  });

  it('зона: копия «пока внутри», повешенная раньше без броска, снимается', () => {
    const legacy = legacyStaySave();

    const stale = {
      ...legacy,
      id: 'effect_stale',
      origin: 'area',
      originId: ZONE_ID,
    };

    const orc = createCreature({ activeEffects: [stale] });

    const result = engine.syncActorAreaEffects(
      orc,
      new Set([ZONE_ID]),
      new Set([ZONE_ID]),
      [createZone(ZONE_ID, [legacy])],
      { triggerOneShots: false },
    );

    assert.equal(result.changed, true);
    assert.deepEqual(orc.activeEffects, []);
  });

  it('аура: источник отдаёт её разовой на входе, а не постоянной', () => {
    const lich = createCreature({
      activeEffects: [legacyStaySave({ aura: allCreaturesAura(10) })],
    });

    const [aura] = engine.collectAllAuraEffects(lich);

    assert.equal(aura.areaTrigger, 'enter');
    assert.equal(engine.isTriggerAura(aura), true);
  });

  it('окно открывает зону и ауру уже «при входе», эффект на цели — как был', () => {
    const zoneDraft = engine.upgradeEffectDraft(legacyStaySave(), 'zone');

    assert.equal(zoneDraft.areaTrigger, 'enter');

    const layout = engine.resolveEffectFormLayout('zone', zoneDraft);

    assert.equal(layout.showSave, true);

    const onTarget = legacyStaySave({ effectTarget: 'target' });

    assert.equal(engine.upgradeEffectDraft(onTarget, 'spell'), onTarget);
  });
});
