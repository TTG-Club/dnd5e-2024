/**
 * Кости хитов существа по правилам D&D 2024 (Monster Manual, «Hit Points»).
 *
 * Кость хитов задаёт размер существа (Крошечное — к4, … Громадное — к20), а
 * плоский бонус к хитам — модификатор Телосложения, умноженный на число костей.
 * Стат-блок хранит формулу строкой («4к10 + 4») и её среднее, и лист обязан
 * пересобирать оба, как только меняются размер или Телосложение: иначе Большое
 * существо с Телосложением 16 так и живёт с «2к8 + 2» из заготовки.
 *
 * Модуль печатает формулу сам — это единственное место в движке, где формула
 * собирается, а не разбирается: формула хитов существа — поле его записи, и
 * собирать её обязан владелец правил, а не каждое окно по-своему.
 */

import type {
  CreatureHitDie,
  CreatureHitPoints,
  CreatureSystem,
} from './creatureTypes.js';
import type { DnDCustomBonusContext } from './customBonuses.js';
import type { DnDCreature } from './dndEntities.js';
import type { CreatureSize } from './types.js';

import {
  calculateAbilityModifier,
  getActorAbilityModifiers,
  getCreatureProficiencyBonus,
} from './calculations.js';
import { getCustomBonusesValue, parseAbilityBonuses } from './customBonuses.js';
import { findFirstDiceTerm } from './diceFormula.js';

/** Кость хитов по размеру существа (Monster Manual 2024) */
export const CREATURE_HIT_DIE_BY_SIZE: Record<CreatureSize, CreatureHitDie> = {
  tiny: 4,
  small: 6,
  medium: 8,
  large: 10,
  huge: 12,
  gargantuan: 20,
};

/** Буква кости в записи формулы хитов существа: «2к8» */
export const HIT_DICE_FORMULA_LETTER = 'к';

/** Число костей хитов у существа, пока его никто не задал */
export const DEFAULT_CREATURE_HIT_DICE_COUNT = 1;

/**
 * Поля системных данных, от которых зависит формула хитов: размер задаёт
 * кость, Телосложение и свои бонусы к нему — бонус за каждую кость. Лист
 * пересобирает формулу после правки любого из них.
 */
export const CREATURE_HIT_DICE_RULE_KEYS: readonly (keyof CreatureSystem)[] = [
  'size',
  'abilities',
  'abilityBonuses',
];

/**
 * Меньше одного хита у существа не бывает: у Крошечного с низким Телосложением
 * среднее по формуле уходит в ноль, а стат-блок при этом обязан описывать
 * живое существо.
 */
const MIN_CREATURE_AVERAGE_HIT_POINTS = 1;

/**
 * Кость хитов существа по его размеру.
 *
 * @param size - размер существа
 * @returns кость хитов по правилам 2024
 */
export function getCreatureHitDieBySize(size: CreatureSize): CreatureHitDie {
  return CREATURE_HIT_DIE_BY_SIZE[size];
}

/**
 * Число костей хитов из формулы стат-блока.
 *
 * Существа из компендиума приходят с одной формулой, без разобранных полей
 * `hitDie`/`hitDiceCount`: число костей — единственное, что из неё нужно, кость
 * и бонус дальше считаются заново по правилам.
 *
 * Строка формулы приходит из записи мира или компендиума и там бывает пустой,
 * `null` или отсутствует вовсе (текстовые хиты, старые миры) — такая запись
 * читается как «костей нет», а не роняет смену размера.
 *
 * @param formula - формула хитов (напр. «4к10 + 4»)
 * @returns число костей, либо `undefined`, если кубикового слагаемого нет
 */
export function parseCreatureHitDiceCount(
  formula: unknown,
): number | undefined {
  if (typeof formula !== 'string') {
    return undefined;
  }

  const count = findFirstDiceTerm(formula)?.count;

  return count !== undefined && count > 0 ? count : undefined;
}

/**
 * Плоский бонус к хитам: модификатор Телосложения за каждую кость хитов.
 *
 * @param hitDiceCount - число костей хитов
 * @param constitutionModifier - модификатор Телосложения
 * @returns бонус к хитам (может быть отрицательным)
 */
export function calculateCreatureHitPointsBonus(
  hitDiceCount: number,
  constitutionModifier: number,
): number {
  return hitDiceCount * constitutionModifier;
}

/**
 * Формула хитов существа строкой стат-блока: «4к10 + 4», «2к8», «1к4 - 1».
 *
 * @param hitDiceCount - число костей хитов
 * @param hitDie - кость хитов
 * @param bonus - плоский бонус
 * @returns формула хитов
 */
export function formatCreatureHitPointsFormula(
  hitDiceCount: number,
  hitDie: CreatureHitDie,
  bonus: number,
): string {
  const dicePart = `${hitDiceCount}${HIT_DICE_FORMULA_LETTER}${hitDie}`;

  if (bonus === 0) {
    return dicePart;
  }

  const sign = bonus > 0 ? '+' : '-';

  return `${dicePart} ${sign} ${Math.abs(bonus)}`;
}

/**
 * Среднее хитов по формуле, как его печатает стат-блок: среднее кости на число
 * костей, округлённое вниз, плюс бонус; не меньше одного хита.
 *
 * @param hitDiceCount - число костей хитов
 * @param hitDie - кость хитов
 * @param bonus - плоский бонус
 * @returns среднее хитов
 */
