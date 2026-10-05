import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Новый каст с концентрацией заканчивает прежний ДО того, как на заклинателя
 * ляжет новая метка концентрации, и разбирает цели ПОСЛЕ того, как сервер
 * снял эффекты прежнего каста. Эффекты заклинателя ложатся только боевым
 * снимком: сохранение листа после конца концентрации писало сущность целиком и
 * возвращало эффекты прежнего каста или стирало новую метку.
 */

const engine = await loadEngineBundle(
  "export * from './src/engine/concentration.ts';",
);

const completionPath = 'src/client/composables/spellCastCompletion.ts';

const spellCastsPath = 'src/client/composables/spellCasts.ts';

/** Единственное место, где готовятся эффекты заклинателя и метка концентрации */
const PREPARE_CALL = 'prepareCasterSpellEffects(';

/** Прямой конец концентрации: только общий путь каста */
const RELEASE_CALL = 'releaseConcentration(';

/** Кому разрешён прямой конец концентрации */
const RELEASE_CALLERS = [completionPath];

/** Поле прежней подписи: эффекты заклинателя вызывающий клал сам, до каста */
const LEGACY_FLAG = 'applyCasterEffects';

/** Прежняя своя запись эффектов заклинателя вызывающим — сохранением листа */
const LEGACY_LANDING = 'landCasterEffects';

/** Боевой снимок эффектов заклинателя — изнутри общего пути */
const EVENT_LANDING_CALL = 'landCasterEventEffects(';

/** Полная запись сущности: после конца концентрации в действии её нет */
const FULL_WRITE_PATTERN =
  /\bemitEntityUpdate\(|emit\('update:actor'|emit\('immediate-save'/u;

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
    releaseConcentration: (entity, castId) => {
      const ended = engine
        .listConcentrationCastIds(entity.activeEffects)
        .filter((previous) => previous !== castId);

      steps.push(['release', ended]);

      return ended;
    },
    applyCasterSpellEffectsToEntity: () => steps.push(['combat']),
    requestSpellZone: () => steps.push(['zone']),
    waitForCastsEnded: (_casterId, castIds) => {
      steps.push(['wait', castIds]);

      return Promise.resolve();
    },
  });

  return { complete, steps, caster };
}

describe('порядок доведения каста', () => {
  it('конец прежней → эффекты заклинателя боевым снимком → зона → ожидание снятия', async () => {
    const caster = {
      id: 'caster',
      activeEffects: [concentrationMark('cast_old', 'Опутывающий удар')],
    };

    const { complete, steps } = await loadComplete(caster);

    await complete({
      spell: { id: 'hold', name: 'Удержание личности', concentration: true },
      caster,
      source: { saveDc: 16 },
    });

    assert.deepEqual(steps, [
      ['release', ['cast_old']],
      ['combat'],
      ['zone'],
      ['wait', ['cast_old']],
    ]);
  });

  it('заклинание без концентрации прежнюю не трогает и не ждёт', async () => {
    const caster = {
      id: 'caster',
      activeEffects: [concentrationMark('cast_old', 'Опутывающий удар')],
    };

    const { complete, steps } = await loadComplete(caster);

    await complete({
      spell: { id: 'shield', name: 'Щит', concentration: false },
      caster,
      source: { saveDc: 16 },
    });

    // Пустой список собран в другом realm (VM) — сравнивается по содержимому
    assert.equal(
      JSON.stringify(steps),
      JSON.stringify([['combat'], ['zone'], ['wait', []]]),
    );
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

    await complete(input);
    await complete(input);

    assert.deepEqual(steps, [
      ['release', []],
      ['combat'],
      ['zone'],
      ['wait', []],
    ]);
  });
});

