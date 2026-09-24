/**
 * Общий канал вопросов человеку: «спросить и дождаться выбранного ответа».
 *
 * Правила сплошь и рядом говорят «можешь»: потратить реакцию, пустить
 * срабатывание в ход, перевести эффект на следующую ступень. Движок такое
 * решение не принимает — его принимает человек. Канал у вопроса тот же, что у
 * спасброска и выбора цели (`rollRequests`): отличается только метка нагрузки.
 * Схема вопроса и разбор ответа пишутся ОДИН раз на обе стороны — как сделано
 * для выбора цели ({@link module:system/dnd/triggerChoice}).
 *
 * Здесь только форма вопроса и проверка ответа. Что случится по ответу,
 * решает тот, кто спрашивал: у срабатывания это его обычные действия.
 *
 * @module system/dnd/triggerPrompt
 */

import type { RollRequestOutcome } from '@vtt/shared';

import { z } from 'zod';

import {
  isRollRequestAnswered,
  withRequestSource,
} from './savingThrowRequest.js';

/**
 * Метка нашей нагрузки. По ней слот адресата отличает вопрос от спасброска и
 * выбора цели: канал у них общий.
 */
export const EFFECT_PROMPT_REQUEST_KIND = 'effectPrompt';

/** Самый длинный текст вопроса и подписи варианта ответа */
const MAX_PROMPT_TEXT_LENGTH = 300;

/** Больше вариантов ответа в одном вопросе не предлагают */
const MAX_PROMPT_OPTIONS = 12;

/** Вариант ответа: что показывает окно и что вернётся инициатору */
const effectPromptOptionSchema = z.object({
  /** Ключ варианта — он и приезжает обратно */
  id: z.string().min(1).max(MAX_PROMPT_TEXT_LENGTH),
  /** Подпись кнопки */
  label: z.string().min(1).max(MAX_PROMPT_TEXT_LENGTH),
  /** Пояснение под подписью; нет — только подпись */
  hint: z.string().max(MAX_PROMPT_TEXT_LENGTH).optional(),
});

/** Вариант ответа на вопрос */
export type EffectPromptOption = z.infer<typeof effectPromptOptionSchema>;

/**
 * Нагрузка вопроса: сам вопрос и закрытый список ответов.
 *
 * Список закрыт намеренно: ответить тем, чего не предлагали, нельзя —
 * {@link readPromptAnswer} сверяет ответ с этим же списком.
 */
export const effectPromptRequestPayloadSchema = z.object({
  /** Метка формы — у чужого запроса она другая */
  kind: z.literal(EFFECT_PROMPT_REQUEST_KIND),
  /** О чём спрашивают */
  question: z.string().min(1).max(MAX_PROMPT_TEXT_LENGTH),
  /** Варианты ответа */
  options: z.array(effectPromptOptionSchema).min(1).max(MAX_PROMPT_OPTIONS),
  /** Чей это вопрос — «Опутывание»: уходит в заголовок окна */
  sourceName: z.string().max(MAX_PROMPT_TEXT_LENGTH).optional(),
  /** Что случится по согласию — короткой строкой для окна */
  effectSummary: z.string().max(MAX_PROMPT_TEXT_LENGTH).optional(),
});

/** Нагрузка вопроса (форма — `effectPromptRequestPayloadSchema`) */
export type EffectPromptRequestPayload = z.infer<
  typeof effectPromptRequestPayloadSchema
>;

/**
 * Разбирает нагрузку вопроса.
 *
 * @param value - непрозрачный `payload` запроса от ядра
 * @returns нагрузка вопроса либо `null`, если форма чужая
 */
export function parseEffectPromptRequestPayload(
  value: unknown,
): EffectPromptRequestPayload | null {
  const parsed = effectPromptRequestPayloadSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Ответ на вопрос: какой вариант выбрали */
export const effectPromptResultSchema = z.object({
  optionId: z.string().min(1).max(MAX_PROMPT_TEXT_LENGTH),
});

/** Ответ на вопрос */
export type EffectPromptResult = z.infer<typeof effectPromptResultSchema>;

/**
 * Разбирает ответ на вопрос.
 *
 * @param value - непрозрачный `result` из исхода запроса
 * @returns ответ либо `null`, если форма чужая
 */
export function parseEffectPromptResult(
  value: unknown,
): EffectPromptResult | null {
  const parsed = effectPromptResultSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Ключи ответов «да» и «нет» — самый частый вопрос */
export const EFFECT_PROMPT_CONFIRM = {
  yes: 'yes',
  no: 'no',
} as const;

/** Варианты ответа «да / нет» */
export const EFFECT_PROMPT_CONFIRM_OPTIONS: readonly EffectPromptOption[] = [
  { id: EFFECT_PROMPT_CONFIRM.yes, label: 'Да' },
  { id: EFFECT_PROMPT_CONFIRM.no, label: 'Нет' },
];

/** Части подписи запроса: «Опутывание — Вопрос» */
export const EFFECT_PROMPT_TITLE_PARTS = {
  /** Подпись самого вопроса */
  ask: 'Вопрос',
} as const;

/**
 * Подпись запроса для плашек ядра: «Опутывание — Вопрос».
 *
 * @param sourceName - чей это вопрос (название эффекта), если известно
 * @returns короткая подпись запроса
 */
export function formatEffectPromptTitle(sourceName?: string): string {
  return withRequestSource(EFFECT_PROMPT_TITLE_PARTS.ask, sourceName);
}

/**
 * Разбирает исход вопроса в ключ выбранного варианта.
 *
 * Ответ приезжает с чужого клиента, поэтому проверяется полностью: вариант
 * обязан быть из числа предложенных. Ответить тем, чего не предлагали, нельзя
 * — такой ответ считается молчанием.
 *
 * @param outcome - исход запроса от ядра
 * @param options - варианты, которые отправляли в запросе
 * @returns ключ варианта; `null` — ответа нет (отказ, срок, отклонён)
 */
export function readPromptAnswer(
  outcome: RollRequestOutcome,
  options: readonly EffectPromptOption[],
): string | null {
  if (!isRollRequestAnswered(outcome)) {
    return null;
  }

  const answer = parseEffectPromptResult(outcome.result);

  if (!answer) {
    return null;
  }

  return options.some((option) => option.id === answer.optionId)
    ? answer.optionId
    : null;
}

/**
 * Согласился ли человек: ответ «да» на вопрос из
 * {@link EFFECT_PROMPT_CONFIRM_OPTIONS}.
 *
 * Отказ, молчание и «спрашивать некого» — одно и то же: согласия нет.
 *
 * @param outcome - исход запроса от ядра
 * @returns `true`, если ответили «да»
 */
export function readPromptConfirmed(outcome: RollRequestOutcome): boolean {
  return (
    readPromptAnswer(outcome, EFFECT_PROMPT_CONFIRM_OPTIONS)
    === EFFECT_PROMPT_CONFIRM.yes
  );
}
