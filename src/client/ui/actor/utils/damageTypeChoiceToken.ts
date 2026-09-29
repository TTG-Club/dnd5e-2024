import type { DamageTypeChoiceMode } from '@vtt/shared/system/dnd.js';

import { buildDamageTypeChoiceToken } from '@vtt/shared/system/dnd.js';

import { DAMAGE_TYPE_CHOICE_MIN_OPTIONS } from '../constants';

/**
 * Токен типа урона на выбор (`@dmg.choice(…)`) или случайного
 * (`@dmg.random(…)`) из отмеченных в строке урона типов. Типы идут в порядке
 * справочника, а не отметки: один и тот же набор — один и тот же токен, и
 * бросок задаёт по нему один вопрос.
 *
 * @param mode - способ выбора типа
 * @param picked - отмеченные ключи типов урона
 * @param orderedTypes - ключи типов урона в порядке справочника
 * @returns токен либо `null`, если отмечено меньше двух известных типов
 */
export function buildPickedDamageTypeChoiceToken(
  mode: DamageTypeChoiceMode,
  picked: readonly string[],
  orderedTypes: readonly string[],
): string | null {
  const options = orderedTypes.filter((type) => picked.includes(type));

  return options.length >= DAMAGE_TYPE_CHOICE_MIN_OPTIONS
    ? buildDamageTypeChoiceToken({ mode, options })
    : null;
}
