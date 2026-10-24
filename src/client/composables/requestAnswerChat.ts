/**
 * Ответ на вопрос по чужому запросу — строкой в чат участникам.
 *
 * Запросы между людьми (игрок просит ведущего, ведущий или игрок спрашивает
 * игрока) кончаются ответом, который видит только тот, кто ответил. Чтобы итог
 * остался в истории, ответивший пишет его в чат: видят он сам, просивший и
 * мастер (`ChatSendOptions.audienceUserIds`, VTTG 0.9.745). Броски по запросу
 * сюда не идут — их окно и так пишет бросок в чат со своей видимостью.
 *
 * @module client/composables/requestAnswerChat
 */

import type { RequestedRollPrompt } from '@/core/systems/uiSystemRegistry';

import { useChatStore } from '@/stores/chatStore';

import { REQUEST_ANSWER_CHAT } from '../ui/effect/constants';

/**
 * Кто ещё увидит ответ, кроме ответившего и мастера: просивший — если это
 * человек, а не сам сервер (зона, аура).
 *
 * @param request - запрос
 * @returns участники запроса
 */
function resolveAnswerAudience(request: RequestedRollPrompt): string[] {
  return request.requesterKind === 'server' ? [] : [request.requesterUserId];
}

/**
 * Пишет в чат, что ответили на вопрос по чужому запросу.
 *
 * @param request - запрос, на который ответили
 * @param answer - ответ словами: подпись кнопки или выбранные цели
 */
export function postRequestAnswerToChat(
  request: RequestedRollPrompt,
  answer: string,
): void {
  const title = request.title ?? REQUEST_ANSWER_CHAT.untitled;

  useChatStore().sendMessage(
    `${title}${REQUEST_ANSWER_CHAT.answerSeparator}${answer}`,
    'text',
    undefined,
    undefined,
    {
      // Ответ — от человека, не от персонажа на сцене
      speakerEntityId: null,
      audienceUserIds: resolveAnswerAudience(request),
    },
  );
}
