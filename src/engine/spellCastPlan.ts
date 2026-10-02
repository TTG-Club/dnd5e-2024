/**
 * Вид каста заклинания: какое окно открыть, что делает его кнопка и каким путём
 * ложатся урон и эффекты.
 *
 * Путей каста несколько (лист персонажа, горячая панель, заклинания существа,
 * применение умения), и раньше каждый решал это своим условием. Условия
 * разошлись: горячая панель открывала окно броска у заклинания со спасброском
 * без урона, окно без формулы катило d20, и итог проверки уходил в разбор как
 * урон. Здесь одно решение на все входы; входы различаются только тем, как
 * они списывают ресурсы и пишут в чат.
 */

import type { DamagePart } from '@vtt/shared';

import type { Spell } from './dndEntities.js';

import { damagePartNeedsOwnResolution } from './damageParts.js';
import { hasSourceTurnSaveDc } from './effectAutomation.js';
import {
  damagePartIsHealing,
  getSpellAttackType,
  getTargetSpellEffects,
  spellHasDamage,
} from './spellUtils.js';

/**
 * Какое окно открывает каст:
 * - `none` — окна нет, каст применяется сразу (заговор, врождённое);
 * - `confirm` — окно без броска: выбор круга и кнопка «Сотворить»;
 * - `roll` — окно броска атаки, урона или лечения.
 */
export type SpellCastWindow = 'none' | 'confirm' | 'roll';

/** Что бросает кнопка окна броска */
export type SpellCastRollKind = 'attack' | 'damage' | 'healing';

/**
 * Каким путём ложатся урон и эффекты:
 * - `single` — одна формула окна, разбор целей одной суммой;
 * - `multiPart` — части урона и эффекты одной записью на цель;
 * - `projectileSeries` — серия бросков атаки снарядов;
 * - `projectileAutoHit` — снаряды без броска атаки;
 * - `effectsOnly` — урона нет, ложатся только эффекты.
 */
export type SpellCastFlow =
  | 'single'
  | 'multiPart'
  | 'projectileSeries'
  | 'projectileAutoHit'
  | 'effectsOnly';

/** Что известно о касте до окна */
export interface SpellCastPlanInput {
  /** Заклинание каста (тип урона на выбор может быть ещё не решён) */
  spell: Spell;
  /**
   * Части урона и лечения ЭТОГО каста: у заговора ступень целиком заменяет
   * части записи, поэтому брать `spell.damageParts` нельзя
   */
  damageParts: readonly DamagePart[];
  /** Каст идёт снарядами (их число больше одного, области и шаблона нет) */
  hasProjectiles: boolean;
  /** Эффекты дают кость-бонус к урону заклинаний */
  hasBonusDamage: boolean;
  /** Заклинание с зарядами: ячейку не тратит, круг не выбирается */
  isInnate: boolean;
  /** Каст лёг шаблоном на карту */
  hasTemplate: boolean;
  /**
   * Тип броска атаки, если его решает вызывающий: у существа заклинание со
   * спасброском или областью броска попадания не делает. `null` — атаки нет.
   * Нет поля — по заклинанию (`getSpellAttackType`)
   */
  attackType?: 'melee' | 'ranged' | null;
  /**
   * Каст с окном броска всегда идёт многочастным путём: у заклинания существа
   * части урона катит окно, одной общей формулы у него нет
   */
  forceMultiPart?: boolean;
}

/** Решение о касте — одно на все входы */
export interface SpellCastPlan {
  /** Какое окно открыть */
  window: SpellCastWindow;
  /** Что бросает окно; только у окна броска */
  rollKind?: SpellCastRollKind;
  /** Каким путём ложатся урон и эффекты */
  flow: SpellCastFlow;
  /** Тип броска атаки; нет — броска попадания нет */
  attackType?: 'melee' | 'ranged';
  /** У каста есть части урона или лечения */
  hasDamage: boolean;
  /** Целям нужен разбор: спасбросок, автопопадание с уроном, снаряды */
  needsTargetResolution: boolean;
  /** У заклинания есть эффекты на цель */
  hasTargetEffects: boolean;
  /** Цель бросает спасбросок заклинания */
  needsSave: boolean;
  /** Целей несколько: область, шаблон или снаряды */
  multiTarget: boolean;
}

