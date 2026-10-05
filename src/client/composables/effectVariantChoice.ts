import type {
  ActiveEffect,
  EffectVariantChoices,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { generateId } from '@vtt/shared';
import {
  listEffectVariantGroups,
  listMoveChoices,
  MOVE_CHOICE_PROMPT_LABELS,
  pickEffectVariants,
  rollRandomEffectVariants,
  stampMoveChoice,
} from '@vtt/shared/system/dnd.js';

import {
  EFFECT_QUESTION_PROMPT_MODAL,
  EFFECT_VARIANT_MODAL_KEY_PREFIX,
  EFFECT_VARIANT_PROMPT_LABELS,
  EFFECT_VARIANT_PROMPT_MODAL,
} from '../ui/effect/constants';

/** Что бросают: заклинание, действие существа, оружие, предмет */
export interface EffectVariantSource {
  name: string;
  activeEffects?: ActiveEffect[];
}

/**
 * Строка чата о выпавших вариантах: «Лучи глаз: Усыпляющий луч».
 *
 * @param sourceName - что бросают
 * @param choices - варианты
 * @returns строка либо `null`, если выпадать было нечему
 */
function formatVariantChoices(
  sourceName: string,
  choices: EffectVariantChoices,
): string | null {
  const labels = Object.values(choices);

  return labels.length > 0
    ? `${sourceName}${EFFECT_VARIANT_PROMPT_LABELS.chatSeparator}${labels.join(EFFECT_VARIANT_PROMPT_LABELS.chatJoiner)}`
    : null;
}

/**
 * Спрашивает применившего о перемещении цели — расстоянии «до N» и
 * направлении «к себе или от себя» — и продолжает с эффектами, где действие
 * «Переместить» уже обычное. Вопросы идут по одному; закрытая плашка отменяет
 * действие. Без таких действий продолжение идёт сразу и синхронно.
 *
 * @param source - заклинание, действие, оружие или предмет
 * @param proceed - продолжение с записанным выбором
 */
function runWithMoveChoices<Source extends EffectVariantSource>(
  source: Source,
  proceed: (chosen: Source) => void,
): void {
  const [request] = listMoveChoices(source.activeEffects ?? []);

  if (!request) {
    proceed(source);

    return;
  }

  useModalManager().openModal(EFFECT_QUESTION_PROMPT_MODAL, {
    allowMultiple: true,
    question: MOVE_CHOICE_PROMPT_LABELS.question,
    options: request.options.map((option) => ({
      id: option.id,
      label: option.label,
    })),
    sourceName: request.effectName,
    onAnswer: (optionId: string) => {
      const option = request.options.find((entry) => entry.id === optionId);

      if (!option) {
        return;
      }

      // Следующий вопрос — у следующего действия с выбором
      runWithMoveChoices(
        {
          ...source,
          activeEffects: stampMoveChoice(
            source.activeEffects ?? [],
            request,
            option,
          ),
        },
        proceed,
      );
    },
    onCancel: () => {},
  });
}

/**
 * Выполняет действие с выбранными вариантами эффектов: из каждой группы
 * альтернатив остаётся один эффект. Случайные группы бросаются сразу, в
 * остальных выбирает бросающий плашкой. Без групп действие идёт сразу и
 * синхронно; закрытая без выбора плашка отменяет действие.
 *
 * В чат уходит только выпавшее случайно: без строки не понять, что выпало.
 * Выбор человека чат не повторяет — у варианта своё имя эффекта, и итог
 * действия его уже называет; вторая строка была бы дублем.
 *
 * Тип урона на выбор (`@dmg.choice(…)`) решается позже, по выбранным
 * эффектам: в окне броска (`requestDamageTypeChoice`), а где окна нет —
 * плашкой (`runWithDamageTypeChoices`).
 *
 * @param source - заклинание, действие, оружие или предмет
 * @param proceedWithVariants - продолжение с выбранными эффектами
 */
export function runWithEffectVariants<Source extends EffectVariantSource>(
  source: Source,
  proceedWithVariants: (chosen: Source) => void,
): void {
  const effects = source.activeEffects ?? [];
  const groups = listEffectVariantGroups(effects);

  /**
   * Продолжение с выбранными вариантами: дальше — выбор перемещения цели.
   *
   * @param chosen - источник с эффектами выбранных вариантов
   */
  const proceed = (chosen: Source): void => {
    runWithMoveChoices(chosen, proceedWithVariants);
  };

  if (groups.length === 0) {
    proceed(source);

    return;
  }

  const rolled = rollRandomEffectVariants(groups);
  const rolledMessage = formatVariantChoices(source.name, rolled);

  const finish = (choices: EffectVariantChoices): void => {
    const allChoices = { ...rolled, ...choices };

    if (rolledMessage) {
      useChatStore().sendMessage(rolledMessage, 'text');
    }

    proceed({
      ...source,
      activeEffects: pickEffectVariants(effects, allChoices),
    });
  };

  const chooseGroups = groups.filter((group) => group.pick !== 'random');

  if (chooseGroups.length === 0) {
    finish({});

    return;
  }

  useModalManager().openModal(EFFECT_VARIANT_PROMPT_MODAL, {
    _modalKey: generateId(EFFECT_VARIANT_MODAL_KEY_PREFIX),
    sourceName: source.name,
    groups: chooseGroups,
    onConfirm: finish,
  });
}
