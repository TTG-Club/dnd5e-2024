/**
 * «Преуспеть вместо провала» — вопрос владельцу после проваленного спасброска.
 *
 * Итог спасброска меняется ДО того, как по нему лягут урон и эффекты: править
 * уже отправленное сообщение чата ядро не умеет, а откатывать наложенное —
 * значит второй раз гонять весь разбор. Поэтому спрашивают там, где бросок
 * только что посчитан, — у того, кто бросал:
 * - управляет носителем сам (владелец персонажа, ведущий у своего существа) —
 *   окно вопроса открывается у него же, согласие тратит ресурс здесь;
 * - бросал за чужое существо (игрок кастует в босса без владельца) — вопрос
 *   уходит ведущему каналом запросов; ресурс списывает сам ведущий, и «да»
 *   засчитывается, только если ответил ведущий.
 *
 * Бросок в чате остаётся «провалом», следом идёт строка о замене.
 */

import type { AbilityType } from '@vtt/shared';
import type {
  AvailableSaveOverride,
  DnDSceneEntity,
  SavingThrowResult,
} from '@vtt/shared/system/dnd.js';

import type { SavingThrowTarget } from './useSpellSavingThrows';

import { getRollRequestService } from '@/core/api/rollRequestService';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import {
  cloneEntityData,
  findSaveOverride,
  formatSaveOverrideChatLine,
  formatSaveOverrideQuestion,
  isDndSceneEntity,
  isRollRequestAnswered,
  parseEffectPromptResult,
  SAVE_OVERRIDE_ACCEPT,
  SAVE_OVERRIDE_LABELS,
  SAVE_OVERRIDE_OPTIONS,
  SAVE_OVERRIDE_REQUEST_KIND,
  spendSaveOverride,
  withRequestSource,
} from '@vtt/shared/system/dnd.js';

import { EFFECT_QUESTION_PROMPT_MODAL } from '../ui/effect/constants';
import { changeEntitySheet } from './entitySheetWrite';
import { controlsEntityAsUser, isGameMasterUser } from './gmApprovalRequest';

/** Кто бросал и что — то, что нужно вопросу */
export type SaveOverrideTarget = Pick<
  SavingThrowTarget,
  'entity' | 'ability' | 'sourceEntityId' | 'sourceName'
>;

/**
 * Подписка на снятие чужого запроса (`RequestedRollReply.onCancelled`).
 * Запрос «ведущему» получают все ведущие в сети: ответил один — у остальных
 * вопрос закрывается без траты.
 */
export type SaveOverrideCancelSubscriber = (handler: () => void) => void;

/**
 * Спрашивает текущего пользователя окном вопроса.
 *
 * @param entity - носитель
 * @param ability - характеристика спасброска
 * @param available - чем платить и сколько осталось
 * @param sourceName - что бросали, для заголовка
 * @param onCancelled - подписка на снятие запроса, если спрашивают по нему
 * @returns `true`, если выбрали «преуспеть»
 */
function askLocally(
  entity: DnDSceneEntity,
  ability: AbilityType,
  available: AvailableSaveOverride,
  sourceName: string | undefined,
  onCancelled: SaveOverrideCancelSubscriber | undefined,
): Promise<boolean> {
  const { openModal, closeModal } = useModalManager();

  return new Promise((resolve) => {
    const modalId = openModal(EFFECT_QUESTION_PROMPT_MODAL, {
      allowMultiple: true,
      question: formatSaveOverrideQuestion(
        entity.name,
        ability,
        available.source.label,
        available.remaining,
      ),
      options: SAVE_OVERRIDE_OPTIONS,
      // Закрыть без ответа — то же «оставить провал»: крестик был бы третьей
      // кнопкой с тем же смыслом
      hideCancel: true,
      sourceName,
      onAnswer: (optionId: string) => {
        resolve(optionId === SAVE_OVERRIDE_ACCEPT);
      },
      onCancel: () => {
        resolve(false);
      },
    });

    // Окно не открылось — провал остаётся провалом, действие не висит
    if (!modalId) {
      resolve(false);

      return;
    }

    // Запрос сняли (ответил другой ведущий, истёк срок) — решать уже нечего
    onCancelled?.(() => {
      resolve(false);
      closeModal(modalId);
    });
  });
}

/**
 * Списывает единицу и пишет в чат. Зовёт тот, кто вправе менять носителя.
 *
 * @param entity - носитель
 * @param available - чем платить и сколько осталось
 */
