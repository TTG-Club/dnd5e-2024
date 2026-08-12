/**
 * Бонус мастерства листа: итог, его разбор и подсказка плитки.
 *
 * Один расчёт на лист персонажа и лист существа — различается у них только
 * основа: у персонажа она по уровню, у существа по опасности. Всё остальное
 * (своя основа, свои бонусы, перезапись активным эффектом) устроено одинаково,
 * и расходиться числа в двух листах не должны.
 *
 * @module composables/useProficiencyBonus
 */

import type { ComputedRef, MaybeRefOrGetter } from 'vue';

import type { AbilityType } from '@vtt/shared';
import type {
  DnDProficiencyBonusBreakdown,
  DnDProficiencySettings,
} from '@vtt/shared/system/dnd.js';

import { computed, toValue } from 'vue';

import {
  getCustomBonusValue,
  getProficiencyBonusBreakdown,
  parseProficiencySettings,
} from '@vtt/shared/system/dnd.js';

import {
  CUSTOM_BONUS_LABELS,
  PROFICIENCY_SETTINGS_LABELS,
} from '../ui/actor/constants';
import { formatSignedNumber } from '../ui/actor/utils/formatSignedNumber';

/** Исходные данные листа для расчёта бонуса мастерства */
export interface ProficiencyBonusSource {
  /** Запись настройки из листа — она приходит непроверенной, из мира */
  settings: MaybeRefOrGetter<unknown>;

  /** Бонус по правилам: по уровню персонажа либо по опасности существа */
  ruleValue: MaybeRefOrGetter<number>;

  /** Подпись основы по правилам: «По уровню 5», «По опасности 1/2» */
  ruleTitle: MaybeRefOrGetter<string>;

  /** Модификаторы характеристик листа — для бонусов от характеристики */
  abilityMods: MaybeRefOrGetter<Record<AbilityType, number>>;

  /** Итог из разрешённых статов; нет — считается по одной настройке */
  resolvedValue: MaybeRefOrGetter<number | undefined>;
}

/** Бонус мастерства листа для плитки и окна настройки */
export interface ProficiencyBonusState {
  /** Разобранная настройка листа — её же принимает окно настройки */
  settings: ComputedRef<DnDProficiencySettings | undefined>;

  /** Разбор по записанной настройке — без активных эффектов */
  breakdown: ComputedRef<DnDProficiencyBonusBreakdown>;

  /** Итоговый бонус листа: с эффектами, если статы разрешились */
  value: ComputedRef<number>;

  /** Подсказка плитки: из чего сложился итог */
  tooltip: ComputedRef<string>;
}

/**
 * Считает бонус мастерства листа и собирает подсказку к нему.
 *
 * @param source - исходные данные листа
 * @returns настройка, разбор, итог и подсказка
 */
export function useProficiencyBonus(
  source: ProficiencyBonusSource,
): ProficiencyBonusState {
  const settings = computed(() =>
    parseProficiencySettings(toValue(source.settings)),
  );

  const breakdown = computed(() =>
    getProficiencyBonusBreakdown({
      ruleValue: toValue(source.ruleValue),
      settings: settings.value,
      abilityMods: toValue(source.abilityMods),
    }),
  );

  const value = computed(
    () => toValue(source.resolvedValue) ?? breakdown.value.value,
  );

  /**
   * Эффект задаёт бонус целиком, а не прибавкой: слагаемые настройки к его
   * числу не сходятся, и подсказка честнее сказать об этом, чем показать
   * разбор мимо числа в плитке.
   */
  const tooltip = computed(() => {
    if (value.value !== breakdown.value.value) {
      return `${PROFICIENCY_SETTINGS_LABELS.effects} ${formatSignedNumber(value.value)}`;
    }

    const baseTitle = breakdown.value.isCustomBase
      ? PROFICIENCY_SETTINGS_LABELS.baseTitle
      : toValue(source.ruleTitle);

    const parts = [`${baseTitle}: ${formatSignedNumber(breakdown.value.base)}`];

    for (const bonus of settings.value?.bonuses ?? []) {
      const label = bonus.label.trim() || CUSTOM_BONUS_LABELS.unnamed;

      parts.push(
        `${label} ${formatSignedNumber(
          getCustomBonusValue(
            {
              abilityMods: toValue(source.abilityMods),
              proficiencyBonus: breakdown.value.base,
            },
            bonus,
          ),
        )}`,
      );
    }

    return parts.join(' · ');
  });

  return { settings, breakdown, value, tooltip };
}
