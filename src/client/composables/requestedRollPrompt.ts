import type {
  RequestedRollPrompt,
  RequestedRollReply,
} from '@/core/systems/uiSystemRegistry';
import type {
  EffectPromptRequestPayload,
  TargetChoiceRequestPayload,
} from '@vtt/shared/system/dnd.js';

import type { SavingThrowTarget } from './useSpellSavingThrows';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  parseEffectPromptRequestPayload,
  parseSavingThrowRequestPayload,
  parseTargetChoiceRequestPayload,
  resolveAutoSaves,
} from '@vtt/shared/system/dnd.js';

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

/** Что не открылось — строка консоли, когда окно запроса не показалось */
const REQUEST_MODAL_FAILURES = {
  save: 'Окно спасброска не открылось',
  choice: 'Окно выбора цели не открылось',
  question: 'Плашка вопроса не открылась',
} as const;

/**
 * Ответ из окна запроса: `respond` говорит инициатору, что выбрали. Зовётся
 * не больше раза — повтор молча пропускается.
 */
type RequestSettler = (respond?: () => void) => void;

/**
 * Открывает окно по чужому запросу и держит его на учёте.
 *
 * По запросу отвечают РОВНО один раз. Закрытие окна ядром (запрос сняли:
 * бросил ГМ, инициатор отозвал, истёк срок) тоже проходит через этот замок:
 * иначе закрытие окна прислало бы вслед лишний `decline`. Окно по запросу,
 * доставленному повторно (адресат переподключился), второй раз не открывается
 * — ответит первое, со своим замком.
 *
 * @param request - запрос от ядра
 * @param reply - ответ инициатору
 * @param open - открывает окно: получает замок ответа и ключ окна, отдаёт
 *   идентификатор окна либо `null`, если окно не открылось
 * @param failure - что не открылось — для консоли
 */
function openTrackedRequestModal(
  request: RequestedRollPrompt,
  reply: RequestedRollReply,
  open: (settle: RequestSettler, modalKey: string) => string | null,
  failure: string,
): void {
  const { closeModal } = useModalManager();

  let settled = false;

  /**
   * Закрывает запрос: снимает окно с учёта и отдаёт ответ инициатору.
   *
   * @param respond - что сказать инициатору; не зовётся, если уже отвечали
   */
  const settle: RequestSettler = (respond) => {
    if (settled) {
      return;
    }

    settled = true;
    openRequestModals.delete(request.requestId);
    respond?.();
  };

  /** Запрос сняли: окно закрывается, отвечать по нему уже некому */
  function closeOnCancelled(): void {
    const openModalId = openRequestModals.get(request.requestId);

    settle();

    if (openModalId) {
      closeModal(openModalId);
    }
  }

  if (openRequestModals.has(request.requestId)) {
    reply.onCancelled(closeOnCancelled);

    return;
  }

  const modalId = open(
    settle,
    `${REQUESTED_ROLL_MODAL_KEY_PREFIX}${request.requestId}`,
  );

  // Окна нет и не будет (менеджер нашёл чужое окно с тем же ключом) —
  // отказываемся сразу: инициатор не должен ждать впустую
  if (!modalId) {
    console.warn(
      `${REQUESTED_ROLL_LOG_PREFIX} ${failure}: запрос ${request.requestId}`,
    );

    settle(() => reply.decline());

    return;
  }

  openRequestModals.set(request.requestId, modalId);

  reply.onCancelled(closeOnCancelled);
}

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

  // И вопрос человеку — общий канал «можете»: согласие на срабатывание, расход
  // реакции, перевод на следующую ступень
  const question = parseEffectPromptRequestPayload(request.payload);

  if (question) {
    return promptEffectQuestion(request, reply, question);
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
    allowWilling: payload.allowWilling,
    sourceName: payload.sourceName,
  };

  // Авто-спасброски: владелец не хочет окна на каждый спас — бросаем сразу,
  // бросок уходит в чат от его имени, инициатор получает готовый результат
  if (resolveAutoSaves(entity)) {
    reply.answer(rollSavingThrow(target));

    return true;
  }

  openTrackedRequestModal(
    request,
    reply,
    (settle, modalKey) =>
      openSavingThrowModal(target, {
        modalKey,
        takeover: request.takeover,
        onResult: (result) => {
          settle(() => reply.answer(result));
        },
        onCancel: () => {
          settle(() => reply.decline());
        },
      }),
    REQUEST_MODAL_FAILURES.save,
  );

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
  const { openModal } = useModalManager();

  openTrackedRequestModal(
    request,
    reply,
    (settle, modalKey) =>
      openModal('EffectTargetPromptModal', {
        _modalKey: modalKey,
        candidates: payload.candidates,
        count: payload.count,
        optional: payload.optional,
        sourceName: payload.sourceName,
        onConfirm: (chosenIds: string[]) => {
          settle(() => reply.answer({ chosenIds }));
        },
        onCancel: () => {
          settle(() => reply.decline());
        },
      }),
    REQUEST_MODAL_FAILURES.choice,
  );

  return true;
}

/**
 * Открывает плашку вопроса человеку по чужому запросу.
 *
 * Варианты ответа приходят в нагрузке закрытым списком; инициатор сверяет
 * ответ с тем же списком, поэтому окно только показывает их и возвращает
 * выбранный ключ. Закрытие — отказ, как и у спасброска.
 *
 * @param request - запрос от ядра
 * @param reply - ответ инициатору
 * @param payload - разобранная нагрузка вопроса
 * @returns всегда `true`: запрос наш
 */
function promptEffectQuestion(
  request: RequestedRollPrompt,
  reply: RequestedRollReply,
  payload: EffectPromptRequestPayload,
): boolean {
  const { openModal } = useModalManager();

  openTrackedRequestModal(
    request,
    reply,
    (settle, modalKey) =>
      openModal('EffectQuestionPromptModal', {
        _modalKey: modalKey,
        question: payload.question,
        options: payload.options,
        sourceName: payload.sourceName,
        effectSummary: payload.effectSummary,
        onAnswer: (optionId: string) => {
          settle(() => reply.answer({ optionId }));
        },
        onCancel: () => {
          settle(() => reply.decline());
        },
      }),
    REQUEST_MODAL_FAILURES.question,
  );

  return true;
}
