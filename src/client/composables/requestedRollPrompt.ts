import type {
  RequestedRollPrompt,
  RequestedRollReply,
} from '@/core/systems/uiSystemRegistry';
import type { TargetChoiceRequestPayload } from '@vtt/shared/system/dnd.js';

import type { SavingThrowTarget } from './useSpellSavingThrows';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  parseSavingThrowRequestPayload,
  parseTargetChoiceRequestPayload,
  resolveAutoSaves,
} from '@vtt/shared/system/dnd.js';

import { EFFECT_TARGET_PROMPT_LABELS } from '../ui/effect/constants';
import { useSpellSavingThrows } from './useSpellSavingThrows';
import { useWorldEntities } from './useWorldEntities';

/** Префикс сообщений слота в консоли */
const REQUESTED_ROLL_LOG_PREFIX = '[RequestedRoll]';

/**
 * Приставка ключа окна: дальше идёт идентификатор запроса. Ключ по запросу
 * нужен, чтобы повторная доставка одного запроса не открыла второе окно.
 */
const REQUESTED_ROLL_MODAL_KEY_PREFIX = 'roll-request:';

/**
 * Окна открытых запросов: идентификатор запроса → идентификатор окна.
 *
 * Ядро может позвать слот по одному запросу повторно (адресат перезагрузил
 * страницу, ГМ взял бросок на себя). Второе окно тогда не открывается —
 * менеджер поднимает прежнее и отдаёт `null`, — но закрывать по снятию
 * запроса всё равно нужно именно его.
 */
const openRequestModals = new Map<string, string>();

/**
 * Открывает окно броска по ЧУЖОМУ запросу — слот `promptRequestedRoll`.
 *
 * Ядро доставляет запрос владельцу сущности и правил не знает: что бросается и
 * против какой сложности, лежит в непрозрачной для него нагрузке, которую
 * положила эта же система на стороне инициатора. Здесь нагрузка разбирается,
 * бросок считается по СВОЕЙ сущности (свои эффекты, преимущество, видимость
 * броска) и уходит обратно инициатору.
 *
 * Возврат `false` означает «это не наш запрос» — ядро тогда покажет свою
 * нейтральную плашку и бросит `fallbackFormula` само.
 *
 * @param request - запрос от ядра: нагрузка, цель, кто просит, признак takeover
 * @param reply - ответ инициатору: ровно один из `answer`/`decline`
 * @returns true, если окно (или мгновенный бросок) взяла на себя система
 */
