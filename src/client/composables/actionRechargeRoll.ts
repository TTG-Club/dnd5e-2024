/**
 * Бросок перезарядки по запросу сервера — сторона адресата: окно к6 у мастера
 * или хозяина существа и бросок без окна при «кидать автоматически».
 *
 * В окне бросающий сам выбирает, кому показать бросок («Все / ГМ /
 * Приватно»); у существа мастера окно открывается скрытым. Автоматический
 * бросок всегда уходит «только мастеру»: его видят мастера и автор — у мастера
 * только он, у игрока он и мастер.
 *
 * Запрос, которому не нашлось хозяина в сети, ядро отдаёт всем ведущим сразу,
 * и автоматический бросок без очереди сделал бы каждый из них. Поэтому
 * адресаты встают в очередь по порядку пользователей мира: первый бросает
 * сразу, следующий — с задержкой и только если запрос ещё не снят. Кто в сети,
 * система не знает (пробел SDK) — очередь идёт по всем, и ведущий не в сети
 * просто задерживает следующего на шаг.
 */

import type { RequestedRollReply } from '@/core/systems/uiSystemRegistry';
import type {
  ActionRechargeAnswer,
  ActionRechargeRequestPayload,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';
import { useDiceRollerStore } from '@/stores/diceRollerStore';
import { useWorldStore } from '@/stores/worldStore';
import { getEntityOwnerIds, isEntityOwner } from '@vtt/shared';
import {
  ACTION_RECHARGE_REQUEST_KIND,
  formatRechargeOutcome,
  formatRechargeRequestTitle,
  getRechargeThreshold,
  RECHARGE_ROLL_FORMULA,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { SAVING_THROW_ROLL_LABELS } from '../ui/actor/constants';
import { CREATURE_RECHARGE_ROLL_LABELS } from '../ui/creature/constants';
import { openDiceRollWindow } from './diceRollWindow';
import {
  GM_ONLY_ROLL,
  hasPlayerOwner,
  isGameMasterUser,
} from './gmApprovalRequest';
import { canSendGmOnlyChat } from './gmOnlyChat';

/** Шаг очереди автоматического броска между адресатами, мс */
const AUTO_ROLL_QUEUE_STEP_MS = 1500;

/** Чем окно перезарядки отличается у адресата и у мастера */
export interface ActionRechargeModalOptions {
  /** Ключ окна: повторная доставка того же запроса второго окна не открывает */
  modalKey?: string;
  /** Бросок ЗА адресата: мастер взял запрос на себя */
  takeover?: boolean;
  /** Бросок сделан */
  onResult: (answer: ActionRechargeAnswer) => void;
  /**
   * Окно закрыли, не бросив. У броска по чужому запросу (есть `onDecline`)
   * это не отказ: окно лишь спрятали, запрос ждёт дальше
   */
  onCancel: () => void;
  /**
   * Отказ от чужого запроса — кнопка-иконка рядом с кнопкой броска. Только у
   * броска по запросу
   */
  onDecline?: () => void;
}

/**
 * Ответ инициатору.
 *
 * @param total - выпавшее на к6
 * @returns ответ
 */
function buildAnswer(total: number): ActionRechargeAnswer {
  return { kind: ACTION_RECHARGE_REQUEST_KIND, total };
}

/**
 * Открывает окно броска перезарядки. Бросок существа мастера по умолчанию
 * скрыт от игроков: готово ли дыхание дракона, им знать не положено.
 *
 * @param entity - существо
 * @param payload - нагрузка запроса
 * @param options - ключ окна, признак броска за адресата и исход
 * @returns идентификатор окна либо `null`, если окно с этим ключом уже открыто
 */
export function openActionRechargeModal(
  entity: DnDSceneEntity,
  payload: ActionRechargeRequestPayload,
  options: ActionRechargeModalOptions,
): string | null {
  const title = formatRechargeRequestTitle(
    payload.actionName,
    payload.recharge,
  );

  return openDiceRollWindow(
    {
      title: options.takeover
        ? `${SAVING_THROW_ROLL_LABELS.takeoverPrefix}${title}`
        : title,
      rollLabel: `${title}${SAVING_THROW_ROLL_LABELS.nameSeparator}${entity.name}`,
      rollButtonText: CREATURE_RECHARGE_ROLL_LABELS.button,
      actorName: entity.name,
      formula: RECHARGE_ROLL_FORMULA,
      // Порог перезарядки как Сл: подпись броска в чате сама скажет, успех
      // это или провал
      targetDc: getRechargeThreshold(payload.recharge),
      onRoll: (total: number) => {
        options.onResult(buildAnswer(total));
      },
      onCancel: options.onCancel,
      ...(options.onDecline ? { onDecline: options.onDecline } : {}),
      // Окно по умолчанию открыто всем; у существа ведущего — только ему
      ...(hasPlayerOwner(entity)
        ? {}
        : { initialRollVisibility: GM_ONLY_ROLL }),
    },
    options.modalKey === undefined ? {} : { modalKey: options.modalKey },
  );
}

/**
 * Бросает перезарядку без окна — «кидать автоматически». Старый хост
 * сообщение «только мастеру» не скрыл бы — тогда итог показывается одному
 * бросившему уведомлением.
 *
 * @param entity - существо
 * @param payload - нагрузка запроса
 * @returns ответ инициатору
 */
export function rollActionRecharge(
  entity: DnDSceneEntity,
  payload: ActionRechargeRequestPayload,
): ActionRechargeAnswer {
  const rollData = useDiceRollerStore().parseAndRoll(RECHARGE_ROLL_FORMULA);

  const outcome = formatRechargeOutcome(
    entity.name,
    payload.actionName,
    payload.recharge,
    rollData.total,
  );

  if (canSendGmOnlyChat()) {
    useChatStore().sendMessage(
      RECHARGE_ROLL_FORMULA,
      'roll',
      { ...rollData, label: outcome },
      undefined,
      {
        speakerEntityId: entity.id,
        gmOnly: true,
      },
    );
  } else {
    useSystemToastStore().add({
      title: CREATURE_RECHARGE_ROLL_LABELS.autoTitle,
      description: outcome,
      color: 'info',
    });
  }

  return buildAnswer(rollData.total);
}

/**
 * Место текущего пользователя в очереди адресатов: хозяева существа, если он
 * хозяин, иначе ведущие мира. Порядок — по id, одинаковый у всех клиентов.
 *
 * @param entity - существо
 * @returns место с нуля; `0`, если пользователя в очереди нет
 */
function resolveAutoRollQueuePlace(entity: DnDSceneEntity): number {
  const worldStore = useWorldStore();
  const userId = worldStore.connectionState.loggedAsUserId;

  if (!userId) {
    return 0;
  }

  const queue = isEntityOwner(entity, userId)
    ? [...getEntityOwnerIds(entity)]
    : (worldStore.currentWorld?.users ?? [])
        .map((user) => user.id)
        .filter(isGameMasterUser);

  return Math.max(0, queue.sort().indexOf(userId));
}

/**
 * Автоматический бросок по запросу — в свою очередь: первый адресат бросает
 * сразу, остальные ждут и бросают, только если запрос никто не снял.
 *
 * @param entity - существо
 * @param payload - нагрузка запроса
 * @param reply - ответ инициатору
 */
export function answerActionRechargeInTurn(
  entity: DnDSceneEntity,
  payload: ActionRechargeRequestPayload,
  reply: RequestedRollReply,
): void {
  let isCancelled = false;

  reply.onCancelled(() => {
    isCancelled = true;
  });

  setTimeout(
    () => {
      if (!isCancelled) {
        reply.answer(rollActionRecharge(entity, payload));
      }
    },
    resolveAutoRollQueuePlace(entity) * AUTO_ROLL_QUEUE_STEP_MS,
  );
}
