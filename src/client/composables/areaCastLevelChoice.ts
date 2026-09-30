/**
 * Круг ячейки до шаблона — у заклинания, чья область растёт от круга
 * («Туманное облако»). Поставленный шаблон ядро не растягивает, поэтому круг
 * спрашивается раньше: плашка с вариантами «Круг 3 — 40 фт», дальше шаблон
 * ставится нужного размера, а окно броска закрепляет тот же круг
 * (`engine/spellAreaScaling.ts`).
 */

import type { Spell } from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { DISTANCE_UNIT_SHORT } from '@vtt/shared';
import {
  AREA_CAST_LEVEL_LABELS,
  formatAreaCastLevelOption,
  spellAreaScalesWithLevel,
} from '@vtt/shared/system/dnd.js';

/**
 * Выбирает круг до шаблона, если от него растёт область; иначе продолжает
 * сразу, без закреплённого круга (его выберут в окне броска, как всегда).
 * Закрытая плашка отменяет каст.
 *
 * @param spell - заклинание
 * @param availableLevels - круги, которыми можно наложить
 * @param proceed - продолжение каста с закреплённым кругом
 */
export function chooseAreaCastLevel(
  spell: Spell,
  availableLevels: readonly number[],
  proceed: (castLevel?: number) => void,
): void {
  const { areaOfEffect } = spell;

  if (!areaOfEffect || !spellAreaScalesWithLevel(spell)) {
    proceed();

    return;
  }

  // Один доступный круг — выбирать не из чего, но закрепить его надо: окно
  // броска иначе предложит круг, под который шаблон не рассчитан
  if (availableLevels.length <= 1) {
    proceed(availableLevels[0]);

    return;
  }

  const unitLabel = DISTANCE_UNIT_SHORT[areaOfEffect.unit] ?? areaOfEffect.unit;

  useModalManager().openModal('EffectQuestionPromptModal', {
    allowMultiple: true,
    question: AREA_CAST_LEVEL_LABELS.question,
    options: availableLevels.map((castLevel) => ({
      id: String(castLevel),
      label: formatAreaCastLevelOption(spell, castLevel, unitLabel),
    })),
    sourceName: spell.name,
    onAnswer: (optionId: string) => {
      proceed(Number(optionId));
    },
    onCancel: () => {},
  });
}