/**
 * Нужен ли эффектам на цель разбор оркестратором, а не прямое наложение: свой
 * спасбросок, урон эффекта или повторный спасбросок с Сл 0 («Сл заклинателя»).
 * Прямое наложение ничего из этого не умеет — эффект лёг бы без броска, без
 * урона, а повторный спасбросок против Сл 0 проходился бы всегда.
 *
 * @param spell - заклинание
 * @returns `true`, если хоть один эффект на цель требует разбора
 */
export function targetEffectsNeedResolution(spell: Spell): boolean {
  return getTargetSpellEffects(spell).some(
    (effect) =>
      effect.applySave !== undefined
      || (effect.damageParts?.length ?? 0) > 0
      || hasSourceTurnSaveDc(effect),
  );
}

/**
 * Достаётся ли цели хоть что-то от каста — часть урона/лечения или эффект.
 *
 * Нет — оркестратор звать незачем: целей он не найдёт и напишет в чат «цель
 * не выбрана» к касту, который удался («Щит» ложится только на заклинателя).
 *
 * @param spell - заклинание каста (псевдо-заклинание с эффектами)
 * @param partsCount - сколько частей урона/лечения брошено
 * @returns `true`, если цели есть что получить
 */
export function castReachesTargets(spell: Spell, partsCount: number): boolean {
  return partsCount > 0 || getTargetSpellEffects(spell).length > 0;
}

/**
 * Идёт ли каст многочастным путём — когда части урона и эффекты ложатся ОДНОЙ
 * записью, а не одной общей формулой в окне.
 *
 * Снаряды всегда остаются на одноформульном пути. Многочастный путь нужен,
 * когда есть бонус-урон, частей больше одной, хоть одной части нужен свой
 * разбор, либо это атака с уроном, чьим эффектам на цель нужен разбор: по
 * попаданию (`onHit`) разбор ждал бы окна спасброска эффекта, а урон окна
 * успевал бы записаться раньше и затирался бы.
 *
 * @param context - заклинание, его части урона и признаки каста
 * @param context.spell - заклинание каста
 * @param context.damageParts - части урона/лечения каста
 * @param context.hasProjectiles - каст идёт снарядами (их путь одноформульный)
 * @param context.hasBonusDamage - эффекты дают бонус-урон к этому касту
 * @returns true, если каст идёт многочастным путём
 */
export function castNeedsMultiPart(context: {
  spell: Spell;
  damageParts: readonly DamagePart[];
  hasProjectiles: boolean;
  hasBonusDamage: boolean;
}): boolean {
  const { spell, damageParts, hasProjectiles, hasBonusDamage } = context;

  if (hasProjectiles) {
    return false;
  }

  return (
    hasBonusDamage
    || damageParts.length > 1
    || (damageParts.length > 0
      && getSpellAttackType(spell) !== undefined
      && targetEffectsNeedResolution(spell))
    || damageParts.some(damagePartNeedsOwnResolution)
  );
}

/**
 * Нужен ли целям каста разбор оркестратором: спасбросок заклинания,
 * автопопадание с уроном или распределение снарядов. Окно броска тогда урон
 * само не применяет.
 *
 * Снарядный режим зависит от контекста каста (число снарядов считается от
 * круга ячейки или уровня персонажа), поэтому приходит готовым флагом.
 *
 * @param spell - заклинание
 * @param hasProjectiles - каст идёт снарядами
 * @param hasDamage - у каста есть части урона; по умолчанию — по записи
 * @returns `true`, если цели разбирает оркестратор
 */
export function spellNeedsTargetResolution(
  spell: Spell,
  hasProjectiles = false,
  hasDamage = spellHasDamage(spell),
): boolean {
  return (
    spell.saveType !== 'none'
    || (Boolean(spell.autoHit) && hasDamage)
    || hasProjectiles
  );
}

