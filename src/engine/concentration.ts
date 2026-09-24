/**
 * Концентрация: эффект-метка на заклинателе, который держит каст.
 *
 * Не отдельный механизм, а обычный эффект со срабатываниями: «получил урон» —
 * спасбросок Телосложения Сл от урона, провал заканчивает каст; «хиты упали до
 * 0» — каст заканчивается. Метку видно в списке эффектов, её срабатывания
 * открываются в окне эффекта, «Боевой заклинатель» — обычный флаг
 * преимущества на спасброски концентрации.
 *
 * Конец каста снимает все эффекты с его `castId`, наложенные этим заклинателем,
 * на всех сущностях мира, и его зону — это делает ядро по `endCasts`.
 */

import type { EffectDuration } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { Spell } from './dndEntities.js';

import { generateId } from '@vtt/shared';

import { ACTIVE_EFFECT_ID_PREFIX } from './activeEffectTypes.js';
import { withInitializedDuration } from './turnEffects.js';

/** Сл спасброска концентрации (2024): половина урона, от 10 до 30 */
export const CONCENTRATION_SAVE_DC_FORMULA =
  'min(30, max(10, floor(@damage / 2)))';

/** Сл концентрации без данных урона — нижняя граница формулы */
const CONCENTRATION_BASE_DC = 10;

/** Приставка имени метки концентрации */
const CONCENTRATION_NAME_PREFIX = 'Концентрация: ';

/** Иконка метки концентрации */
const CONCENTRATION_ICON = 'tabler:brain';

/** Id срабатываний метки концентрации */
export const CONCENTRATION_TRIGGER_IDS = {
  damage: 'concentration.damage',
  hpZero: 'concentration.hpZero',
} as const;

/** Длительность метки по длительности заклинания */
const SPELL_DURATION_UNITS: Partial<
  Record<Spell['durationUnit'], EffectDuration['type']>
> = {
  round: 'rounds',
  minute: 'minutes',
  hour: 'hours',
};

/**
 * Длительность метки концентрации: столько, сколько длится заклинание; без
 * счётной длительности — пока не прервут.
 *
 * @param spell - заклинание
 * @returns длительность метки
 */
export function resolveConcentrationDuration(
  spell: Pick<Spell, 'durationUnit' | 'durationValue'>,
): EffectDuration {
  const type = SPELL_DURATION_UNITS[spell.durationUnit];

  return type
    ? { type, value: Math.max(1, Math.trunc(spell.durationValue || 1)) }
    : { type: 'permanent' };
}

/** Что нужно, чтобы собрать метку концентрации */
export interface ConcentrationEffectInput {
  /** Заклинание, на котором держится концентрация */
  spell: Pick<Spell, 'name' | 'durationUnit' | 'durationValue'>;
  /** Заклинатель */
  casterId: string;
  /** Каст */
  castId: string;
}

/**
 * Метка концентрации на заклинателе.
 *
 * @param input - заклинание, заклинатель и каст
 * @returns эффект-метка
 */
export function buildConcentrationEffect(
  input: ConcentrationEffectInput,
): ActiveEffect {
  return withInitializedDuration({
    id: generateId(ACTIVE_EFFECT_ID_PREFIX),
    name: `${CONCENTRATION_NAME_PREFIX}${input.spell.name}`,
    description: '',
    icon: CONCENTRATION_ICON,
    disabled: false,
    origin: 'spell',
    transfer: false,
    duration: resolveConcentrationDuration(input.spell),
    changes: [],
    flags: [],
    sourceActorId: input.casterId,
    castId: input.castId,
    concentration: true,
    triggers: [
      {
        id: CONCENTRATION_TRIGGER_IDS.damage,
        event: 'damageTaken',
        save: {
          ability: 'constitution',
          dc: CONCENTRATION_BASE_DC,
          dcFormula: CONCENTRATION_SAVE_DC_FORMULA,
        },
        actions: [{ type: 'endCast', on: 'failed' }],
      },
      {
        id: CONCENTRATION_TRIGGER_IDS.hpZero,
        event: 'hpZero',
        actions: [{ type: 'endCast' }],
      },
    ],
  });
}

/**
 * Метки концентрации сущности.
 *
 * @param effects - эффекты сущности
 * @returns метки с кастом
 */
export function listConcentrationEffects(
  effects: readonly ActiveEffect[] | undefined,
): ActiveEffect[] {
  return (effects ?? []).filter(
    (effect) => effect.concentration === true && effect.castId !== undefined,
  );
}

/**
 * Касты, которые держит концентрация сущности.
 *
 * @param effects - эффекты сущности
 * @returns id кастов
 */
export function listConcentrationCastIds(
  effects: readonly ActiveEffect[] | undefined,
): string[] {
  return listConcentrationEffects(effects).flatMap((effect) =>
    effect.castId ? [effect.castId] : [],
  );
}

/**
 * Эффекты без эффектов кастов заклинателя: наложенных им и с `castId` из
 * списка. Чужие эффекты и эффекты других кастов остаются.
 *
 * @param effects - эффекты сущности
 * @param casterId - заклинатель
 * @param castIds - закончившиеся касты
 * @returns эффекты без эффектов этих кастов
 */
export function withoutCastEffects(
  effects: readonly ActiveEffect[],
  casterId: string,
  castIds: ReadonlySet<string>,
): ActiveEffect[] {
  return effects.filter(
    (effect) =>
      effect.castId === undefined
      || !castIds.has(effect.castId)
      || effect.sourceActorId !== casterId,
  );
}
