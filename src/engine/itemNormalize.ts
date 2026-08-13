/**
 * Приведение предмета компендиума к канонической форме системы.
 *
 * Записи приезжают с TTG Club, и часть словарей у источника называется иначе:
 * заряды предмета описаны enum'ами Java (`SHORT_REST`), а тип боеприпаса на
 * стороне выгрузки местами разошёлся с нашим справочником. Разбирать это по
 * месту использования нельзя — расхождение всплывало бы в каждой форме, — и
 * оно чинится один раз на границе входа, как у предысторий
 * (`backgroundNormalize.ts`).
 *
 * Нормализация ТЕРПИМАЯ: неизвестное значение остаётся как есть, а не
 * подменяется дефолтом. Молча превратить незнакомый боеприпас в стрелы хуже,
 * чем оставить его незнакомым — так расхождение хотя бы видно.
 *
 * @module system/dnd/itemNormalize
 */

import type { AmmunitionType } from '@vtt/shared';

import type { DnDGameItem, ItemUses, ItemUsesRecovery } from './dndEntities.js';

/**
 * Синонимы типов боеприпасов.
 *
 * `needles` и `sling-bullets` приезжают из выгрузки VTTG под своими именами
 * (`VttgItemMapper.ammunitionType`), а в нашем справочнике они называются
 * иначе. Пока источник не поправлен, синоним держит духовую трубку и пращу
 * рабочими.
 */
const AMMUNITION_ALIASES: Record<string, AmmunitionType> = {
  'needles': 'blowgun-needles',
  'blowgun-needle': 'blowgun-needles',
  'sling-bullet': 'sling-bullets',
  'arrow': 'arrows',
  'bolt': 'bolts',
  'bullet': 'bullets',
};

/**
 * Синонимы способов отката зарядов. Ключи — значение источника в нижнем
 * регистре без разделителей: так `SHORT_REST` из enum'а Java и наш `shortRest`
 * сходятся в одну запись, и словарь не приходится вести в двух написаниях.
 */
const USES_RECOVERY_ALIASES: Record<string, ItemUsesRecovery> = {
  dawn: 'dawn',
  shortrest: 'shortRest',
  longrest: 'longRest',
  manual: 'manual',
};

/** Значение словаря источника в сравнимом виде: без регистра и разделителей. */
function dictionaryKey(value: string): string {
  return value.toLowerCase().replace(/[_\s-]/g, '');
}

/**
 * Канонические типы боеприпасов. Список нужен гвардом: без него незнакомое
 * значение пришлось бы приводить к типу насильно, а приведение скрыло бы
 * расхождение словарей вместо того, чтобы его показать.
 */
const AMMUNITION_TYPES: readonly string[] = [
  'arrows',
  'bolts',
  'bullets',
  'blowgun-needles',
  'sling-bullets',
];

/** Знаком ли системе такой тип боеприпаса. */
function isAmmunitionType(value: string): value is AmmunitionType {
  return AMMUNITION_TYPES.includes(value);
}

/**
 * Канонический тип боеприпаса.
 *
 * Синоним переводится, знакомое значение проходит как есть, а незнакомое
 * отбрасывается: тип боеприпаса нужен только расходу патронов, и чужое значение
 * там всё равно ни с чем не сойдётся — лучше пусто, чем мусор в поле.
 *
 * @param value - тип боеприпаса из записи компендиума
 */
export function normalizeAmmunitionType(
  value: string | undefined,
): AmmunitionType | undefined {
  if (!value) {
    return undefined;
  }

  const alias = AMMUNITION_ALIASES[value.toLowerCase()];

  if (alias) {
    return alias;
  }

  return isAmmunitionType(value) ? value : undefined;
}

/**
 * Канонические заряды предмета: способ отката приводится к нашему словарю,
 * остаток подрезается под максимум.
 *
 * @param uses - заряды из записи компендиума
 */
export function normalizeItemUses(
  uses: ItemUses | undefined,
): ItemUses | undefined {
  if (!uses || typeof uses.max !== 'number' || uses.max < 1) {
    return undefined;
  }

  const recovery =
    USES_RECOVERY_ALIASES[dictionaryKey(String(uses.recovery))] ?? 'manual';

  const max = Math.round(uses.max);

  // Запись справочника приезжает полной; подрезка страхует от `current`
  // больше максимума у предметов, правленных вручную
  const current =
    typeof uses.current === 'number'
      ? Math.max(0, Math.min(max, Math.round(uses.current)))
      : max;

  return { ...uses, max, current, recovery };
}

/**
 * Возвращает предмет с приведёнными словарями. Предмет без расхождений
 * возвращается тем же объектом — вызывать можно на любом пути входа, не боясь
 * лишних копий.
 *
 * @param item - предмет компендиума или мира
 */
export function normalizeCompendiumItem(item: DnDGameItem): DnDGameItem {
  const ammunitionType = normalizeAmmunitionType(item.ammunitionType);
  const uses = normalizeItemUses(item.uses);

  const ammoChanged = ammunitionType !== item.ammunitionType;
  const usesChanged = uses !== item.uses;

  if (!ammoChanged && !usesChanged) {
    return item;
  }

  const normalized: DnDGameItem = { ...item };

  if (ammoChanged) {
    normalized.ammunitionType = ammunitionType;
  }

  if (usesChanged) {
    if (uses) {
      normalized.uses = uses;
    } else {
      Reflect.deleteProperty(normalized, 'uses');
    }
  }

  return normalized;
}
