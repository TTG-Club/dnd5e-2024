/**
 * Просьба к ведущему со стороны клиента: «разрешить ли то, чего правила сами
 * не позволяют». Вопрос уходит каналом запросов ядра с адресатом «ведущий»
 * (`recipient: 'gm'`, VTTG 0.9.547), у ведущего
 * появляется карточка центра запросов ядра (`promptRequestedRoll` →
 * `reply.present`, VTTG 0.9.744), а ответ
 * засчитывается, только если отвечал ведущий ({@link readGmApprovalVerdict}).
 */

import type {
  DnDSceneEntity,
  GmApprovalRequest,
  GmApprovalVerdict,
} from '@vtt/shared/system/dnd.js';

import type { RollVisibility } from '../ui/actor/diceRollTypes';

import { getRollRequestService } from '@/core/api/rollRequestService';
import { useWorldStore } from '@/stores/worldStore';
import { getEntityOwnerIds, isEntityOwner } from '@vtt/shared';
import {
  buildGmApprovalPayload,
  formatGmApprovalTitle,
  readGmApprovalVerdict,
} from '@vtt/shared/system/dnd.js';

import { GM_APPROVAL_REQUESTER_PARTS } from '../ui/actor/constants';

/** О ком и от чьего имени просят */
export interface GmApprovalParties {
  /** Сущность, о которой спрашивают: её имя ведущий видит в плашке ядра */
  aboutEntityId: string;
  /** Сущность просящего: по ней сервер проверяет, вправе ли он просить */
  fromEntityId: string;
}

/**
 * Кто просит ведущего: «Игрок 1 (Плут)» — имя игрока и, в скобках, за кого он
 * просит. Без имени игрока — одно имя персонажа.
 *
 * @param characterName - имя персонажа или существа, за которого просят
 * @returns подпись просящего
 */
export function formatRequesterName(characterName: string): string {
  const username = useWorldStore().currentUser?.username;

  if (!username) {
    return characterName;
  }

  const { characterPrefix, characterSuffix } = GM_APPROVAL_REQUESTER_PARTS;

  return `${username}${characterPrefix}${characterName}${characterSuffix}`;
}

/**
 * Ведущий ли пользователь мира.
 *
 * @param userId - пользователь
 * @returns `true` для ведущего
 */
export function isGameMasterUser(userId: string): boolean {
  return (
    useWorldStore().currentWorld?.users.some(
      (user) => user.id === userId && user.role === 'admin',
    ) ?? false
  );
}

/** Бросок, который видит только ведущий: бросок существа ведущего */
export const GM_ONLY_ROLL: RollVisibility = 'gm';

/**
 * Есть ли у сущности владелец-игрок: персонаж игрока, а не существо ведущего.
 *
 * @param entity - сущность
 * @returns `true`, если среди владельцев есть не ведущий
 */
export function hasPlayerOwner(entity: DnDSceneEntity): boolean {
  return getEntityOwnerIds(entity).some((userId) => !isGameMasterUser(userId));
}

/**
 * Управляет ли текущий пользователь существом: ведущий — любым, игрок — своим.
 *
 * @param entity - существо
 * @returns `true`, если действовать им и тратить его ресурсы вправе он
 */
export function controlsEntityAsUser(entity: DnDSceneEntity): boolean {
  const userId = useWorldStore().connectionState.loggedAsUserId;

  if (!userId) {
    return false;
  }

  return isGameMasterUser(userId) || isEntityOwner(entity, userId);
}

/**
 * Спрашивает ведущего и ждёт его решения.
 *
 * @param request - вопрос ведущему
 * @param parties - о ком и от чьего имени
 * @returns итог просьбы
 */
export async function requestGmApproval(
  request: GmApprovalRequest,
  parties: GmApprovalParties,
): Promise<GmApprovalVerdict> {
  const outcome = await getRollRequestService().request({
    entityId: parties.aboutEntityId,
    sourceEntityId: parties.fromEntityId,
    recipient: 'gm',
    title: formatGmApprovalTitle(request.sourceName),
    payload: buildGmApprovalPayload(request),
  });

  return readGmApprovalVerdict(outcome, isGameMasterUser);
}
