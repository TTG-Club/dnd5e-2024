import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Аура «союзникам» и персонажи без настроенного отношения фишки.
 *
 * Отношение фишки ядро берёт у сущности, затем у фишки, а без настройки
 * считает её враждебной (`withTokenDisposition`). У персонажа, собранного
 * мастером создания, отношения не было: два таких персонажа оказывались
 * «враждебными», то есть союзниками чудовищ из компендиума, а не отряда
 * (живая проверка 03.10, Р1). Нормализация персонажа ставит «дружественный»,
 * когда отношение не задано.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
  export { withTokenDisposition } from '@vtt/shared';
`);

/** Клетка сцены, пикс. */
const CELL_SIZE = 100;

/** Сетка сцены: клетка — 5 футов */
const GRID = { cellSize: CELL_SIZE, scale: 5, units: 'ft' };

/** «Аура защиты» паладина: союзникам в 10 футах */
const PROTECTION_AURA = {
  id: 'aura-of-protection',
  name: 'Аура защиты',
  description: '',
  disabled: false,
  origin: 'feature',
  transfer: false,
  duration: { type: 'permanent' },
  changes: [],
  flags: [],
  aura: { radius: 10, target: 'allies', applyToSelf: true, visible: true },
};

/**
 * Запись персонажа, какой её отдаёт мастер создания: отношение фишки не
 * задано. Нормализуется так же, как ядро нормализует каждую запись.
 *
 * @param {string} id - персонаж
 * @param {object} [token] - настройки фишки
 * @returns {object} персонаж после нормализации
 */
function createWizardActor(id, token = { showName: false }) {
  const actor = {
    ...structuredClone(engine.DEFAULT_ACTOR),
    id,
    name: id,
    token,
    activeEffects: [],
  };

  engine.normalizeActor(actor);

  return actor;
}

/**
 * Существо из компендиума после нормализации.
 *
 * @param {string} id - существо
 * @returns {object} существо
 */
function createCompendiumCreature(id) {
  const creature = {
    ...structuredClone(engine.DEFAULT_CREATURE),
    id,
    name: id,
    token: { showName: false },
    activeEffects: [],
  };

  engine.normalizeCreature(creature);

  return creature;
}

/**
 * Фишка сцены с действующим отношением — такой ядро отдаёт её системе.
 *
 * @param {object} entity - сущность фишки
 * @param {number} column - столбец клетки
 * @returns {object} фишка
 */
function sceneToken(entity, column) {
  return engine.withTokenDisposition(
    {
      id: `token_${entity.id}`,
      actorId: entity.id,
      x: column * CELL_SIZE,
      y: 0,
      scale: 1,
    },
    entity,
  );
}

/**
 * Названия аур носителя, достающих до цели.
 *
 * @param {object} bearer - носитель ауры
 * @param {object} target - цель рядом с ним
 * @returns {string[]} названия
 */
function aurasOn(bearer, target) {
  return engine
    .calculateAmbientAuras(
      sceneToken(target, 1),
      [{ token: sceneToken(bearer, 0), effects: [PROTECTION_AURA] }],
      GRID,
    )
    .map((effect) => effect.name);
}

describe('аура «союзникам» без настройки фишки', () => {
  it('персонаж без отношения после нормализации — дружественный', () => {
    assert.equal(createWizardActor('paladin').token.disposition, 'friendly');

    // Персонаж вовсе без настроек фишки
    const bare = { ...structuredClone(engine.DEFAULT_ACTOR), id: 'bare' };

    delete bare.token;
    engine.normalizeActor(bare);

    assert.equal(bare.token.disposition, 'friendly');
  });

  it('два персонажа без отношения — аура одного действует на другого', () => {
    assert.deepEqual(
      aurasOn(createWizardActor('paladin'), createWizardActor('druid')),
      [PROTECTION_AURA.name],
    );
  });

  it('враждебное существо из компендиума аурой союзников не накрыто', () => {
    assert.deepEqual(
      aurasOn(createWizardActor('paladin'), createCompendiumCreature('ogre')),
      [],
    );
  });

  it('заданное отношение персонажа нормализация не трогает', () => {
    const villain = createWizardActor('villain', { disposition: 'hostile' });
    const bystander = createWizardActor('npc', { disposition: 'neutral' });

    assert.equal(villain.token.disposition, 'hostile');
    assert.equal(bystander.token.disposition, 'neutral');

    assert.deepEqual(aurasOn(createWizardActor('paladin'), villain), []);
    assert.deepEqual(aurasOn(createWizardActor('paladin'), bystander), []);
  });

  it('существо без отношения остаётся враждебным', () => {
    assert.equal(createCompendiumCreature('ogre').token.disposition, 'hostile');
  });
});
