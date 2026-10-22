/**
 * Отдых и игровые часы мира (VTTG 0.9.743).
 *
 * Отдых всей группы запускает ведущий из меню часов: отдыхают все персонажи
 * игроков, и ядро переводит часы на длительность отдыха — всё, что истекло за
 * отдых, снимается само. Свой отдых игрок берёт только с разрешения ведущего,
 * и часы такой отдых не двигает: время всей группы ведёт ведущий.
 */

import type { GroupRestAction } from '@/core/systems/uiSystemRegistry';
import type {
  DnDActor,
  DnDSceneEntity,
  RestType,
} from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { SECONDS_PER_HOUR } from '@vtt/shared';
import { applyActorRest, isDndActor } from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  REST_APPROVAL_DETAILS,
  REST_APPROVAL_QUESTION,
  REST_DURATION_HOURS,
  REST_ICONS,
  REST_LABELS,
  REST_REFUSAL_TOASTS,
  REST_SHORT_LABELS,
  REST_TYPES,
} from '../ui/actor/constants';
import {
  formatRequesterName,
  hasPlayerOwner,
  isGameMasterUser,
  requestGmApproval,
} from './gmApprovalRequest';
import { runRestWithTriggers } from './restTriggerPrompt';
import { saveEntityFields } from './useEntityDraftWrite';
import { useWorldEntities } from './useWorldEntities';

/** На сколько игровых секунд отдых всей группы переводит часы */
export const REST_DURATION_SECONDS: Record<RestType, number> = {
  short: REST_DURATION_HOURS.short * SECONDS_PER_HOUR,
  long: REST_DURATION_HOURS.long * SECONDS_PER_HOUR,
};

/**
 * Спрашивает ведущего, можно ли отдохнуть. Ведущему спрашивать некого — он
 * отдыхает сразу.
 *
 * @param entity - кто отдыхает
 * @param restType - вид отдыха
 * @returns `true`, если отдых разрешён
 */
export async function confirmRestWithGm(
  entity: DnDSceneEntity,
  restType: RestType,
): Promise<boolean> {
  const userId = useWorldStore().connectionState.loggedAsUserId;

  // Сессия не определилась — кто просит, неизвестно: отдыха нет
  if (!userId) {
    return false;
  }

  if (isGameMasterUser(userId)) {
    return true;
  }

  const restLabel = REST_LABELS[restType].toLowerCase();

  const verdict = await requestGmApproval(
    {
      question: `${formatRequesterName(entity.name)} ${REST_APPROVAL_QUESTION} ${restLabel}.`,
      sourceName: restLabel,
      details: REST_APPROVAL_DETAILS,
    },
    { aboutEntityId: entity.id, fromEntityId: entity.id },
  );

  if (verdict === 'approved') {
    return true;
  }

  useSystemToastStore().add({
    ...REST_REFUSAL_TOASTS[verdict],
    color: 'warning',
  });

  return false;
}

/**
 * Проводит отдых одного персонажа без окна листа: концентрация, вопросы
 * срабатываний «после отдыха» и запись итога. Короткий отдых — без траты
 * костей хитов: их игрок тратит сам, со своего листа.
 *
 * @param actorId - персонаж
 * @param restType - вид отдыха
 */
async function restActor(actorId: string, restType: RestType): Promise<void> {
  const entities = useWorldEntities();
  const actor = entities.findCurrentDndEntity(actorId);

  if (!actor || !isDndActor(actor)) {
    return;
  }

  await runRestWithTriggers(actor, restType, {}, (triggerOptions) => {
    // Персонаж перечитывается: пока ведущий отвечал, он мог измениться
    const fresh = entities.findCurrentDndEntity(actorId);
    const socket = useChatStore().getSocket();

    if (!fresh || !isDndActor(fresh) || !socket) {
      return;
    }

    void saveEntityFields(
      socket,
      fresh,
      applyActorRest(fresh, restType, triggerOptions),
    );
  });
}

/**
 * Персонажи игроков текущего мира: у них есть владелец — не ведущий.
 *
 * @returns персонажи, которые отдыхают вместе с группой
 */
function listPartyActors(): DnDActor[] {
  return (useWorldStore().currentWorld?.actors ?? []).filter(
    (actor): actor is DnDActor => isDndActor(actor) && hasPlayerOwner(actor),
  );
}

/**
 * Отдых всей группы: по очереди у каждого персонажа игрока.
 *
 * @param restType - вид отдыха
 */
export async function runGroupRest(restType: RestType): Promise<void> {
  for (const actor of listPartyActors()) {
    await restActor(actor.id, restType);
  }
}

/** Отдых всей группы для меню игровых часов ведущего */
export const DND_GROUP_RESTS: readonly GroupRestAction[] = REST_TYPES.map(
  (restType) => ({
    id: restType,
    label: REST_LABELS[restType],
    shortLabel: REST_SHORT_LABELS[restType],
    icon: REST_ICONS[restType],
    advanceSeconds: REST_DURATION_SECONDS[restType],
    run: () => runGroupRest(restType),
  }),
);
