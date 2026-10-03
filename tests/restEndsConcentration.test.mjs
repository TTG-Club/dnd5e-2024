import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Отдых заканчивает концентрацию.
 *
 * Срок метки концентрации отсчитывается раундами боя; вне боя часов нет, и
 * метка «Концентрация: … на 1 минуту» переживала и короткий, и
 * продолжительный отдых (живая проверка 03.10, З6). Отдых заканчивает касты
 * тем же путём, что кнопка «Прервать концентрацию», — до своей записи листа.
 */

const REST_PATH = 'src/client/composables/restTriggerPrompt.ts';

/** Заклинатель */
const CASTER_ID = 'actor_caster';

/**
 * Метка концентрации каста.
 *
 * @param {string} castId - каст
 * @param {string} durationUnit - единица длительности заклинания
 * @param {number} durationValue - длительность заклинания
 * @returns {object} эффект-метка
 */
function concentrationMark(castId, durationUnit, durationValue) {
  return engine.buildConcentrationEffect({
    spell: { name: castId, durationUnit, durationValue },
    casterId: CASTER_ID,
    castId,
  });
}

/** Каст на минуту, на час, на восемь часов и бессрочный */
const MARKS = [
  concentrationMark('cast_minute', 'minute', 1),
  concentrationMark('cast_hour', 'hour', 1),
  concentrationMark('cast_eight_hours', 'hour', 8),
  concentrationMark('cast_until_dispelled', 'special', 0),
];

/** Эффект без концентрации: отдых его не трогает */
const PLAIN_EFFECT = {
  id: 'bless',
  name: 'Благословение',
  castId: 'cast_other',
  sourceActorId: 'actor_cleric',
  duration: { type: 'minutes', value: 1, remaining: 10 },
};

describe('какие касты заканчивает отдых', () => {
  it('продолжительный — любую концентрацию', () => {
    assert.deepEqual(
      engine.listRestEndedCastIds([PLAIN_EFFECT, ...MARKS], 'long'),
      ['cast_minute', 'cast_hour', 'cast_eight_hours', 'cast_until_dispelled'],
    );
  });

  it('короткий — касты, которым осталось не больше часа', () => {
    assert.deepEqual(
      engine.listRestEndedCastIds([PLAIN_EFFECT, ...MARKS], 'short'),
      ['cast_minute', 'cast_hour'],
    );
  });

  it('без концентрации заканчивать нечего', () => {
    assert.deepEqual(engine.listRestEndedCastIds([PLAIN_EFFECT], 'long'), []);
    assert.deepEqual(engine.listRestEndedCastIds(undefined, 'short'), []);
  });
});

describe('отдых листа', () => {
  /**
   * Настоящий отдых со срабатываниями и журналом шагов.
   *
   * @returns {Promise<object>} отдых и журнал
   */
  async function loadRest() {
    const steps = [];

    const runRest = await loadHandler(REST_PATH, 'runRestWithTriggers', {
      listRestEndedCastIds: engine.listRestEndedCastIds,
      requestEndCasts: (casterId, castIds) =>
        steps.push(['end', casterId, [...castIds]]),
      waitForCastsEnded: (casterId, castIds) => {
        steps.push(['wait', casterId, [...castIds]]);

        return Promise.resolve();
      },
      askRestTriggers: () => {
        steps.push(['ask']);

        return Promise.resolve({});
      },
      askOnTable: () => {},
      sendSelfTriggerReport: () => steps.push(['report']),
      REST_TRIGGER_SUMMARY_LABEL: '',
    });

    return { runRest, steps };
  }

  it('концентрация заканчивается до записи отдыха, отдых ждёт ответа сервера', async () => {
    const { runRest, steps } = await loadRest();

    await runRest(
      { id: CASTER_ID, name: 'Маг', activeEffects: [MARKS[0]] },
      'long',
      {},
      () => steps.push(['apply']),
    );

    assert.deepEqual(steps, [
      ['end', CASTER_ID, ['cast_minute']],
      ['wait', CASTER_ID, ['cast_minute']],
      ['ask'],
      ['apply'],
      ['report'],
    ]);
  });

  it('короткий отдых долгую концентрацию не трогает', async () => {
    const { runRest, steps } = await loadRest();

    await runRest(
      { id: CASTER_ID, name: 'Следопыт', activeEffects: [MARKS[2]] },
      'short',
      {},
      () => steps.push(['apply']),
    );

    assert.deepEqual(steps.slice(0, 2), [
      ['end', CASTER_ID, []],
      ['wait', CASTER_ID, []],
    ]);
  });
});
