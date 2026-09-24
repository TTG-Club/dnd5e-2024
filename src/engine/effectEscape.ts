/**
 * Действие, снимающее эффект: «вырваться».
 *
 * Правила часто дают жертве выход: «существо может действием совершить
 * проверку Силы (Атлетика) Сл 14 и освободиться». Такое действие совершает
 * человек, поэтому движок здесь только считает Сл, называет проверку и
 * говорит, что снимать по успеху. Сам бросок делает лист, как любую другую
 * проверку навыка.
 *
 * Грабли, ради которых модуль вообще отдельный: Сл «Авто» (0) значит «Сл
 * источника», а у эффекта из компендиума источника нет. Проверка против нуля
 * прошла бы у кого угодно, поэтому нулевая Сл — это ЯВНЫЙ отказ
 * ({@link resolveEffectEscapeDc} отдаёт `null`), а не молчаливый успех.
 *
 * @module system/dnd/effectEscape
 */

import type {
  ActiveEffect,
  EffectEscape,
  EffectEscapeActor,
  EffectEscapeOutcome,
} from './activeEffectTypes.js';
import type { EffectActionCost } from './effectTriggerTypes.js';

import { DEFAULT_ESCAPE_OUTCOME, SOURCE_SAVE_DC } from './activeEffectTypes.js';
import { SKILLS_LABELS } from './consts.js';
import {
  actionCostTakesFeet,
  DEFAULT_EFFECT_MOVE_COST_FEET,
} from './effectTriggerTypes.js';

/** Подпись кнопки «вырваться», пока автор не назвал свою */
export const DEFAULT_ESCAPE_LABEL = 'Вырваться';

/** Подписи цены действия для кнопки и окна */
export const EFFECT_ACTION_COST_LABELS: Record<EffectActionCost, string> = {
  action: 'Действие',
  bonus: 'Бонусное действие',
  reaction: 'Реакция',
  move: 'Перемещение',
  free: 'Без затрат',
};

/** Подписи того, кто может вырваться */
export const EFFECT_ESCAPE_ACTOR_LABELS: Record<EffectEscapeActor, string> = {
  self: 'Носитель',
  adjacent: 'Существо рядом',
};

/** Подписи того, что даёт успех */
export const EFFECT_ESCAPE_OUTCOME_LABELS: Record<EffectEscapeOutcome, string> =
  {
    removeSelf: 'Снять эффект',
    removeCondition: 'Снять состояние',
  };

/**
 * Сл проверки «вырваться».
 *
 * Сл 0 — «Сл источника»: её проставляют при наложении
 * (`stampSourceSaveDcs`). Осталась нулевой — источника не было, и честной
 * сложности у проверки нет: кнопка не действует.
 *
 * @param escape - блок действия
 * @returns сложность либо `null`, если её неоткуда взять
 */
export function resolveEffectEscapeDc(escape: EffectEscape): number | null {
  const dc = escape.check?.dc;

  if (dc === undefined) {
    return null;
  }

  return dc > SOURCE_SAVE_DC ? dc : null;
}

/**
 * Можно ли вырваться из эффекта прямо сейчас: действие есть и его проверку
 * есть против чего бросать.
 *
 * @param effect - эффект
 * @returns `true`, если кнопка действует
 */
export function canEscapeEffect(effect: ActiveEffect): boolean {
  const { escape } = effect;

  if (!escape || effect.disabled) {
    return false;
  }

  // Действие без проверки снимает эффект просто так — Сл ему не нужна
  return escape.check === undefined || resolveEffectEscapeDc(escape) !== null;
}

/**
 * Почему кнопка «вырваться» не действует.
 *
 * @param effect - эффект
 * @returns причина либо `null`, если кнопка действует
 */
export function describeEscapeUnavailable(effect: ActiveEffect): string | null {
  if (!effect.escape || canEscapeEffect(effect)) {
    return null;
  }

  return effect.disabled
    ? 'эффект выключен'
    : 'Сл источника неизвестна — проверка не против чего бросать';
}

/**
 * Подпись кнопки «вырваться»: своя или собранная из проверки и цены.
 *
 * @param effect - эффект с действием
 * @returns подпись кнопки
 */
export function formatEffectEscapeLabel(effect: ActiveEffect): string {
  const { escape } = effect;

  if (!escape) {
    return DEFAULT_ESCAPE_LABEL;
  }

  if (escape.label) {
    return escape.label;
  }

  const dc = resolveEffectEscapeDc(escape);

  if (!escape.check || dc === null) {
    return DEFAULT_ESCAPE_LABEL;
  }

  return `${DEFAULT_ESCAPE_LABEL}: ${SKILLS_LABELS[escape.check.skill]} Сл ${dc}`;
}

/**
 * Подпись цены действия: «Действие», «Перемещение 5 фт».
 *
 * @param cost - цена; нет — без затрат
 * @param moveCostFeet - сколько футов стоит цена `move`
 * @returns подпись цены
 */
export function formatEffectActionCost(
  cost: EffectActionCost | undefined,
  moveCostFeet?: number,
): string {
  if (!cost) {
    return EFFECT_ACTION_COST_LABELS.free;
  }

  if (!actionCostTakesFeet(cost)) {
    return EFFECT_ACTION_COST_LABELS[cost];
  }

  const feet = moveCostFeet ?? DEFAULT_EFFECT_MOVE_COST_FEET;

  return `${EFFECT_ACTION_COST_LABELS.move} ${feet} фт`;
}

/**
 * Что снимает успех: сам эффект или наложенные им состояния.
 *
 * Обратной ссылки «состояние → наложивший его эффект» в данных нет, поэтому
 * «снять состояние» опирается на каст: у эффектов одного каста общий
 * `castId`. Без каста снимается сам эффект — иначе успех не снял бы ничего.
 *
 * @param effect - эффект с действием
 * @param carrierEffects - все эффекты носителя
 * @returns идентификаторы эффектов, которые снимает успех
 */
export function listEffectEscapeRemovals(
  effect: ActiveEffect,
  carrierEffects: readonly ActiveEffect[],
): string[] {
  const outcome = effect.escape?.onSuccess ?? DEFAULT_ESCAPE_OUTCOME;

  if (outcome === 'removeSelf' || !effect.castId) {
    return [effect.id];
  }

  const conditions = carrierEffects
    .filter(
      (entry) =>
        entry.castId === effect.castId && entry.conditionKey !== undefined,
    )
    .map((entry) => entry.id);

  return conditions.length > 0 ? conditions : [effect.id];
}
