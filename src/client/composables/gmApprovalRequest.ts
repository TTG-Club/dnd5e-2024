/**
 * Просьба к ведущему со стороны клиента: «разрешить ли то, чего правила сами
 * не позволяют». Вопрос уходит каналом запросов ядра с адресатом «ведущий»
 * (`recipient: 'gm'`, README § «Чего не хватает», п. 25), у ведущего
 * открывается окно вопроса
 * (`EffectQuestionPromptModal` через `promptRequestedRoll`), а ответ
 * засчитывается, только если отвечал ведущий ({@link readGmApprovalVerdict}).
 */

import type {
  DnDSceneEntity,
  GmApprovalRequest,
  GmApprovalVerdict,
} from '@vtt/shared/system/dnd.js';

import { getRollRequestService } from '@/core/api/rollRequestService';
import { useWorldStore } from '@/stores/worldStore';
import { isEntityOwner } from '@vtt/shared';
import {
  buildGmApprovalPayload,
  formatGmApprovalTitle,
  readGmApprovalVerdict,
} from '@vtt/shared/system/dnd.js';

/** О ком и от чьего имени просят */
export interface GmApprovalParties {
  /** Сущность, о которой спрашивают: её имя ведущий видит в плашке ядра */
  aboutEntityId: string;
  /** Сущность просящего: по ней сервер проверяет, вправе ли он просить */
  fromEntityId: string;
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
