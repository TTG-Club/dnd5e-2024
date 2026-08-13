/**
 * Трата зарядов магического предмета.
 *
 * Заряды описывает {@link ItemUses} (`GameItem.uses`): максимум, текущий
 * остаток, способ отката и — необязательно — расход одного применения и
 * формулу возврата. Здесь только расход; восстановление на отдыхе живёт в
 * `restEngine.ts`, потому что это правило отдыха, а не правило предмета.
 *
 * @module system/dnd/itemUses
 */

import type { DnDGameItem } from './dndEntities.js';

/** Расход одного применения предмета; по умолчанию один заряд. */
export function itemUsesCost(item: DnDGameItem): number {
  const cost = item.uses?.cost;

  return cost === undefined || cost < 1 ? 1 : cost;
}

/**
 * Хватает ли остатка на одно применение. Предмет без зарядов применяется без
 * ограничений — для него ответ всегда `true`.
 *
 * @param item - предмет инвентаря
 */
export function canSpendItemUses(item: DnDGameItem): boolean {
  if (!item.uses) {
    return true;
  }

  return item.uses.current >= itemUsesCost(item);
}

/**
 * Возвращает копию предмета со списанным зарядом. Предмет без зарядов и предмет
 * с недостаточным остатком возвращаются как есть — решение «можно ли применить»
 * принимает вызывающий через {@link canSpendItemUses}, чтобы показать причину
 * отказа, а не молча списать в минус.
 *
 * @param item - предмет инвентаря
 * @returns предмет (новый объект при списании)
 */
export function spendItemUses(item: DnDGameItem): DnDGameItem {
  if (!item.uses || !canSpendItemUses(item)) {
    return item;
  }

  return {
    ...item,
    uses: {
      ...item.uses,
      current: Math.max(0, item.uses.current - itemUsesCost(item)),
    },
  };
}

/**
 * Возвращает копию предмета с изменённым остатком зарядов — для ручной правки
 * счётчика в карточке предмета. Значение зажимается в `0…max`.
 *
 * @param item - предмет инвентаря
 * @param current - желаемый остаток
 * @returns предмет (новый объект, если остаток изменился)
 */
export function setItemUsesCurrent(
  item: DnDGameItem,
  current: number,
): DnDGameItem {
  if (!item.uses) {
    return item;
  }

  const clamped = Math.max(0, Math.min(item.uses.max, Math.round(current)));

  if (clamped === item.uses.current) {
    return item;
  }

  return { ...item, uses: { ...item.uses, current: clamped } };
}
