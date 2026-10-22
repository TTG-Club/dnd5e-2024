/**
 * Сколько эффекту осталось по игровым часам мира: строка для карточки и списка
 * эффектов. Срок по часам ставит `settleEffectsByWorldTime` (`expiresAt`), а
 * текущее время приходит от хоста — клиент досчитывает его раз в секунду.
 */

import type { EffectDuration } from './activeEffectTypes.js';

import {
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '@vtt/shared';

import { DND_SECONDS_PER_ROUND, ROUND_PLURAL_FORMS } from './consts.js';
import { pluralizePrice } from './effectPayTypes.js';

/**
 * Дополняет число нулём слева до двух знаков.
 *
 * @param value - число от 0 до 59
 * @returns строка из двух цифр
 */
function padTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Игровые секунды в виде, удобном глазу: «45 с», «9:40», «2 ч 05 мин»,
 * «3 дн. 4 ч».
 *
 * @param seconds - сколько игровых секунд (не меньше нуля)
 * @returns строка остатка
 */
export function formatGameTimeLeft(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));

  if (whole < SECONDS_PER_MINUTE) {
    return `${whole} с`;
  }

  if (whole < SECONDS_PER_HOUR) {
    return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${padTwoDigits(whole % SECONDS_PER_MINUTE)}`;
  }

  if (whole < SECONDS_PER_DAY) {
    const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);

    return `${Math.floor(whole / SECONDS_PER_HOUR)} ч ${padTwoDigits(minutes)} мин`;
  }

  const hours = Math.floor((whole % SECONDS_PER_DAY) / SECONDS_PER_HOUR);

  return `${Math.floor(whole / SECONDS_PER_DAY)} дн. ${hours} ч`;
}

/**
 * Остаток срока эффекта по игровым часам. У срока в раундах рядом с временем
 * стоят и раунды: в бою мастер считает именно их.
 *
 * @param duration - длительность наложенного эффекта
 * @param worldTime - текущее игровое время, секунды; `null` — часов у хоста нет
 * @returns «0:12 (2 раунда)», «9:40» либо `null`, если срок не по часам
 */
export function describeEffectTimeLeft(
  duration: EffectDuration,
  worldTime: number | null,
): string | null {
  if (typeof duration.expiresAt !== 'number' || worldTime === null) {
    return null;
  }

  const seconds = Math.max(0, duration.expiresAt - worldTime);
  const time = formatGameTimeLeft(seconds);

  if (duration.type !== 'rounds') {
    return time;
  }

  const rounds = Math.max(1, Math.ceil(seconds / DND_SECONDS_PER_ROUND));

  return `${time} (${rounds} ${pluralizePrice(rounds, ROUND_PLURAL_FORMS)})`;
}
