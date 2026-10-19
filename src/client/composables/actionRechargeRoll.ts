/**
 * Бросок перезарядки по запросу сервера — сторона адресата: окно к6 у мастера
 * или хозяина существа и бросок без окна при «кидать автоматически».
 *
 * В окне бросающий сам выбирает, кому показать бросок («Все / ГМ /
 * Приватно»); у существа мастера окно открывается скрытым. Автоматический
 * бросок всегда уходит «только мастеру»: его видят мастера и автор — у мастера
 * только он, у игрока он и мастер.
 */

import type {
  ActionRechargeAnswer,
  ActionRechargeRequestPayload,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';
import { useDiceRollerStore } from '@/stores/diceRollerStore';
import {
  ACTION_RECHARGE_REQUEST_KIND,
  formatRechargeOutcome,
  formatRechargeRequestTitle,
  RECHARGE_ROLL_FORMULA,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { SAVING_THROW_ROLL_LABELS } from '../ui/actor/constants';
import { CREATURE_RECHARGE_ROLL_LABELS } from '../ui/creature/constants';
import { openDiceRollWindow } from './diceRollWindow';
import { GM_ONLY_ROLL, hasPlayerOwner } from './gmApprovalRequest';
import { canSendGmOnlyChat } from './gmOnlyChat';

/** Чем окно перезарядки отличается у адресата и у мастера */
export interface ActionRechargeModalOptions {
  /** Ключ окна: повторная доставка того же запроса второго окна не открывает */
  modalKey?: string;
  /** Бросок ЗА адресата: мастер взял запрос на себя */
  takeover?: boolean;
  /** Бросок сделан */
  onResult: (answer: ActionRechargeAnswer) => void;
  /** Окно закрыли, не бросив */
  onCancel: () => void;
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
      onRoll: (total: number) => {
        options.onResult(buildAnswer(total));
      },
      onCancel: options.onCancel,
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
