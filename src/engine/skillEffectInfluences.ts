/**
 * Что сейчас влияет на навык: эффекты и доспех, от которых проверка навыка
 * бросается не так, как по правилам.
 *
 * Число навыка на листе показывает не всё: кость «Наставления» катается только
 * в броске, преимущество и помеха в число не входят вовсе. Без отдельного
 * списка игрок видел бы «+3» и не знал, что к броску добавится 1к4 или что
 * бросок пойдёт с помехой. Список читает те же поля эффектов, что и бросок, —
 * поэтому показанное и брошенное не расходятся.
 *
 * @module system/dnd/skillEffectInfluences
 */

import type { AbilityType, SkillType } from '@vtt/shared';

import type { ActiveEffect, EffectChange } from './activeEffectTypes.js';
import type { AbilityCheckRollFlag } from './attackUtils.js';

import {
  describeChangeValue,
  describeEffectChangeCondition,
} from './activeEffectDescribe.js';
import { ABILITY_CHECK_KEY, isEffectDormant } from './activeEffectTypes.js';
import { listAbilityCheckRollFlags } from './attackUtils.js';
import { ABILITY_LABELS } from './consts.js';
import { isDiceFormulaValue } from './effectPipeline.js';
import { getSkillEffectKey } from './skills.js';

/** Куда тянет влияние: помогает, мешает или просто меняет число */
export type SkillInfluenceTone = 'positive' | 'negative' | 'neutral';

/** Одно влияние на навык */
export interface SkillEffectInfluence {
  /** Откуда оно: название эффекта или «Доспех» */
  source: string;
  /** Что делает: «+1к4 к броску», «помеха» */
  text: string;
  /** Когда действует; пусто — всегда */
  condition: string;
  /** Помогает ли оно броску */
  tone: SkillInfluenceTone;
}

/** Что нужно, чтобы собрать влияния на навык */
export interface SkillEffectInfluenceParams {
  /** Эффекты носителя — те же, что уходят в расчёт листа */
  effects: readonly ActiveEffect[];
  /**
   * Навык правил. Нет — навык свой: ключа под него в системе нет, и на него
   * действует только то, что задевает все проверки или его характеристику
   */
  skill?: SkillType;
  /** Характеристика расчёта навыка — по ней читаются флаги проверок */
  ability: AbilityType;
  /**
   * Итоговые флаги носителя. Помеху от доспеха движок ставит сам, без
   * эффекта, — её источник узнаётся только по флагу, которого нет ни у одного
   * эффекта.
   */
  activeFlags: ReadonlySet<string>;
}

/** Подписи влияний — текст, который движок отдаёт листу */
const INFLUENCE_TEXT_LABELS = {
  advantage: 'преимущество',
  disadvantage: 'помеха',
  toRoll: 'к броску',
  allChecks: 'все проверки',
  abilityChecksPrefix: 'проверки: ',
  armorSource: 'Доспех',
} as const;

/**
 * Подпись флага: «помеха», «помеха (все проверки)» или «помеха (проверки:
 * Ловкость)».
 *
 * @param entry - флаг проверки с охватом
 * @param ability - характеристика проверки
 * @returns подпись
 */
function describeCheckFlag(
  entry: AbilityCheckRollFlag,
  ability: AbilityType,
): string {
  const base = INFLUENCE_TEXT_LABELS[entry.kind];

  if (entry.reach === 'all') {
    return `${base} (${INFLUENCE_TEXT_LABELS.allChecks})`;
  }

  return entry.reach === 'ability'
    ? `${base} (${INFLUENCE_TEXT_LABELS.abilityChecksPrefix}${ABILITY_LABELS[ability]})`
    : base;
}

/** Тон флага: преимущество помогает, помеха мешает */
const FLAG_KIND_TONE: Record<AbilityCheckRollFlag['kind'], SkillInfluenceTone> =
  {
    advantage: 'positive',
    disadvantage: 'negative',
  };

/**
 * Помогает ли строка модификатора броску. Прибавка со знаком минус мешает;
 * замена и прочие режимы просто задают число.
 *
 * @param change - строка модификатора
 * @returns тон влияния
 */