export function calculateCreatureAverageHitPoints(
  hitDiceCount: number,
  hitDie: CreatureHitDie,
  bonus: number,
): number {
  const dieAverage = (hitDie + 1) / 2;

  return Math.max(
    MIN_CREATURE_AVERAGE_HIT_POINTS,
    Math.floor(hitDiceCount * dieAverage) + bonus,
  );
}

/**
 * Модификатор Телосложения, от которого считается формула хитов существа.
 *
 * Берётся по записи листа: значение характеристики и свои бонусы к ней (пояс,
 * домашнее правило). Активные эффекты сюда не входят — формула описывает
 * стат-блок, а эффект временно двигает итог поверх него.
 *
 * @param creature - существо
 * @returns модификатор Телосложения для формулы хитов
 */
export function getCreatureHitDiceConstitutionModifier(
  creature: DnDCreature,
): number {
  const context: DnDCustomBonusContext = {
    abilityMods: getActorAbilityModifiers(creature),
    proficiencyBonus: getCreatureProficiencyBonus(creature),
  };

  const bonuses =
    parseAbilityBonuses(creature.system.abilityBonuses).constitution ?? [];

  const score =
    creature.system.abilities.constitution
    + getCustomBonusesValue(context, bonuses);

  return calculateAbilityModifier(score);
}

/**
 * Переносит запас хитов на новое среднее.
 *
 * Максимум идёт за средним, пока его не задали отдельно: у существа, чей
 * `max` равен прежнему среднему, хиты и должны расти вместе с Телосложением.
 * Заданный вручную или брошенный по формуле максимум не трогается. Текущие
 * хиты подрезаются под новый потолок, а полные так и остаются полными.
 *
 * @param previous - хиты до пересчёта
 * @param average - новое среднее по формуле
 * @returns поля запаса, которые нужно переписать (пусто — запас свой)
 */
function carryHitPointsPool(
  previous: CreatureHitPoints,
  average: number,
): Partial<Pick<CreatureHitPoints, 'max' | 'current'>> {
  if (previous.max === undefined || previous.max !== previous.average) {
    return {};
  }

  if (previous.current === undefined) {
    return { max: average };
  }

  const wasFull = previous.current === previous.max;

  return {
    max: average,
    current: wasFull ? average : Math.min(previous.current, average),
  };
}

/** От чего считается формула хитов существа */
export interface CreatureHitDiceRuleInput {
  /** Размер существа — задаёт кость */
  size: CreatureSize;
  /** Модификатор Телосложения — задаёт бонус за каждую кость */
  constitutionModifier: number;
  /**
   * Число костей: из окна здоровья. Без него берётся записанное, а у существа
   * из компендиума — из формулы.
   */
  hitDiceCount?: number;
}

/**
 * Пересобирает хиты существа по правилам: кость по размеру, бонус по
 * Телосложению, формула и среднее — из них; запас хитов переносится по
 * {@link carryHitPointsPool}.
 *
 * Хиты без кубиковой формулы (текстовые, вроде «половина хитов призывателя»)
 * возвращаются как есть. Когда пересчёт ничего не меняет, возвращается тот же
 * объект — вызывающий по этому узнаёт, что записывать нечего.
 *
 * @param hitPoints - хиты существа по записи
 * @param input - размер, модификатор Телосложения и, при желании, число костей
 * @returns хиты по правилам либо исходный объект, если менять нечего
 */
export function buildCreatureHitPoints(
  hitPoints: CreatureHitPoints,
  input: CreatureHitDiceRuleInput,
): CreatureHitPoints {
  const hitDiceCount =
    input.hitDiceCount
    ?? hitPoints.hitDiceCount
    ?? parseCreatureHitDiceCount(hitPoints.formula);

  if (hitDiceCount === undefined) {
    return hitPoints;
  }

  const hitDie = getCreatureHitDieBySize(input.size);

  const bonus = calculateCreatureHitPointsBonus(
    hitDiceCount,
    input.constitutionModifier,
  );

  const formula = formatCreatureHitPointsFormula(hitDiceCount, hitDie, bonus);

  const average = calculateCreatureAverageHitPoints(
    hitDiceCount,
    hitDie,
    bonus,
  );

  const isUnchanged =
    hitPoints.hitDie === hitDie
    && hitPoints.hitDiceCount === hitDiceCount
    && hitPoints.bonus === bonus
    && hitPoints.formula === formula
    && hitPoints.average === average;

  if (isUnchanged) {
    return hitPoints;
  }

  return {
    ...hitPoints,
    hitDie,
    hitDiceCount,
    bonus,
    formula,
    average,
    ...carryHitPointsPool(hitPoints, average),
  };
}

/**
 * Хиты существа по правилам от его записи: размер и Телосложение берутся с
 * листа.
 *
 * Единая точка для листа: размер меняют и в шапке, и масштабом токена в
 * настройках, Телосложение — плиткой и своими бонусами, а формула обязана
 * сойтись по любому из путей.
 *
 * Запись старого мира или компендиума может прийти без блока хитов вовсе —
 * тогда пересчитывать нечего, и смена размера об это не спотыкается.
 *
 * @param creature - существо
 * @returns хиты по правилам, исходный объект, если менять нечего, либо
 * `undefined` у существа без блока хитов
 */
export function resolveCreatureHitPointsByRules(
  creature: DnDCreature,
): CreatureHitPoints | undefined {
  const hitPoints: CreatureHitPoints | undefined = creature.system.hitPoints;

  if (!hitPoints) {
    return undefined;
  }

  return buildCreatureHitPoints(hitPoints, {
    size: creature.system.size,
    constitutionModifier: getCreatureHitDiceConstitutionModifier(creature),
  });
}
