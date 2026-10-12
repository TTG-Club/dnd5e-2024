/**
 * Кто вправе менять урон атаки из карточки чата.
 *
 * «Половина» и «Крит» под нанесённым уроном — поправка собственного удара:
 * их жмёт мастер и автор атаки. «Отменить урон» и «Нанести урон» возвращают и
 * снимают хиты целей заново — это решение мастера; игроку его открывает право
 * роли «Отмена урона из чата», и тогда только над собственной атакой. Над
 * отменённым уроном «Половина» и «Крит» наносят его заново, поэтому там они
 * под тем же правом.
 *
 * @module system/dnd/attackDamageAccess
 */

import type { PermissionKey } from '@vtt/shared';

/**
 * Право роли «Отмена урона из чата» в таблице прав ядра. По умолчанию оно
 * только у мастера; игрокам его выдаёт мастер
 */
export const REVERT_CHAT_DAMAGE_PERMISSION =
  'REVERT_CHAT_DAMAGE' satisfies PermissionKey;

/** Действие над уроном в карточке чата */
export type AttackDamageAction = 'revert' | 'reapply' | 'modes';

/** Почему действие над уроном недоступно */
export type AttackDamageActionRefusal = 'authorOnly' | 'revertForbidden';

/** Кто нажал кнопку и под каким уроном */
export interface AttackDamageActionRequest {
  /** Действие, кнопку которого нажали */
  action: AttackDamageAction;
  /** Нажавший — мастер */
  isGM: boolean;
  /** Нажавший — автор сообщения с атакой */
  isAuthor: boolean;
  /** Урон сейчас нанесён; `false` — отменён */
  isApplied: boolean;
  /** У роли нажавшего есть право «Отмена урона из чата» */
  canRevertDamage: boolean;
}

/**
 * Нужно ли действию право «Отмена урона из чата». Без него такое действие
 * остаётся мастеру.
 *
 * @param action - действие над уроном
 * @param isApplied - урон сейчас нанесён; `false` — отменён
 * @returns `true`, если действие отменяет урон или наносит его заново
 */
export function isAttackDamageRevertAction(
  action: AttackDamageAction,
  isApplied: boolean,
): boolean {
  return action !== 'modes' || !isApplied;
}

/**
 * Причина отказа в действии над уроном. Проверяется в самом действии, а не
 * только показом кнопки: замену дополнения сервер разрешает и автору
 * сообщения, поэтому скрытая кнопка сама по себе ничего не запрещает.
 *
 * @param request - кто нажал и под каким уроном
 * @returns причина отказа или `null`, если действие разрешено
 */
export function resolveAttackDamageActionRefusal(
  request: AttackDamageActionRequest,
): AttackDamageActionRefusal | null {
  if (request.isGM) {
    return null;
  }

  if (!request.isAuthor) {
    return 'authorOnly';
  }

  return isAttackDamageRevertAction(request.action, request.isApplied)
    && !request.canRevertDamage
    ? 'revertForbidden'
    : null;
}
