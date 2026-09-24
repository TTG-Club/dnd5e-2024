/**
 * Утилиты для работы с частями урона/лечения заклинаний (`Spell.damageParts`).
 *
 * Из рантайма модуль берёт только `formulaTokens.js` — тот сам ни от чего не
 * зависит, поэтому цикла не будет; всё остальное импортируется типами. Это и
 * позволяет пользоваться модулем из `calculations.ts`.
 */

import type { DamagePart } from '@vtt/shared';

import type { Spell } from './dndEntities.js';

import {
  hasDamageTypeToken,
  hasHealToken,
  hasTargetToken,
} from './formulaTokens.js';

/**
 * Возвращает части урона/лечения заклинания.
 *
 * Единственный источник истины — `spell.damageParts` (legacy-поля
 * `damageFormula`/`damageType`/`isHealing` и их миграция удалены).
 * Если урона нет — пустой массив.
 *
 * @param spell - заклинание
 * @returns массив частей урона/лечения (может быть пустым)
 */
export function getSpellDamageParts(spell: Spell): DamagePart[] {
  return spell.damageParts ?? [];
}

/**
 * Нужен ли части урона собственный разбор при касте — то есть нельзя ли её
 * свести к одной формуле в модалке броска.
 *
 * Своего разбора требует часть, которая: бьёт не по выбранной цели, применяется
 * только по факту урона, либо несёт инлайн-токены (`@dmg`, `@heal`, `@target`) —
 * у них вид, тип и условие решаются на каждой цели отдельно.
 *
 * @param part - часть урона/лечения
 * @returns true, если часть нельзя катать одной общей формулой
 */
export function damagePartNeedsOwnResolution(part: DamagePart): boolean {
  return (
    (part.target ?? 'selected') !== 'selected'
    || Boolean(part.requiresDamage)
    || hasDamageTypeToken(part.formula)
    || hasHealToken(part.formula)
    || hasTargetToken(part.formula)
  );
}
