/**
 * Варианты эффекта: из группы эффектов ложится ровно один — выбранный при
 * касте или действии («Глухота/слепота», «Приказ») либо случайный («Лучи глаз»
 * бехолдера, «Пыльца пикси»).
 *
 * Эффект без варианта ложится всегда. Выбор делается один раз на каст или
 * действие — до спасбросков и наложения — и отбрасывает невыбранные варианты
 * у заклинания или псевдо-заклинания броска.
 */

import type { ActiveEffect, EffectVariant } from './activeEffectTypes.js';

/** Как выбирается вариант группы */
export const EFFECT_VARIANT_PICKS = ['choose', 'random'] as const;

/** Выбор варианта: тем, кто бросает, или случаем */
export type EffectVariantPick = (typeof EFFECT_VARIANT_PICKS)[number];

/** Выбор без поля `pick`: вариант называет тот, кто бросает */
export const DEFAULT_EFFECT_VARIANT_PICK: EffectVariantPick = 'choose';

/** Группа вариантов с её вариантами по порядку */
export interface EffectVariantGroup {
  /** Ключ группы */
  group: string;
  /** Как выбирается вариант */
  pick: EffectVariantPick;
  /** Подписи вариантов по порядку первого появления */
  labels: string[];
}

/** Выбранные варианты: группа → подпись варианта */
export type EffectVariantChoices = Readonly<Record<string, string>>;

/**
 * Группы вариантов у списка эффектов. Способ выбора группы берётся у её первого
 * эффекта: у остальных он повторяет его.
 *
 * @param effects - эффекты заклинания или действия
 * @returns группы по порядку первого появления
 */
export function listEffectVariantGroups(
  effects: readonly ActiveEffect[],
): EffectVariantGroup[] {
  const groups = new Map<string, EffectVariantGroup>();

  for (const effect of effects) {
    const variant: EffectVariant | undefined = effect.variant;

    if (!variant || effect.disabled) {
      continue;
    }

    const existing = groups.get(variant.group);

    if (!existing) {
      groups.set(variant.group, {
        group: variant.group,
        pick: variant.pick ?? DEFAULT_EFFECT_VARIANT_PICK,
        labels: [variant.label],
      });

      continue;
    }

    if (!existing.labels.includes(variant.label)) {
      existing.labels.push(variant.label);
    }
  }

  return [...groups.values()];
}

/**
 * Эффекты выбранных вариантов: у группы остаются эффекты её выбранного
 * варианта, эффекты без варианта остаются все. Группа без выбора не ложится
 * вовсе — лучше ничего, чем всё сразу.
 *
 * @param effects - эффекты заклинания или действия
 * @param choices - выбранные варианты
 * @returns эффекты для наложения
 */
export function pickEffectVariants(
  effects: readonly ActiveEffect[],
  choices: EffectVariantChoices,
): ActiveEffect[] {
  return effects.filter(
    (effect) =>
      !effect.variant || choices[effect.variant.group] === effect.variant.label,
  );
}

/**
 * Случайный вариант каждой случайной группы.
 *
 * @param groups - группы вариантов
 * @param random - источник случайности в [0, 1)
 * @returns выбранные варианты случайных групп
 */
export function rollRandomEffectVariants(
  groups: readonly EffectVariantGroup[],
  random: () => number = Math.random,
): Record<string, string> {
  return Object.fromEntries(
    groups
      .filter((group) => group.pick === 'random' && group.labels.length > 0)
      .map((group) => [
        group.group,
        group.labels[Math.floor(random() * group.labels.length)],
      ]),
  );
}
