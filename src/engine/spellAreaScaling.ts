/**
 * Рост области заклинания от круга ячейки: «Туманное облако» — радиус +20 фт
 * за каждый круг выше 1-го.
 *
 * Прибавка лежит в усилении заклинания (`Spell.scaling.additionalAreaSize`,
 * поле ядра VTTG) в единицах области. Шаблон на сцене ставится ДО окна броска,
 * где обычно выбирают круг, а поставленный шаблон ядро не растягивает, —
 * поэтому у такого заклинания круг спрашивается до шаблона
 * (`client/composables/areaCastLevelChoice.ts`), шаблон ставится нужного
 * размера, и окно броска закрепляет тот же круг.
 *
 * @module system/dnd/spellAreaScaling
 */

import type { SpellAreaOfEffect } from '@vtt/shared';

import type { Spell } from './dndEntities.js';

/** Что читает рост области */
export type SpellAreaScalingSource = Pick<
  Spell,
  'level' | 'areaOfEffect' | 'scaling'
>;

/**
 * Растёт ли область заклинания от круга ячейки.
 *
 * @param spell - заклинание
 * @returns `true`, если у заклинания с кругом и областью есть прибавка
 */
export function spellAreaScalesWithLevel(
  spell: SpellAreaScalingSource,
): boolean {
  return (
    spell.level > 0
    && spell.areaOfEffect !== undefined
    && (spell.scaling?.additionalAreaSize ?? 0) > 0
  );
}

/**
 * Область заклинания на этом круге ячейки: базовый размер плюс прибавка за
 * каждый круг выше базового.
 *
 * @param spell - заклинание
 * @param castLevel - круг ячейки; нет — базовый
 * @returns область либо `undefined`, если её нет
 */
export function resolveSpellAreaAtLevel(
  spell: SpellAreaScalingSource,
  castLevel: number | undefined,
): SpellAreaOfEffect | undefined {
  const { areaOfEffect } = spell;

  if (!areaOfEffect || !spellAreaScalesWithLevel(spell)) {
    return areaOfEffect;
  }

  const levelsAbove = Math.max(0, (castLevel ?? spell.level) - spell.level);

  return {
    ...areaOfEffect,
    size:
      areaOfEffect.size
      + levelsAbove * (spell.scaling?.additionalAreaSize ?? 0),
  };
}

/** Подписи выбора круга до шаблона */
export const AREA_CAST_LEVEL_LABELS = {
  question: 'Каким кругом накладывать? От круга растёт область.',
} as const;

/**
 * Размер области на этом круге для пункта выбора круга: «40 фт». Сам круг
 * пункт подписывает так же, как остальные списки кругов, — здесь только то,
 * чем круги различаются.
 *
 * @param spell - заклинание
 * @param castLevel - круг ячейки
 * @param unitLabel - подпись единицы области
 * @returns размер области с единицей
 */
export function formatAreaSizeAtLevel(
  spell: SpellAreaScalingSource,
  castLevel: number,
  unitLabel: string,
): string {
  const size = resolveSpellAreaAtLevel(spell, castLevel)?.size ?? 0;

  return `${size} ${unitLabel}`;
}
