/**
 * Расшифровка атаки и урона оружия для подсказок и предпросмотра.
 *
 * Слагаемые приходят готовыми из движка (`describeWeaponAttack` /
 * `describeWeaponDamage`) — здесь только показ: подпись со знаком и пояснение
 * у слагаемого, которого в счёте нет («Мастерство +0 (нет владения)»).
 */

import type { WeaponModifierPart } from '@vtt/shared/system/dnd.js';

import { formatSignedNumber } from './formatSignedNumber';

/**
 * Одно слагаемое строкой: подпись, вклад со знаком и пояснение в скобках.
 *
 * @param part - слагаемое разбора
 * @returns подпись вида «Мастерство +2» / «Мастерство +0 (нет владения)»
 */
export function formatWeaponModifierPart(part: WeaponModifierPart): string {
  const value = `${part.label} ${formatSignedNumber(part.value)}`;

  return part.note ? `${value} (${part.note})` : value;
}

/**
 * Разбор одной строкой — для подсказки плитки и предпросмотра в редакторе.
 *
 * @param parts - слагаемые разбора
 * @returns строка вида «Ловкость +3 · Мастерство +2 · Меткий выстрел +1»
 */
export function formatWeaponModifierParts(parts: WeaponModifierPart[]): string {
  return parts.map(formatWeaponModifierPart).join(' · ');
}
