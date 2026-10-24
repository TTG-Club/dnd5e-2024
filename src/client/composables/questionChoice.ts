/**
 * Выбор одного из нескольких плашкой вопроса — «кто действует», «каким
 * навыком», «кто ищет». Единственный вариант берётся сразу, без вопроса.
 */

import { useModalManager } from '@/shared_ui/composables/useModalManager';

import { EFFECT_QUESTION_PROMPT_MODAL } from '../ui/effect/constants';

/**
 * Спрашивает одно из нескольких плашкой вопроса; единственный вариант берётся
 * сразу, без вопроса. Закрытая плашка — отказ: продолжения нет.
 *
 * @param question - о чём спрашивают
 * @param sourceName - чей вопрос
 * @param options - варианты с подписями
 * @param proceed - продолжение с выбранным вариантом
 * @param modalKey - ключ плашки: повторное нажатие вторую не открывает; нет —
 *   плашки не ограничены
 */
export function chooseOne<Option>(
  question: string,
  sourceName: string,
  options: ReadonlyArray<{ label: string; value: Option }>,
  proceed: (value: Option) => void,
  modalKey?: string,
): void {
  const [only] = options;

  if (!only) {
    return;
  }

  if (options.length === 1) {
    proceed(only.value);

    return;
  }

  useModalManager().openModal(EFFECT_QUESTION_PROMPT_MODAL, {
    ...(modalKey === undefined
      ? { allowMultiple: true }
      : { _modalKey: modalKey }),
    question,
    options: options.map((option, index) => ({
      id: String(index),
      label: option.label,
    })),
    sourceName,
    onAnswer: (optionId: string) => {
      const chosen = options[Number(optionId)];

      if (chosen) {
        proceed(chosen.value);
      }
    },
    onCancel: () => {},
  });
}
