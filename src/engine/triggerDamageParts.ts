/**
 * Обход частей урона и лечения в действиях срабатываний эффекта.
 *
 * Формулы урона срабатываний подставляют числа дважды и с разным смыслом:
 * уровень своего класса (`classEffectScope.ts`) и числа наложившего
 * (`sourceFormulaBinding.ts`). Обход один на оба места — иначе новое поле
 * действия дошло бы только до одной подстановки.
 *
 * @module system/dnd/triggerDamageParts
 */

import type { DamagePart } from '@vtt/shared';

import type { EffectTrigger } from './effectTriggerTypes.js';

/**
 * Есть ли у срабатываний часть урона или лечения, которая проходит проверку.
 *
 * @param triggers - срабатывания эффекта
 * @param test - проверка части
 * @returns `true`, если такая часть есть
 */
export function someTriggerDamagePart(
  triggers: readonly EffectTrigger[] | undefined,
  test: (part: DamagePart) => boolean,
): boolean {
  return (triggers ?? []).some((trigger) =>
    trigger.actions.some(
      (action) => action.type === 'damage' && action.parts.some(test),
    ),
  );
}

/**
 * Копия срабатывания с изменёнными частями урона и лечения. Срабатывание без
 * таких частей возвращается как есть.
 *
 * @param trigger - срабатывание
 * @param mapPart - что сделать с частью
 * @returns срабатывание с новыми частями
 */
export function mapTriggerDamageParts(
  trigger: EffectTrigger,
  mapPart: (part: DamagePart) => DamagePart,
): EffectTrigger {
  if (!trigger.actions.some((action) => action.type === 'damage')) {
    return trigger;
  }

  return {
    ...trigger,
    actions: trigger.actions.map((action) =>
      action.type === 'damage'
        ? { ...action, parts: action.parts.map(mapPart) }
        : action,
    ),
  };
}
