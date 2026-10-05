import type { ActiveEffect, Spell } from '@vtt/shared/system/dnd.js';

import { watch } from 'vue';

import {
  buildEndCastsEvent,
  isDndSceneEntity,
  withoutCastEffects,
} from '@vtt/shared/system/dnd.js';

import { rememberSentCastEnd } from './entityCombatWrite';
import { refuseWhileSheetEditing } from './sheetEditLock';
import { emitSystemClientEvent } from './systemClientEvents';
import { useWorldEntities } from './useWorldEntities';

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
 * Круг идущего каста: ключ — заклинатель и заклинание. Круг ячейки выбирают в
 * окне броска, а эффекты накладываются позже и глубже — тот же приём, что с
 * id каста.
 */
const activeCastLevels = new Map<string, number>();

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
 * @param castLevel - круг каста, если он известен заранее (круг наложения из
 *   группы существа); круг ячейки персонажа выбирают позже, в окне броска
 */
export function beginSpellCast(
  casterId: string,
  spell: Pick<Spell, 'id' | 'concentration'>,
  castId: string,
  castLevel?: number,
): void {
  const key = castMemoryKey(casterId, spell.id);

  // Круг прежнего каста к новому не относится
  if (castLevel === undefined) {
    activeCastLevels.delete(key);
  } else {
    activeCastLevels.set(key, castLevel);
  }

  if (spell.concentration) {
    activeCastIds.set(key, castId);
  }
}

/**
 * Запоминает круг идущего каста — круг ячейки, выбранный в окне броска, или
 * круг наложения из группы существа.
 *
 * @param casterId - заклинатель
 * @param spell - заклинание
 * @param castLevel - круг каста
 */
export function setSpellCastLevel(
  casterId: string,
  spell: Pick<Spell, 'id'>,
  castLevel: number,
): void {
  activeCastLevels.set(castMemoryKey(casterId, spell.id), castLevel);
}

/**
 * Круг идущего каста: по нему «Рассеивание магии» решает, снимается ли каст.
 *
 * @param casterId - заклинатель
 * @param spell - заклинание
 * @returns выбранный круг; не выбран (врождённое, заговор, применение
 *   предмета) — базовый круг заклинания
 */
export function resolveSpellCastLevel(
  casterId: string | undefined,
  spell: Pick<Spell, 'id' | 'level'>,
): number {
  const chosen = casterId
    ? activeCastLevels.get(castMemoryKey(casterId, spell.id))
    : undefined;

  return chosen ?? spell.level;
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

  // Эффекты этих кастов лежат в сторе до ответа сервера: полная запись
  // листа, ушедшая следом, не должна их вернуть
  rememberSentCastEnd(casterId, castIds);
}

/**
 * Сколько ждать ответа сервера на конец кастов, прежде чем разбирать цели
 * нового: сервер отвечает за десятки миллисекунд, а потерянный ответ не
 * должен держать каст вечно.
 */
export const CAST_END_WAIT_MS = 1000;

/**
 * Лежат ли ещё где-нибудь в мире эффекты закончившихся кастов заклинателя.
 *
 * @param casterId - заклинатель
 * @param castIds - закончившиеся касты
 * @returns `true`, пока сервер их не снял
 */
export function hasEndedCastEffects(
  casterId: string,
  castIds: ReadonlySet<string>,
): boolean {
  // Тот же отбор, которым сервер снимает каст: без расхождения в том, что
  // считается эффектом каста
  return useWorldEntities()
    .getCurrentWorldEntities()
    .some((entity) => {
      const effects = isDndSceneEntity(entity)
        ? (entity.activeEffects ?? [])
        : [];

      return (
        withoutCastEffects(effects, casterId, castIds).length !== effects.length
      );
    });
}

/**
 * Ждёт, пока ответ сервера снимет эффекты закончившихся кастов: разбор целей
 * нового каста читает стор, и окно спасброска иначе видело бы эффект
 * прежнего («Автоматический провал — из-за… Парализованный»).
 *
 * @param casterId - заклинатель
 * @param castIds - закончившиеся касты; пусто — ждать нечего
 * @param timeoutMs - сколько ждать самое большее
 * @returns выполняется, когда эффектов не осталось или вышло время
 */
export function waitForCastsEnded(
  casterId: string,
  castIds: readonly string[],
  timeoutMs = CAST_END_WAIT_MS,
): Promise<void> {
  const ended = new Set(castIds);

  if (ended.size === 0 || !hasEndedCastEffects(casterId, ended)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let stopWatching: (() => void) | undefined;

    const timer = setTimeout(finish, timeoutMs);

    /** Снимает слежение и отпускает ожидающего */
    function finish(): void {
      clearTimeout(timer);
      stopWatching?.();
      resolve();
    }

    stopWatching = watch(
      () => hasEndedCastEffects(casterId, ended),
      (pending) => {
        if (!pending) {
          finish();
        }
      },
    );
  });
}

/**
 * Кнопка «Прервать концентрацию» листа: сервер закончит каст метки у всех
 * существ и снимет его зону; сама метка уходит тем же исходом.
 *
 * Лист в режиме правки каст не прерывает: черновик мира не видит и продолжал
 * бы показывать снятые эффекты, а его «Сохранить» могло бы вернуть те из них,
 * что владелец успел поправить.
 *
 * @param entityId - чей лист; нет — эффект показан без сущности мира
 * @param effect - метка концентрации
 */
export function endEntityConcentration(
  entityId: string | null | undefined,
  effect: Pick<ActiveEffect, 'concentration' | 'castId' | 'sourceActorId'>,
): void {
  // Лист носителя метки или самого заклинателя в режиме правки
  if (
    refuseWhileSheetEditing(entityId)
    || refuseWhileSheetEditing(effect.sourceActorId)
  ) {
    return;
  }

  if (effect.concentration && effect.castId && effect.sourceActorId) {
    requestEndCasts(effect.sourceActorId, [effect.castId]);
  }
}
