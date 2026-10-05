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
export const EFFECT_VARIANT_PICKS = ['choose', 'random', 'multi'] as const;

/**
 * Разделитель подписей в выборе нескольких вариантов одной группы: перевода
 * строки в подписи варианта не бывает
 */
export const EFFECT_VARIANT_MULTI_SEPARATOR = '\n';

/**
 * Выбор варианта: тем, кто бросает (`choose` — один, `multi` — один или
 * несколько: «выберите 1 или несколько типов существ»), или случаем
 */
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
      !effect.variant
      || splitVariantChoice(choices[effect.variant.group]).includes(
        effect.variant.label,
      ),
  );
}

/**
 * Подписи вариантов из выбора группы: у выбора нескольких вариантов они лежат
 * одной строкой через {@link EFFECT_VARIANT_MULTI_SEPARATOR}.
 *
 * @param choice - выбор группы
 * @returns подписи; пусто — группа без выбора
 */
export function splitVariantChoice(choice: string | undefined): string[] {
  return choice === undefined
    ? []
    : choice.split(EFFECT_VARIANT_MULTI_SEPARATOR);
}

/**
 * Выбор группы из нескольких подписей — одной строкой.
 *
 * @param labels - выбранные варианты
 * @returns выбор группы
 */
export function joinVariantChoice(labels: readonly string[]): string {
  return labels.join(EFFECT_VARIANT_MULTI_SEPARATOR);
}

/**
 * Выбор, который уже сделан: по эффектам, оставшимся после
 * `pickEffectVariants`, — у каждой группы ровно тот вариант, что уцелел. Нужен,
 * чтобы сузить свежую запись заклинания тем же выбором и сравнить её с кастом:
 * иначе полная запись никогда не совпала бы с суженной.
 *
 * @param effects - эффекты после выбора вариантов
 * @returns выбранные варианты по группам
 */
export function readEffectVariantChoices(
  effects: readonly ActiveEffect[],
): EffectVariantChoices {
  const byGroup = new Map<string, string[]>();

  for (const effect of effects) {
    if (!effect.variant) {
      continue;
    }

    const labels = byGroup.get(effect.variant.group) ?? [];

    if (!labels.includes(effect.variant.label)) {
      labels.push(effect.variant.label);
    }

    byGroup.set(effect.variant.group, labels);
  }

  return Object.fromEntries(
    [...byGroup].map(([group, labels]) => [group, joinVariantChoice(labels)]),
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
