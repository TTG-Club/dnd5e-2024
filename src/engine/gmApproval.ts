/**
 * Разрешение ведущего: «игрок хочет сделать то, что правила сами не
 * позволяют, — пусть решит ведущий». Зелье другому на расстоянии, действие
 * вне очереди, спорная цель — вопрос один и тот же, меняется только текст.
 *
 * Вопрос идёт общим каналом вопросов ({@link module:system/dnd/triggerPrompt})
 * с адресатом «ведущий» и открывает у ведущего то же окно вопроса, что и у
 * срабатываний; отличаются ответы («Разрешить / Запретить») и проверка
 * отвечавшего: разрешение, данное не ведущим, не считается — иначе игрок
 * ответил бы на свой же запрос и разрешил бы себе сам.
 *
 * @module system/dnd/gmApproval
 */

import type { RollRequestOutcome } from '@vtt/shared';

import type {
  EffectPromptOption,
  EffectPromptRequestPayload,
} from './triggerPrompt.js';

import {
  isRollRequestAnswered,
  withRequestSource,
} from './savingThrowRequest.js';
import {
  EFFECT_PROMPT_CONFIRM,
  EFFECT_PROMPT_REQUEST_KIND,
  readPromptAnswer,
} from './triggerPrompt.js';

/** Ответы ведущего: ключи те же, что у «да / нет» */
export const GM_APPROVAL_OPTIONS: readonly EffectPromptOption[] = [
  { id: EFFECT_PROMPT_CONFIRM.yes, label: 'Разрешить' },
  { id: EFFECT_PROMPT_CONFIRM.no, label: 'Запретить' },
];

/** Подпись запроса для плашек ядра: «Зелье лечения — Разрешение ведущего» */
export const GM_APPROVAL_REQUEST_TITLE = 'Разрешение ведущего';

/** О чём просят ведущего */
export interface GmApprovalRequest {
  /** Сам вопрос: «Эльф хочет применить «Зелье лечения» к Гоблину…» */
  question: string;
  /** Чья просьба — уходит в заголовок окна */
  sourceName?: string;
  /** Что случится по разрешению — короткой строкой */
  details?: string;
}

/**
 * Чем кончилась просьба:
 * - `approved` — ведущий разрешил;
 * - `denied` — ведущий запретил, либо запрос отозвали или отклонили;
 * - `noGameMaster` — ведущего нет в сети, спросить некого;
 * - `unanswered` — ведущий не ответил за срок.
 */
export type GmApprovalVerdict =
  'approved' | 'denied' | 'noGameMaster' | 'unanswered';

/**
 * Подпись просьбы для плашек ядра: индикатора ожидания и списка ведущего.
 *
 * @param sourceName - чья просьба, если известно
 * @returns подпись запроса
 */
export function formatGmApprovalTitle(sourceName?: string): string {
  return withRequestSource(GM_APPROVAL_REQUEST_TITLE, sourceName);
}

/**
 * Нагрузка просьбы о разрешении в форме общего вопроса.
 *
 * @param request - о чём просят
 * @returns нагрузка запроса для канала вопросов
 */
export function buildGmApprovalPayload(
  request: GmApprovalRequest,
): EffectPromptRequestPayload {
  return {
    kind: EFFECT_PROMPT_REQUEST_KIND,
    question: request.question,
    options: [...GM_APPROVAL_OPTIONS],
    ...(request.sourceName ? { sourceName: request.sourceName } : {}),
    ...(request.details ? { effectSummary: request.details } : {}),
  };
}

/**
 * Итог просьбы о разрешении. «Разрешить» засчитывается, только если ответил
 * ведущий: чужой ответ — то же, что запрет.
 *
 * @param outcome - исход запроса от ядра
 * @param isGameMaster - ведущий ли пользователь
 * @returns итог просьбы
 */
export function readGmApprovalVerdict(
  outcome: RollRequestOutcome,
  isGameMaster: (userId: string) => boolean,
): GmApprovalVerdict {
  if (outcome.status === 'noRecipient') {
    return 'noGameMaster';
  }

  if (outcome.status === 'timeout') {
    return 'unanswered';
  }

  const approved =
    isRollRequestAnswered(outcome)
    && isGameMaster(outcome.respondedByUserId)
    && readPromptAnswer(outcome, GM_APPROVAL_OPTIONS)
      === EFFECT_PROMPT_CONFIRM.yes;

  return approved ? 'approved' : 'denied';
}
