/**
 * Условие по виду существа: вид персонажа или подтип существа — из списка
 * или вне его.
 *
 * Тип существа («гуманоид», «нежить») — словарь из пятнадцати ключей; вид
 * («эльф», «дварф») и подтип статблока («демон», «дьявол», «гоблиноид») —
 * свободные названия, и условие сверяет их текстом:
 *
 * - `self.species === "эльф"` — носитель эльф;
 * - `self.species !== "дварф, дуэргар"` — носитель не дварф и не дуэргар
 *   («Пояс дварфов»);
 * - `target.species !== "эльф"` — другая сторона не эльф.
 *
 * Что считается видом: у персонажа — ключ и название вида и подвида листа, у
 * существа — подтип статблока (через запятую, если их несколько). Сравнение
 * без учёта регистра и крайних пробелов. У существа без подтипа и персонажа
 * без вида названий нет: «из списка» не выполняется, «не из списка» —
 * выполняется (вурдалак парализует зомби без подтипа: он точно не эльф).
 *
 * Разбор один на словарь модификаторов (условие о носителе, считается на
 * листе) и словарь срабатываний.
 *
 * @module system/dnd/speciesCondition
 */

import type { DnDSceneEntity } from './dndEntities.js';

import { isCreatureEntity } from '@vtt/shared';

import { splitConditionList, splitQuotedList } from './conditionSyntax.js';

/** Приставка условия «вид носителя из списка» */
export const CARRIER_SPECIES_CONDITION_PREFIX = 'self.species === ';

/** Приставка условия «вид носителя не из списка» */
export const CARRIER_SPECIES_NOT_CONDITION_PREFIX = 'self.species !== ';

/** Приставка условия «вид другой стороны из списка» */
export const TARGET_SPECIES_CONDITION_PREFIX = 'target.species === ';

/** Приставка условия «вид другой стороны не из списка» */
export const TARGET_SPECIES_NOT_CONDITION_PREFIX = 'target.species !== ';

/** Разобранное условие по виду */
export interface SpeciesCondition {
  /** Названия списка в нижнем регистре */
  names: string[];
  /** «Не из списка» */
  negate: boolean;
}

/**
 * Названия из списка через запятую: без пустых, в нижнем регистре.
 *
 * @param text - список
 * @returns названия
 */
export function splitSpeciesList(text: string): string[] {
  return splitConditionList(text).map((name) => name.toLowerCase());
}

/**
 * Названия, которыми зовётся вид сущности: вид и подвид листа либо подтип
 * статблока.
 *
 * @param entity - персонаж или существо
 * @returns названия в нижнем регистре; пусто — вида нет
 */
export function listEntitySpeciesNames(entity: DnDSceneEntity): string[] {
  if (isCreatureEntity(entity)) {
    const { subtype } = entity.system;

    return typeof subtype === 'string' ? splitSpeciesList(subtype) : [];
  }

  const species = entity.system.species;

  return [
    species?.speciesKey,
    species?.speciesName,
    species?.subspeciesKey,
    species?.subspeciesName,
  ].flatMap((name) => (name ? splitSpeciesList(name) : []));
}

/**
 * Разбирает часть условия о виде носителя.
 *
 * @param part - часть условия
 * @returns условие либо `undefined`, если часть о другом или список пуст
 */
export function parseCarrierSpeciesCondition(
  part: string,
): SpeciesCondition | undefined {
  const trimmed = part.trim();

  const prefix = [
    CARRIER_SPECIES_CONDITION_PREFIX,
    CARRIER_SPECIES_NOT_CONDITION_PREFIX,
  ].find((candidate) => trimmed.startsWith(candidate));

  if (!prefix) {
    return undefined;
  }

  const names = splitQuotedList(trimmed.slice(prefix.length));

  return names.length > 0
    ? { names, negate: prefix === CARRIER_SPECIES_NOT_CONDITION_PREFIX }
    : undefined;
}

/**
 * Выполняется ли условие по виду при таких названиях вида.
 *
 * @param condition - условие
 * @param speciesNames - названия вида сущности в нижнем регистре
 * @returns `true`, если выполняется
 */
export function speciesConditionHolds(
  condition: SpeciesCondition,
  speciesNames: readonly string[],
): boolean {
  const inList = speciesNames.some((name) => condition.names.includes(name));

  return inList !== condition.negate;
}

/**
 * Вид сущности из списка названий.
 *
 * @param entity - персонаж или существо
 * @param list - список названий через запятую
 * @returns `true`, если любое название вида есть в списке
 */
export function entitySpeciesInList(
  entity: DnDSceneEntity,
  list: string,
): boolean {
  return speciesConditionHolds(
    { names: splitSpeciesList(list), negate: false },
    listEntitySpeciesNames(entity),
  );
}
