import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/gmApproval.ts'; export * from './src/engine/triggerPrompt.ts';",
);

/**
 * Ведущий ли пользователь: в тестах ведущий — `gm`.
 *
 * @param {string} userId - пользователь
 * @returns {boolean} ведущий ли он
 */
function isGameMaster(userId) {
  return userId === 'gm';
}

/**
 * Исход запроса с ответом.
 *
 * @param {string} optionId - выбранный ответ
 * @param {string} respondedByUserId - кто ответил
 * @param {string} status - `answered` или `takenOver`
 * @returns {object} исход
 */
function answered(optionId, respondedByUserId, status = 'answered') {
  return { status, result: { optionId }, respondedByUserId };
}

it('просьба к ведущему — общий вопрос с ответами «Разрешить / Запретить»', () => {
  const payload = engine.buildGmApprovalPayload({
    question: 'Дать зелье?',
    sourceName: 'Зелье лечения',
  });

  assert.equal(payload.kind, engine.EFFECT_PROMPT_REQUEST_KIND);

  assert.deepEqual(
    payload.options.map((option) => option.label),
    ['Разрешить', 'Запретить'],
  );

  assert.equal(payload.effectSummary, undefined);

  assert.ok(
    engine.parseEffectPromptRequestPayload(payload),
    'окно вопроса у ведущего принимает эту нагрузку как есть',
  );
});

it('разрешение засчитывается только от ведущего и только «Разрешить»', () => {
  const { yes, no } = engine.EFFECT_PROMPT_CONFIRM;

  /**
   * Итог просьбы по исходу запроса.
   *
   * @param {object} outcome - исход
   * @returns {string} итог
   */
  function verdictOf(outcome) {
    return engine.readGmApprovalVerdict(outcome, isGameMaster);
  }

  assert.equal(verdictOf(answered(yes, 'gm')), 'approved');
  assert.equal(verdictOf(answered(yes, 'gm', 'takenOver')), 'approved');
  assert.equal(verdictOf(answered(no, 'gm')), 'denied', 'запрет');

  assert.equal(
    verdictOf(answered(yes, 'player', 'takenOver')),
    'denied',
    'игрок ответил на свой запрос — это не разрешение',
  );

  assert.equal(
    verdictOf(answered('maybe', 'gm')),
    'denied',
    'ответ не из предложенных',
  );

  assert.equal(verdictOf({ status: 'declined' }), 'denied');
  assert.equal(verdictOf({ status: 'noRecipient' }), 'noGameMaster');
  assert.equal(verdictOf({ status: 'timeout' }), 'unanswered');
});

it('подпись просьбы в плашках ядра называет источник', () => {
  assert.equal(
    engine.formatGmApprovalTitle('Зелье лечения'),
    'Зелье лечения — Разрешение ведущего',
  );

  assert.equal(engine.formatGmApprovalTitle(), 'Разрешение ведущего');
});