describe('ожидание конца прежнего каста', () => {
  /**
   * Настоящее ожидание с подменённым слежением и таймером.
   *
   * @param {{ value: boolean }} pending - лежат ли эффекты прежнего каста
   * @returns {Promise<object>} ожидание и управление подменами
   */
  async function loadWait(pending) {
    const watchers = [];
    const timers = [];

    const waitForCastsEnded = await loadHandler(
      spellCastsPath,
      'waitForCastsEnded',
      {
        CAST_END_WAIT_MS: 1000,
        hasEndedCastEffects: () => pending.value,
        watch: (getter, callback) => {
          const watcher = { getter, callback, stopped: false };

          watchers.push(watcher);

          return () => {
            watcher.stopped = true;
          };
        },
        setTimeout: (callback, delay) => {
          timers.push({ callback, delay });

          return timers.length;
        },
        clearTimeout: () => {},
        Promise,
        Set,
      },
    );

    /** Сообщает слежению, что стор изменился */
    function storeChanged() {
      for (const watcher of watchers.filter((entry) => !entry.stopped)) {
        watcher.callback(watcher.getter());
      }
    }

    return { waitForCastsEnded, watchers, timers, storeChanged };
  }

  /**
   * Выполнился ли промис к этому моменту.
   *
   * @param {Promise<void>} promise - промис
   * @returns {Promise<boolean>} выполнен ли
   */
  async function isSettled(promise) {
    let settled = false;

    promise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    return settled;
  }

  it('без прежних кастов выполнено сразу', async () => {
    const { waitForCastsEnded, watchers } = await loadWait({ value: true });

    assert.equal(await isSettled(waitForCastsEnded('caster', [])), true);
    assert.equal(watchers.length, 0);
  });

  it('эффект прежнего каста в сторе — ждёт; снят — выполнено', async () => {
    const pending = { value: true };

    const { waitForCastsEnded, watchers, storeChanged } =
      await loadWait(pending);

    const waiting = waitForCastsEnded('caster', ['cast_old']);

    assert.equal(await isSettled(waiting), false);

    pending.value = false;
    storeChanged();

    assert.equal(await isSettled(waiting), true);
    assert.equal(watchers[0].stopped, true, 'слежение снято');
  });

  it('ответа сервера нет — выполняется по тайм-ауту', async () => {
    const { waitForCastsEnded, timers, watchers } = await loadWait({
      value: true,
    });

    const waiting = waitForCastsEnded('caster', ['cast_old']);

    assert.equal(await isSettled(waiting), false);
    assert.equal(timers[0].delay, 1000);

    timers[0].callback();

    assert.equal(await isSettled(waiting), true);
    assert.equal(watchers[0].stopped, true);
  });

  it('эффектом прежнего каста считается то же, что снимает сервер', async () => {
    const castEffect = {
      ...concentrationMark('cast_old', 'Опутывающий удар'),
      sourceActorId: 'caster',
    };

    const entities = [];

    const hasEndedCastEffects = await loadHandler(
      spellCastsPath,
      'hasEndedCastEffects',
      {
        useWorldEntities: () => ({ getCurrentWorldEntities: () => entities }),
        isDndSceneEntity: () => true,
        withoutCastEffects: engine.withoutCastEffects,
      },
    );

    entities.push({ id: 'target', activeEffects: [castEffect] });
    assert.equal(hasEndedCastEffects('caster', new Set(['cast_old'])), true);
    assert.equal(hasEndedCastEffects('other', new Set(['cast_old'])), false);
    assert.equal(hasEndedCastEffects('caster', new Set(['cast_new'])), false);
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

  it('эффекты заклинателя вызывающий не пишет сам — ни сохранением, ни снимком', () => {
    assert.deepEqual(listCallers(LEGACY_LANDING), []);

    assert.deepEqual(listCallers(EVENT_LANDING_CALL), [completionPath]);
  });

  it('после доведения каста в продолжении нет полной записи сущности', () => {
    const offenders = [];

    for (const path of listClientSources()) {
      const text = readFileSync(path, 'utf8');

      for (const match of text.matchAll(/afterSpellCast\(/gu)) {
        const continuation = readBalancedCall(text, match.index);

        if (FULL_WRITE_PATTERN.test(continuation)) {
          offenders.push(toSystemPath(path));
        }
      }
    }

    assert.deepEqual(offenders, []);
  });

  it('доведение каста не пишет сущность целиком', () => {
    assert.doesNotMatch(
      readFileSync(completionPath, 'utf8'),
      /\bemitEntityUpdate\(/u,
    );
  });
});

/**
 * Текст вызова от открывающей скобки до парной закрывающей.
 *
 * @param {string} text - исходник
 * @param {number} start - где начинается вызов
 * @returns {string} текст вызова
 */
function readBalancedCall(text, start) {
  const open = text.indexOf('(', start);

  let depth = 0;

  for (let index = open; index < text.length; index++) {
    if (text[index] === '(') {
      depth++;
    } else if (text[index] === ')') {
      depth--;

      if (depth === 0) {
        return text.slice(open, index + 1);
      }
    }
  }

  return text.slice(open);
}
