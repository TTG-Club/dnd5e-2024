import type { Spell } from '@vtt/shared/system/dnd.js';

import { buildEndCastsEvent } from '@vtt/shared/system/dnd.js';

import { emitSystemClientEvent } from './systemClientEvents';

/**
 * Касты заклинаний с концентрацией.
 *
 * У каста один `castId` на все его эффекты — на заклинателе, на целях и у зоны:
 * конец концентрации снимает ровно этот каст. Каст начинается там, где
 * заклинание применяют (горячая панель, лист), а эффекты накладываются глубже —
 * в разборе урона, в выборе целей, в зоне, иногда после ответа игрока. Чтобы
 * не протаскивать id через каждую подпись, начатый каст запоминается по
 * заклинателю и заклинанию; следующий каст того же заклинания его заменяет.
 */

/** Начатые касты: ключ — заклинатель и заклинание */
const activeCastIds = new Map<string, string>();

/**
 * Ключ каста в памяти.
 *
 * @param casterId - заклинатель
 * @param spellId - заклинание
 * @returns ключ
 */
function castMemoryKey(casterId: string, spellId: string): string {
  return `${casterId}|${spellId}`;
}

/**
 * Начинает каст заклинания: у заклинания с концентрацией появляется новый id
 * каста. Без концентрации кастам id не нужен.
 *
 * @param casterId - заклинатель
 * @param spell - заклинание
 * @param castId - id каста: ключ каста вызывающего
 */
export function beginSpellCast(
  casterId: string,
  spell: Pick<Spell, 'id' | 'concentration'>,
  castId: string,
): void {
  if (spell.concentration) {
    activeCastIds.set(castMemoryKey(casterId, spell.id), castId);
  }
}

/**
 * Id идущего каста заклинания с концентрацией.
 *
 * @param casterId - заклинатель
 * @param spell - заклинание
 * @returns id каста либо `undefined`, если концентрации нет или каст не начат
 */
export function resolveSpellCastId(
  casterId: string | undefined,
  spell: Pick<Spell, 'id' | 'concentration'>,
): string | undefined {
  return casterId && spell.concentration
    ? activeCastIds.get(castMemoryKey(casterId, spell.id))
    : undefined;
}

/**
 * Просит сервер закончить касты заклинателя: он снимет их эффекты со всех
 * существ и их зоны.
 *
 * @param casterId - заклинатель
 * @param castIds - касты
 */
export function requestEndCasts(
  casterId: string,
  castIds: readonly string[],
): void {
  if (castIds.length === 0) {
    return;
  }

  emitSystemClientEvent(buildEndCastsEvent(casterId, castIds));
}
