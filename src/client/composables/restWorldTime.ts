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
  GmApprovalVerdict,
  RestType,
} from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { applyActorRest, isDndActor } from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { REST_LABELS } from '../ui/actor/constants';
import {
  hasPlayerOwner,
  isGameMasterUser,
  requestGmApproval,
} from './gmApprovalRequest';
import { runRestWithTriggers } from './restTriggerPrompt';
import { saveEntityFields } from './useEntityDraftWrite';
import { useWorldEntities } from './useWorldEntities';

/** Секунд в игровом часе */
const SECONDS_PER_HOUR = 3600;

/** На сколько игровых секунд отдых всей группы переводит часы */
export const REST_DURATION_SECONDS: Record<RestType, number> = {
  short: SECONDS_PER_HOUR,
  long: 8 * SECONDS_PER_HOUR,
};

/** Значки отдыха — как на кнопках шапки листа */
const REST_ICONS: Record<RestType, string> = {
  short: 'tabler:campfire',
  long: 'tabler:moon',
};

/** Вопрос ведущему: дальше — имя персонажа и вид отдыха */
const REST_APPROVAL_QUESTION = 'просит разрешения:';

/** Что случится по разрешению */
const REST_APPROVAL_DETAILS = 'Игровые часы при этом не сдвинутся.';

/** Уведомления, когда ведущий отдых не разрешил */
const REST_REFUSAL_TOASTS: Record<
  Exclude<GmApprovalVerdict, 'approved'>,
  { title: string; description: string }
> = {
  denied: {
    title: 'Ведущий не разрешил отдых',
    description: 'Отдых не начался.',
  },
  noGameMaster: {
    title: 'Ведущего нет в сети',
    description: 'Отдохнуть можно, когда ведущий будет за столом.',
  },
  unanswered: {
    title: 'Ведущий не ответил',
    description: 'Отдых не начался — попросите ещё раз.',
  },
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

  if (!userId || isGameMasterUser(userId)) {
    return true;
  }

  const verdict = await requestGmApproval(
    {
      question: `${entity.name} ${REST_APPROVAL_QUESTION} ${REST_LABELS[restType].toLowerCase()}.`,
      sourceName: entity.name,
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
export const DND_GROUP_RESTS: readonly GroupRestAction[] = (
  ['short', 'long'] as const
).map((restType) => ({
  id: restType,
  label: REST_LABELS[restType],
  icon: REST_ICONS[restType],
  advanceSeconds: REST_DURATION_SECONDS[restType],
  run: () => runGroupRest(restType),
}));
