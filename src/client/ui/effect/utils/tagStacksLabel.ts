import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

import { EFFECT_TAG_STACKS_LABELS } from '../constants';

/**
 * Имя эффекта с числом отметок-счётчика: «Лихорадка: провал ×2». Новая
 * отметка того же ключа не ложится второй строкой, а прибавляет ступень
 * прежней — без числа на листе не видно, сколько их набралось.
 *
 * @param effect - эффект строки
 * @param name - подпись строки; по умолчанию имя эффекта
 * @returns подпись с числом ступеней либо без него, если отметка одна
 */
export function formatTagStacksName(
  effect: ActiveEffect,
  name: string = effect.name,
): string {
  const stacks = effect.tagStacks ?? 1;

  return stacks >= EFFECT_TAG_STACKS_LABELS.minShown
    ? `${name}${EFFECT_TAG_STACKS_LABELS.separator}${stacks}`
    : name;
}