export function spendEntitySaveOverride(
  entity: DnDSceneEntity,
  available: AvailableSaveOverride,
): void {
  const chatStore = useChatStore();

  // Носитель перечитывается: списание зовётся посреди разбора спасброска, и
  // копия разбора старше хитов и эффектов сервера
  changeEntitySheet(entity.id, (current) => {
    const spent = cloneEntityData(current);

    Object.assign(spent.system, spendSaveOverride(current, available.source));

    return spent;
  });

  chatStore.sendMessage(
    formatSaveOverrideChatLine(
      entity.name,
      available.source.label,
      available.remaining - 1,
    ),
    'text',
  );
}

/**
 * Спрашивает ведущего: решает и тратит он.
 *
 * @param target - кто бросал и что; `sourceEntityId` — от чьего имени просят
 * @returns `true`, если ведущий выбрал «преуспеть»
 */
async function askGameMaster(target: SaveOverrideTarget): Promise<boolean> {
  const { entity, ability, sourceName } = target;

  const outcome = await getRollRequestService().request({
    entityId: entity.id,
    // Не-ведущий вправе спрашивать только от своей сущности — сервер сверяет
    ...(target.sourceEntityId ? { sourceEntityId: target.sourceEntityId } : {}),
    recipient: 'gm',
    title: withRequestSource(SAVE_OVERRIDE_LABELS.requestTitle, sourceName),
    payload: {
      kind: SAVE_OVERRIDE_REQUEST_KIND,
      ability,
      ...(sourceName ? { sourceName } : {}),
    },
  });

  // Ответ засчитывается только от ведущего: иначе игрок ответил бы сам себе
  return (
    isRollRequestAnswered(outcome)
    && isGameMasterUser(outcome.respondedByUserId)
    && parseEffectPromptResult(outcome.result)?.optionId
      === SAVE_OVERRIDE_ACCEPT
  );
}

/**
 * Есть ли что предлагать: бросок провален, и носителю есть чем заплатить.
 * Без вопроса ответ уходит сразу — ждать нечего.
 *
 * @param entity - кто бросал
 * @param result - итог броска
 * @returns `true`, если владельца надо спросить
 */
export function needsSaveOverrideOffer(
  entity: SaveOverrideTarget['entity'],
  result: SavingThrowResult,
): boolean {
  return (
    !result.passed
    && isDndSceneEntity(entity)
    && findSaveOverride(entity) !== null
  );
}

/**
 * Отвечает инициатору итогом броска — после вопроса владельцу, если он нужен.
 *
 * @param target - кто бросал и что
 * @param result - итог броска
 * @param answer - ответ инициатору
 * @param onCancelled - подписка на снятие запроса, по которому бросали
 */
export function answerWithSaveOverride(
  target: SaveOverrideTarget,
  result: SavingThrowResult,
  answer: (final: SavingThrowResult) => void,
  onCancelled?: SaveOverrideCancelSubscriber,
): void {
  if (!needsSaveOverrideOffer(target.entity, result)) {
    answer(result);

    return;
  }

  void offerSaveOverride(target, result, onCancelled).then(answer);
}

/**
 * Предлагает превратить проваленный спасбросок в успех, если носителю есть чем
 * заплатить. Успешный бросок и носитель без такой возможности проходят как
 * есть.
 *
 * @param target - кто бросал и что
 * @param result - итог броска
 * @param onCancelled - подписка на снятие запроса, по которому бросали
 * @returns итог — успех, если заплатили
 */
export async function offerSaveOverride(
  target: SaveOverrideTarget,
  result: SavingThrowResult,
  onCancelled?: SaveOverrideCancelSubscriber,
): Promise<SavingThrowResult> {
  const { entity, ability, sourceName } = target;

  if (result.passed || !isDndSceneEntity(entity)) {
    return result;
  }

  const available = findSaveOverride(entity);

  if (!available) {
    return result;
  }

  if (controlsEntityAsUser(entity)) {
    const accepted = await askLocally(
      entity,
      ability,
      available,
      sourceName,
      onCancelled,
    );

    if (!accepted) {
      return result;
    }

    spendEntitySaveOverride(entity, available);

    return { ...result, passed: true };
  }

  const accepted = await askGameMaster(target);

  return accepted ? { ...result, passed: true } : result;
}
