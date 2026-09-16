import type {
  ActiveEffect,
  EffectVariantChoices,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { generateId } from '@vtt/shared';
import {
  listEffectVariantGroups,
  pickEffectVariants,
  rollRandomEffectVariants,
} from '@vtt/shared/system/dnd.js';

import {
  EFFECT_VARIANT_MODAL_KEY_PREFIX,
  EFFECT_VARIANT_PROMPT_LABELS,
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
 * Выполняет действие с выбранными вариантами эффектов: из каждой группы
 * альтернатив остаётся один эффект. Случайные группы бросаются сразу, в
 * остальных выбирает бросающий плашкой. Без групп действие идёт сразу и
 * синхронно; закрытая без выбора плашка отменяет действие.
 *
 * @param source - заклинание, действие, оружие или предмет
 * @param proceed - продолжение с выбранными эффектами
 */
export function runWithEffectVariants<Source extends EffectVariantSource>(
  source: Source,
  proceed: (chosen: Source) => void,
): void {
  const effects = source.activeEffects ?? [];
  const groups = listEffectVariantGroups(effects);

  if (groups.length === 0) {
    proceed(source);

    return;
  }

  const rolled = rollRandomEffectVariants(groups);

  const finish = (choices: EffectVariantChoices): void => {
    const allChoices = { ...rolled, ...choices };
    const message = formatVariantChoices(source.name, allChoices);

    if (message) {
      useChatStore().sendMessage(message, 'text');
    }

    proceed({
      ...source,
      activeEffects: pickEffectVariants(effects, allChoices),
    });
  };

  const chooseGroups = groups.filter((group) => group.pick === 'choose');

  if (chooseGroups.length === 0) {
    finish({});

    return;
  }

  useModalManager().openModal('EffectVariantPromptModal', {
    _modalKey: generateId(EFFECT_VARIANT_MODAL_KEY_PREFIX),
    sourceName: source.name,
    groups: chooseGroups,
    onConfirm: finish,
  });
}
