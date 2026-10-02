import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Новый каст с концентрацией заканчивает прежний ДО того, как на заклинателя
 * ляжет новая метка концентрации. Лист персонажа пишет эффекты заклинателя
 * своим сохранением и меняет его на месте: записанная раньше новая метка
 * заменяла старую, прежний каст найти было не по чему, и его эффекты
 * оставались на целях навсегда.
 */

const engine = await loadEngineBundle(
  "export * from './src/engine/concentration.ts';",
);

const completionPath = 'src/client/composables/spellCastCompletion.ts';

/** Единственное место, где готовятся эффекты заклинателя и метка концентрации */
const PREPARE_CALL = 'prepareCasterSpellEffects(';

/** Прямой конец концентрации: только общий путь каста и применение эффекта */
const RELEASE_CALL = 'releaseConcentration(';

/** Кому разрешён прямой конец концентрации */
const RELEASE_CALLERS = [
  completionPath,
  'src/client/composables/effectActivationUse.ts',
];

/** Поле прежней подписи: эффекты заклинателя вызывающий клал сам, до каста */
const LEGACY_FLAG = 'applyCasterEffects';

/**
 * Метка концентрации каста.
 *
 * @param {string} castId - каст
 * @param {string} spellName - заклинание
 * @returns {object} эффект-метка
 */
function concentrationMark(castId, spellName) {
  return engine.buildConcentrationEffect({
    spell: { id: spellName, name: spellName },
    casterId: 'caster',
    castId,
  });
}

/**
 * Настоящее доведение каста с журналом шагов.
 *
 * @param {object} caster - заклинатель
 * @returns {Promise<object>} обработчик и журнал
 */
async function loadComplete(caster) {
  const steps = [];

  const complete = await loadHandler(completionPath, 'completeSpellCast', {
    completedCastKeys: new Set(),
    COMPLETED_CAST_MEMORY: 200,
    resolveSpellCastId: () => 'cast_new',
    // Конец концентрации читает метки заклинателя в момент вызова
    releaseConcentration: (entity, castId) =>
      steps.push([
        'release',
        engine
          .listConcentrationCastIds(entity.activeEffects)
          .filter((previous) => previous !== castId),
      ]),
    prepareCasterSpellEffects: () => {
      steps.push(['prepare']);

      return [concentrationMark('cast_new', 'Удержание личности')];
    },
    applyCasterSpellEffectsToEntity: () => steps.push(['combat']),
    requestSpellZone: () => steps.push(['zone']),
  });

  return { complete, steps, caster };
}

describe('порядок доведения каста', () => {
  it('прежняя концентрация кончается до записи новой метки листом', async () => {
    const caster = {
      id: 'caster',
      activeEffects: [concentrationMark('cast_old', 'Опутывающий удар')],
    };

    const { complete, steps } = await loadComplete(caster);

    complete({
      spell: { id: 'hold', name: 'Удержание личности', concentration: true },
      caster,
      source: { saveDc: 16 },
      // Лист меняет заклинателя на месте — как `Object.assign` черновика
      landCasterEffects: (casterEffects) => {
        steps.push(['land', casterEffects.length]);
        caster.activeEffects = casterEffects;
      },
    });

    assert.deepEqual(steps, [
      ['release', ['cast_old']],
      ['prepare'],
      ['land', 1],
      ['zone'],
    ]);
  });

  it('без своей записи эффекты ложатся боевым снимком — тоже после конца прежней', async () => {
    const caster = {
      id: 'caster',
      activeEffects: [concentrationMark('cast_old', 'Опутывающий удар')],
    };

    const { complete, steps } = await loadComplete(caster);

    complete({
      spell: { id: 'hold', name: 'Удержание личности', concentration: true },
      caster,
      source: { saveDc: 16 },
    });

    assert.deepEqual(steps, [['release', ['cast_old']], ['combat'], ['zone']]);
  });

  it('заклинание без концентрации прежнюю не трогает', async () => {
    const caster = {
      id: 'caster',
      activeEffects: [concentrationMark('cast_old', 'Опутывающий удар')],
    };

    const { complete, steps } = await loadComplete(caster);

    complete({
      spell: { id: 'shield', name: 'Щит', concentration: false },
      caster,
      source: { saveDc: 16 },
      landCasterEffects: () => steps.push(['land']),
    });

    assert.deepEqual(steps, [['prepare'], ['land'], ['zone']]);
  });

  it('повтор того же каста по ключу ничего не делает дважды', async () => {
    const caster = { id: 'caster', activeEffects: [] };
    const { complete, steps } = await loadComplete(caster);

    const input = {
      spell: { id: 'hold', name: 'Удержание личности', concentration: true },
      caster,
      source: { saveDc: 16 },
      castKey: 'cast_key',
    };

    complete(input);
    complete(input);

    assert.deepEqual(steps, [['release', []], ['combat'], ['zone']]);
  });
});

describe('пути каста не собирают доведение сами', () => {
  /**
   * Исходники клиента, где встречается вызов.
   *
   * @param {string} call - текст вызова
   * @returns {string[]} пути от корня системы
   */
  function listCallers(call) {
    return listClientSources()
      .filter((path) => readFileSync(path, 'utf8').includes(call))
      .map(toSystemPath);
  }

  it('эффекты заклинателя и метку концентрации готовит только общий путь', () => {
    assert.deepEqual(listCallers(PREPARE_CALL), [completionPath]);
  });

  it('прежнюю концентрацию напрямую кончают только общий путь и применение эффекта', () => {
    assert.deepEqual(listCallers(RELEASE_CALL).sort(), RELEASE_CALLERS.sort());
  });

  it('прежней подписи «эффекты кладёт вызывающий до каста» не осталось', () => {
    assert.deepEqual(listCallers(LEGACY_FLAG), []);
  });
});