export function promptRequestedRoll(
  request: RequestedRollPrompt,
  reply: RequestedRollReply,
): boolean {
  // Тем же каналом приходит выбор цели: у него своя метка формы и своё окно
  const choice = parseTargetChoiceRequestPayload(request.payload);

  if (choice) {
    return promptTargetChoice(request, reply, choice);
  }

  const payload = parseSavingThrowRequestPayload(request.payload);

  // Чужая форма нагрузки (другой вид броска, другая система) — не наше дело
  if (!payload) {
    return false;
  }

  const { findCurrentWorldEntity } = useWorldEntities();
  const entity = findCurrentWorldEntity(request.entityId);

  // Сущности в этом мире нет — считать бросок не по чему; пусть ядро бросит
  // нейтральной формулой, чем мы соврём модификатором от нуля
  if (!entity) {
    return false;
  }

  const { openSavingThrowModal, rollSavingThrow } = useSpellSavingThrows();

  const target: SavingThrowTarget = {
    entity,
    ability: payload.ability,
    dc: payload.dc,
    againstMagic: payload.againstMagic,
    againstSpell: payload.againstSpell,
    againstCondition: payload.againstCondition,
    againstConcentration: payload.againstConcentration,
    mode: payload.mode,
    sourceName: payload.sourceName,
  };

  // Авто-спасброски: владелец не хочет окна на каждый спас — бросаем сразу,
  // бросок уходит в чат от его имени, инициатор получает готовый результат
  if (resolveAutoSaves(entity)) {
    reply.answer(rollSavingThrow(target));

    return true;
  }

  const { closeModal } = useModalManager();

  /**
   * По запросу отвечают РОВНО один раз. Закрытие окна ядром (запрос сняли)
   * тоже проходит через этот замок: иначе `notifyCancel` окна прислал бы вслед
   * лишний `decline`.
   */
  let settled = false;

  /**
   * Закрывает запрос: снимает окно с учёта и отдаёт ответ инициатору.
   *
   * @param respond - что сказать инициатору; не зовётся, если уже отвечали
   */
  function settle(respond?: () => void): void {
    if (settled) {
      return;
    }

    settled = true;
    openRequestModals.delete(request.requestId);
    respond?.();
  }

  /**
   * Закрывает окно запроса по снятию: за адресата бросил ГМ, инициатор отозвал
   * запрос или истёк срок. Отвечать по такому окну уже некому.
   */
  function closeOnCancelled(): void {
    const openModalId = openRequestModals.get(request.requestId);

    settle();

    if (openModalId) {
      closeModal(openModalId);
    }
  }

  // Окно по этому запросу уже открыто: ядро доставило его повторно (адресат
  // переподключился). Второе не нужно — ответит первое, со своим замком.
  if (openRequestModals.has(request.requestId)) {
    reply.onCancelled(closeOnCancelled);

    return true;
  }

  const modalId = openSavingThrowModal(target, {
    modalKey: `${REQUESTED_ROLL_MODAL_KEY_PREFIX}${request.requestId}`,
    takeover: request.takeover,
    onResult: (result) => {
      settle(() => reply.answer(result));
    },
    onCancel: () => {
      settle(() => reply.decline());
    },
  });

  // Окна нет и не будет (менеджер нашёл чужое окно с тем же ключом) —
  // отказываемся сразу: инициатор не должен ждать впустую.
  if (!modalId) {
    console.warn(
      `${REQUESTED_ROLL_LOG_PREFIX} Окно спасброска по запросу ${request.requestId} не открылось`,
    );

    settle(() => reply.decline());

    return true;
  }

  openRequestModals.set(request.requestId, modalId);

  reply.onCancelled(closeOnCancelled);

  return true;
}

/**
 * Открывает окно выбора цели по чужому запросу.
 *
 * Кандидатов считает инициатор — у него сцена; здесь их только показывают и
 * возвращают отмеченных. Закрытие окна — отказ, как и у спасброска.
 *
 * @param request - запрос от ядра
 * @param reply - ответ инициатору
 * @param payload - разобранная нагрузка выбора
 * @returns всегда `true`: запрос наш
 */
function promptTargetChoice(
  request: RequestedRollPrompt,
  reply: RequestedRollReply,
  payload: TargetChoiceRequestPayload,
): boolean {
  const { openModal, closeModal } = useModalManager();

  let settled = false;

  /**
   * Отвечают ровно один раз: снятие запроса ядром тоже проходит замком.
   *
   * @param respond - что сказать инициатору
   */
  function settle(respond?: () => void): void {
    if (settled) {
      return;
    }

    settled = true;
    openRequestModals.delete(request.requestId);
    respond?.();
  }

  /** Запрос сняли: окно закрывается, отвечать уже некому */
  function closeOnCancelled(): void {
    const openModalId = openRequestModals.get(request.requestId);

    settle();

    if (openModalId) {
      closeModal(openModalId);
    }
  }

  if (openRequestModals.has(request.requestId)) {
    reply.onCancelled(closeOnCancelled);

    return true;
  }

  const modalId = openModal('EffectTargetPromptModal', {
    _modalKey: `${REQUESTED_ROLL_MODAL_KEY_PREFIX}${request.requestId}`,
    candidates: payload.candidates,
    count: payload.count,
    optional: payload.optional,
    sourceName: payload.sourceName ?? EFFECT_TARGET_PROMPT_LABELS.titleFallback,
    onConfirm: (chosenIds: string[]) => {
      settle(() => {
        reply.answer({ chosenIds });
      });
    },
    onCancel: () => {
      settle(() => reply.decline());
    },
  });

  if (!modalId) {
    console.warn(
      `${REQUESTED_ROLL_LOG_PREFIX} Окно выбора цели по запросу ${request.requestId} не открылось`,
    );

    settle(() => reply.decline());

    return true;
  }

  openRequestModals.set(request.requestId, modalId);

  reply.onCancelled(closeOnCancelled);

  return true;
}