function toneOfChange(change: EffectChange): SkillInfluenceTone {
  if (change.mode !== 'add') {
    return 'neutral';
  }

  return change.value.trim().startsWith('-') ? 'negative' : 'positive';
}

/**
 * Подпись строки модификатора: «+1к4 к броску», «+2 (все проверки)».
 *
 * @param change - строка модификатора
 * @returns подпись
 */
function describeCheckChange(change: EffectChange): string {
  const value = isDiceFormulaValue(change.value)
    ? `${describeChangeValue(change)} ${INFLUENCE_TEXT_LABELS.toRoll}`
    : describeChangeValue(change);

  return change.key === ABILITY_CHECK_KEY
    ? `${value} (${INFLUENCE_TEXT_LABELS.allChecks})`
    : value;
}

/**
 * Условие, при котором действует строка: условие самой строки и условие
 * броска всего эффекта.
 *
 * @param effect - эффект
 * @param change - строка модификатора; нет — речь о флаге эффекта
 * @returns подпись условия; пусто — действует всегда
 */
function describeInfluenceCondition(
  effect: ActiveEffect,
  change?: EffectChange,
): string {
  return [effect.rollCondition, change?.condition]
    .map((condition) => condition?.trim() ?? '')
    .filter((condition) => condition.length > 0)
    .map(describeEffectChangeCondition)
    .join(' и ');
}

/**
 * Всё, что влияет на проверку навыка: прибавки к навыку и ко всем проверкам
 * (числом или костью), преимущество и помеха — с названием источника.
 *
 * @param params - эффекты, навык, его характеристика и итоговые флаги
 * @returns влияния по порядку эффектов; пусто — навык бросается по правилам
 */
export function listSkillEffectInfluences(
  params: SkillEffectInfluenceParams,
): SkillEffectInfluence[] {
  const { effects, skill, ability, activeFlags } = params;
  const skillKey = skill ? getSkillEffectKey(skill) : undefined;
  const checkFlags = listAbilityCheckRollFlags(ability, skill);
  const liveEffects = effects.filter((effect) => !isEffectDormant(effect));

  const fromEffects = liveEffects.flatMap((effect) => [
    ...effect.changes
      .filter(
        (change) => change.key === skillKey || change.key === ABILITY_CHECK_KEY,
      )
      .map<SkillEffectInfluence>((change) => ({
        source: effect.name,
        text: describeCheckChange(change),
        condition: describeInfluenceCondition(effect, change),
        tone: toneOfChange(change),
      })),
    ...checkFlags
      .filter((entry) => effect.flags.includes(entry.flag))
      .map<SkillEffectInfluence>((entry) => ({
        source: effect.name,
        text: describeCheckFlag(entry, ability),
        condition: describeInfluenceCondition(effect),
        tone: FLAG_KIND_TONE[entry.kind],
      })),
  ]);

  // Флаг есть у носителя, но ни один эффект его не ставит — его поставил
  // доспех: помеха Скрытности или доспех без владения
  const fromArmor = checkFlags
    .filter(
      (entry) =>
        activeFlags.has(entry.flag)
        && !liveEffects.some((effect) => effect.flags.includes(entry.flag)),
    )
    .map<SkillEffectInfluence>((entry) => ({
      source: INFLUENCE_TEXT_LABELS.armorSource,
      text: describeCheckFlag(entry, ability),
      condition: '',
      tone: FLAG_KIND_TONE[entry.kind],
    }));

  return [...fromEffects, ...fromArmor];
}

/**
 * Общий тон влияний: все помогают, все мешают или вперемешку.
 *
 * @param influences - влияния на навык
 * @returns тон; вперемешку и без влияний — нейтральный
 */
export function summarizeSkillInfluenceTone(
  influences: readonly SkillEffectInfluence[],
): SkillInfluenceTone {
  if (influences.length === 0) {
    return 'neutral';
  }

  if (influences.every((influence) => influence.tone === 'positive')) {
    return 'positive';
  }

  if (influences.every((influence) => influence.tone === 'negative')) {
    return 'negative';
  }

  return 'neutral';
}
