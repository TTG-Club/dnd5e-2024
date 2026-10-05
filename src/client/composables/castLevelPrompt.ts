/**
 * Вопрос «каким кругом накладывать?» до окна броска — одна плашка со списком
 * кругов на все случаи, когда круг нужен раньше: область растёт от круга
 * (`areaCastLevelChoice.ts`), от круга считается цена каста
 * (`effectPayChoice.ts`).
 *
 * Список тот же, что в окне броска и в окне выбора целей: круг выбирается
 * одинаково, где бы его ни спросили. Выбранный здесь круг дальше закреплён —
 * окно броска показывает его, но сменить не даёт.
 */

import { useModalManager } from '@/shared_ui/composables/useModalManager';

import {
  SPELL_CAST_LEVEL_PROMPT_LABELS,
  SPELL_CAST_LEVEL_PROMPT_MODAL,
  SPELL_LEVEL_SUFFIX,
} from '../ui/actor/constants';

/** Пункт списка кругов */
export interface CastLevelPromptItem {
  /** Подпись: «3-й круг» или «3-й круг — 40 фт» */
  label: string;
  /** Круг ячейки */
  value: number;
}

/** О чём спрашивает плашка выбора круга */
export interface CastLevelPromptRequest {
  /** Заклинание, которое накладывают */
  sourceName: string;
  /** Вопрос и почему круг нужен заранее */
  question: string;
  /** Круги, которыми можно наложить */
  levels: readonly number[];
  /** Что даёт круг — дописывается к пункту: «40 фт» */
  describeLevel?: (castLevel: number) => string;
  /** Круг выбран — каст продолжается им */
  onChoose: (castLevel: number) => void;
}

/**
 * Собирает пункты списка кругов.
 *
 * @param levels - круги, которыми можно наложить
 * @param describeLevel - что даёт круг; нет — пункт называет только круг
 * @returns пункты списка в порядке кругов
 */
function buildCastLevelItems(
  levels: readonly number[],
  describeLevel: CastLevelPromptRequest['describeLevel'],
): CastLevelPromptItem[] {
  return levels.map((castLevel) => {
    const label = `${castLevel}${SPELL_LEVEL_SUFFIX}`;

    return {
      label: describeLevel
        ? `${label}${SPELL_CAST_LEVEL_PROMPT_LABELS.detailSeparator}${describeLevel(castLevel)}`
        : label,
      value: castLevel,
    };
  });
}

/**
 * Спрашивает круг плашкой со списком. Закрытая плашка отменяет каст: без
 * круга продолжать нечем.
 *
 * @param request - о чём спрашивают и что делать с ответом
 */
export function askCastLevel(request: CastLevelPromptRequest): void {
  useModalManager().openModal(SPELL_CAST_LEVEL_PROMPT_MODAL, {
    allowMultiple: true,
    sourceName: request.sourceName,
    question: request.question,
    levelItems: buildCastLevelItems(request.levels, request.describeLevel),
    onConfirm: request.onChoose,
  });
}
