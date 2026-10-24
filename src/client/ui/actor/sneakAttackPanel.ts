import type { SNEAK_ATTACK_OPTION_CHIP_STYLES } from './constants';

import { DICE_ROLL_LABELS } from './constants';

/**
 * Состояние плашки Скрытой атаки в окне атаки.
 *
 * - `active` — условие выполнено, кости идут к урону;
 * - `declined` — условие выполнено, но игрок отказался добавлять;
 * - `spent` — уже нанесена в этом ходу;
 * - `unavailable` — условие не выполнено при этом режиме и цели.
 */
export type SneakAttackPanelState =
  'active' | 'declined' | 'spent' | 'unavailable';

/** Приём Хитрого удара (или эффект по выбору) кнопкой-чипом плашки */
export interface SneakAttackOptionChip {
  /** id эффекта-кнопки приёма */
  id: string;
  /** Подпись чипа: «Отравить −1к6» */
  label: string;
  /** Выбран для этого удара */
  selected: boolean;
  /** Выбрать сейчас нельзя */
  disabled: boolean;
  /** Почему нельзя — коротко; пусто, если можно */
  reason: string;
  /** Описание приёма для подсказки по наведению */
  hint: string;
  /** Приём Хитрого удара — считается в лимит приёмов за удар */
  cunningStrike: boolean;
}

/**
 * Название приёма без «Хитрый удар: » — заголовок плашки это уже говорит, а
 * чип должен остаться коротким: «Отравить −1к6».
 *
 * @param name - название эффекта-кнопки приёма
 * @returns название для чипа
 */
export function stripCunningStrikePrefix(name: string): string {
  return name.startsWith(DICE_ROLL_LABELS.cunningStrikeNamePrefix)
    ? name.slice(DICE_ROLL_LABELS.cunningStrikeNamePrefix.length)
    : name;
}

/**
 * Почему приём сейчас не выбрать — коротко, для строки под чипами.
 *
 * @param option - приём из показа окна
 * @param option.affordable - ресурса хватает
 * @param option.fitsTarget - цель подходит
 * @param canAdd - выбор проходит по костям и лимиту приёмов
 * @param lacksDice - костей не хватает на цену
 * @returns причина; пусто — выбрать можно
 */
export function describeSneakAttackOptionBlock(
  option: { affordable: boolean; fitsTarget: boolean },
  canAdd: boolean,
  lacksDice: boolean,
): string {
  if (!option.affordable) {
    return DICE_ROLL_LABELS.sneakAttackOptionNoResource;
  }

  if (!option.fitsTarget) {
    return DICE_ROLL_LABELS.sneakAttackOptionTargetUnfit;
  }

  if (canAdd) {
    return '';
  }

  return lacksDice
    ? DICE_ROLL_LABELS.sneakAttackOptionNoDice
    : DICE_ROLL_LABELS.sneakAttackOptionLimit;
}

/**
 * Вид чипа приёма: выбранный, доступный или серый.
 *
 * @param option - приём
 * @returns ключ вида в `SNEAK_ATTACK_OPTION_CHIP_STYLES`
 */
export function pickSneakAttackChipStyle(
  option: Pick<SneakAttackOptionChip, 'selected' | 'disabled'>,
): keyof typeof SNEAK_ATTACK_OPTION_CHIP_STYLES {
  if (option.selected) {
    return 'selected';
  }

  return option.disabled ? 'blocked' : 'idle';
}