/**
 * Решает, каким будет каст: окно, кнопка и путь применения.
 *
 * Инвариант: без частей урона или лечения и без броска атаки окна броска не
 * бывает — ни при каком спасброске. Спасбросок бросает цель, а не заклинатель;
 * окно броска без формулы катило бы d20, и его итог уходил бы в разбор как
 * урон.
 *
 * @param input - заклинание и то, что известно о касте до окна
 * @returns решение о касте
 */
export function resolveSpellCastPlan(input: SpellCastPlanInput): SpellCastPlan {
  const { spell, damageParts, hasProjectiles, hasBonusDamage, isInnate } =
    input;

  const attackType =
    input.attackType === undefined
      ? getSpellAttackType(spell)
      : (input.attackType ?? undefined);

  const hasDamage = damageParts.length > 0;
  const hasTargetEffects = getTargetSpellEffects(spell).length > 0;
  const needsSave = spell.saveType !== 'none';

  const multiTarget =
    spell.areaOfEffect !== undefined || input.hasTemplate || hasProjectiles;

  const needsTargetResolution = spellNeedsTargetResolution(
    spell,
    hasProjectiles,
    hasDamage,
  );

  const shared = {
    hasDamage,
    needsTargetResolution,
    hasTargetEffects,
    needsSave,
    multiTarget,
    ...(attackType ? { attackType } : {}),
  };

  if (!hasDamage && !attackType) {
    // Уровневое заклинание тратит ячейку — круг выбирается в окне без броска.
    // Заговору и врождённому выбирать нечего: каст ложится сразу
    return {
      ...shared,
      window: spell.level > 0 && !isInnate ? 'confirm' : 'none',
      flow: 'effectsOnly',
    };
  }

  return {
    ...shared,
    window: 'roll',
    rollKind: resolveRollKind(attackType, damageParts),
    flow: input.forceMultiPart
      ? 'multiPart'
      : resolveRollFlow({
          spell,
          damageParts,
          hasProjectiles,
          hasBonusDamage,
          attackType,
        }),
  };
}

/**
 * Урон, который окно отдаёт в разбор целей. Окно без частей урона катит d20
 * (проверку), а не урон — такой итог в разбор не идёт.
 *
 * @param plan - решение о касте
 * @param rolledTotal - итог окна
 * @returns урон для разбора
 */
export function resolvePlannedDamageTotal(
  plan: Pick<SpellCastPlan, 'hasDamage'>,
  rolledTotal: number,
): number {
  return plan.hasDamage ? rolledTotal : 0;
}

/**
 * Что бросает кнопка окна броска.
 *
 * @param attackType - тип броска атаки
 * @param damageParts - части каста
 * @returns вид броска
 */
function resolveRollKind(
  attackType: 'melee' | 'ranged' | undefined,
  damageParts: readonly DamagePart[],
): SpellCastRollKind {
  if (attackType) {
    return 'attack';
  }

  return damageParts.some((part) => damagePartIsHealing(part))
    ? 'healing'
    : 'damage';
}

/**
 * Путь применения каста с окном броска.
 *
 * @param context - заклинание, части и признаки каста
 * @param context.spell - заклинание
 * @param context.damageParts - части каста
 * @param context.hasProjectiles - снаряды
 * @param context.hasBonusDamage - кость-бонус к урону
 * @param context.attackType - тип броска атаки
 * @returns путь применения
 */
function resolveRollFlow(context: {
  spell: Spell;
  damageParts: readonly DamagePart[];
  hasProjectiles: boolean;
  hasBonusDamage: boolean;
  attackType: 'melee' | 'ranged' | undefined;
}): SpellCastFlow {
  if (context.hasProjectiles) {
    return context.attackType ? 'projectileSeries' : 'projectileAutoHit';
  }

  return castNeedsMultiPart(context) ? 'multiPart' : 'single';
}
