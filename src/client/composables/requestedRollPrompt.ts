import type {
  RequestCardAction,
  RequestCardPickOption,
  RequestedRollCard,
  RequestedRollPrompt,
  RequestedRollReply,
} from '@/core/systems/uiSystemRegistry';
import type {
  AbilityCheckRequestPayload,
  ActionRechargeRequestPayload,
  EffectPromptOption,
  EffectPromptRequestPayload,
  SaveOverrideRequestPayload,
  TargetChoiceCandidate,
  TargetChoiceRequestPayload,
} from '@vtt/shared/system/dnd.js';

import type { SavingThrowTarget } from './useSpellSavingThrows';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  EFFECT_PROMPT_CONFIRM,
  findSaveOverride,
  formatSaveOverrideQuestion,
  isDndCreature,
  parseAbilityCheckRequestPayload,
  parseActionRechargeRequestPayload,
  parseEffectPromptRequestPayload,
  parseSaveOverrideRequestPayload,
  parseSavingThrowRequestPayload,
  parseTargetChoiceRequestPayload,
  readAutoRecharge,
  resolveAutoSaves,
  SAVE_OVERRIDE_ACCEPT,
  SAVE_OVERRIDE_DECLINE,
  SAVE_OVERRIDE_OPTIONS,
} from '@vtt/shared/system/dnd.js';

import {
  EFFECT_QUESTION_PROMPT_LABELS,
  REQUEST_ANSWER_CHAT,
  REQUEST_CARD,
} from '../ui/effect/constants';
import {
  answerActionRechargeInTurn,
  openActionRechargeModal,
} from './actionRechargeRoll';
import { postRequestAnswerToChat } from './requestAnswerChat';
import { openRequestedCheckModal } from './requestedCheckRoll';
import {
  answerWithSaveOverride,
  spendEntitySaveOverride,
} from './saveOverrideOffer';
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
 * Ядро может позвать слот по одному запросу повторно: адресат переподключился
 * или нажал на карточке центра запросов «К окну броска». Второе окно тогда не
 * открывается — прежнее поднимается наверх (и разворачивается из шторки), а
 * закрывать по снятию запроса всё равно нужно именно его.
 */
const openRequestModals = new Map<string, string>();

/** Что не открылось — строка консоли, когда окно запроса не показалось */
const REQUEST_MODAL_FAILURES = {
  save: 'Окно спасброска не открылось',
  check: 'Окно проверки не открылось',
  recharge: 'Окно перезарядки не открылось',
} as const;

/**
 * Ответ из окна или карточки запроса: `respond` говорит инициатору, что
 * выбрали. Зовётся не больше раза — повтор молча пропускается.
 */
type RequestSettler = (respond?: () => void) => void;

/**
 * Замок «ответить ровно один раз».
 *
 * @param onSettled - что сделать при первом срабатывании замка, до ответа
 * @returns замок ответа
 */
function createRequestSettler(onSettled?: () => void): RequestSettler {
  let settled = false;

  return (respond) => {
    if (settled) {
      return;
    }

    settled = true;
    onSettled?.();
    respond?.();
  };
}

/**
 * Показывает вопрос по чужому запросу карточкой центра запросов ядра.
 *
 * По запросу отвечают РОВНО один раз: снятие запроса ядром (ответил другой
 * ведущий, инициатор отозвал, истёк срок) закрывает тот же замок, и поздний
 * щелчок по карточке ответа уже не шлёт. Карточку ядро снимает само.
 *
 * @param reply - ответ инициатору
 * @param build - собирает карточку; получает замок ответа
 */
function presentTrackedRequestCard(
  reply: RequestedRollReply,
  build: (settle: RequestSettler) => RequestedRollCard,
): void {
  const settle = createRequestSettler();

  reply.onCancelled(() => {
    settle();
  });

  reply.present(build(settle));
}

/**
 * Ответ словами для чата: подпись выбранного варианта.
 *
 * @param options - варианты ответа
 * @param optionId - выбранный вариант
 * @returns подпись варианта, а без неё — его ключ
 */
function describeChosenOption(
  options: readonly EffectPromptOption[],
  optionId: string,
): string {
  return options.find((option) => option.id === optionId)?.label ?? optionId;
}

/**
 * Выбранные цели словами для чата: имена через запятую или «без цели».
 *
 * @param candidates - кандидаты из запроса
 * @param chosenIds - выбранные цели
 * @returns строка ответа
 */
function describeChosenTargets(
  candidates: readonly TargetChoiceCandidate[],
  chosenIds: readonly string[],
): string {
  const names = candidates
    .filter((candidate) => chosenIds.includes(candidate.id))
    .map((candidate) => candidate.name);

  return names.length > 0
    ? names.join(REQUEST_ANSWER_CHAT.namesSeparator)
    : REQUEST_ANSWER_CHAT.noTargets;
}

/**
 * Цвет кнопки ответа: согласие выделено, остальные варианты нейтральны.
 * Согласие — вариант «да» / «преуспеть», а без него — первый в списке.
 *
 * @param options - варианты ответа
 * @returns кнопки карточки
 */
function buildQuestionActions(
  options: readonly EffectPromptOption[],
): RequestCardAction[] {
  const affirmativeIds: readonly string[] = [
    EFFECT_PROMPT_CONFIRM.yes,
    SAVE_OVERRIDE_ACCEPT,
  ];

  const affirmative =
    options.find((option) => affirmativeIds.includes(option.id)) ?? options[0];

  const affirmativeStyle: Pick<RequestCardAction, 'color'> = {
    color: 'primary',
  };

  return options.map((option): RequestCardAction => ({
    id: option.id,
    label: option.label,
    ...(option.hint ? { hint: option.hint } : {}),
    ...(option.id === affirmative?.id ? affirmativeStyle : {}),
  }));
}

/**
 * Пояснение «что случится по согласию» мелким шрифтом карточки.
 *
 * @param effectSummary - что случится, если известно
 * @returns строка пояснения либо `undefined`
 */
function formatSummaryDetails(effectSummary?: string): string | undefined {
  return effectSummary
    ? `${EFFECT_QUESTION_PROMPT_LABELS.summaryPrefix}${effectSummary}`
    : undefined;
}

/**
 * Вариант выбора цели на карточке: имя и хиты пояснением.
 *
 * @param candidate - кандидат из нагрузки запроса
 * @returns вариант выбора карточки
 */
function toPickOption(candidate: TargetChoiceCandidate): RequestCardPickOption {
  const { hpHintPrefix, hpHintJoiner } = REQUEST_CARD;

  return candidate.hp
    ? {
        id: candidate.id,
        label: candidate.name,
        hint: `${hpHintPrefix}${candidate.hp.current}${hpHintJoiner}${candidate.hp.max}`,
      }
    : { id: candidate.id, label: candidate.name };
}

/**
 * Открывает окно по чужому запросу и держит его на учёте.
 *
 * По запросу отвечают РОВНО один раз. Закрытие окна ядром (запрос сняли:
 * бросил ГМ, инициатор отозвал, истёк срок) тоже проходит через этот замок:
 * иначе закрытие окна прислало бы вслед лишний `decline`. Окно по запросу,
 * доставленному повторно (адресат переподключился, нажал «К окну броска» на
 * карточке центра запросов), второй раз не открывается — прежнее поднимается
 * наверх и разворачивается из шторки; ответит оно, со своим замком.
 *
 * Крестик окна — НЕ отказ: человек прячет окно, чтобы посмотреть, что
 * происходит на сцене, а запрос ждёт дальше. Окно снимается с учёта (`hide`),
 * и щелчок по карточке центра запросов откроет его заново. Отказ — отдельная
 * кнопка-иконка рядом с кнопкой броска (`onDecline`).
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
  open: (
    settle: RequestSettler,
    modalKey: string,
    hide: () => void,
  ) => string | null,
  failure: string,
): void {
  const { bringToFront, closeModal, setModalMinimized } = useModalManager();

  // Первый ответ снимает окно с учёта: дальше его по этому запросу не ищут
  const settle = createRequestSettler(() => {
    openRequestModals.delete(request.requestId);
  });

  /** Запрос сняли: окно закрывается, отвечать по нему уже некому */
  function closeOnCancelled(): void {
    const openModalId = openRequestModals.get(request.requestId);

    settle();

    if (openModalId) {
      closeModal(openModalId);
    }
  }

  const existingModalId = openRequestModals.get(request.requestId);

  if (existingModalId) {
    setModalMinimized(existingModalId, false);
    bringToFront(existingModalId);
    // Повторная регистрация безопасна: ядро держит по ключу запроса только
    // последний обработчик снятия (`cancelHandlers.set`), а замок ответа
    // срабатывает один раз — второй вызов `settle` ничего не делает
    reply.onCancelled(closeOnCancelled);

    return;
  }

  /** Окно спрятали крестиком: запрос ждёт, окно откроется заново по карточке */
  function hide(): void {
    openRequestModals.delete(request.requestId);
  }

  const modalId = open(
    settle,
    `${REQUESTED_ROLL_MODAL_KEY_PREFIX}${request.requestId}`,
    hide,
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

  // Окно, открытое заново после `hide`, регистрирует обработчик снятия ещё
  // раз — это безопасно: ядро держит по ключу запроса только последний
  // (`cancelHandlers.set`), а прежнее окно уже закрыто и до ответа не дойдёт
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

  // Ведущего спрашивают, превратить ли провал его существа в успех
  const override = parseSaveOverrideRequestPayload(request.payload);

  if (override) {
    return promptSaveOverride(request, reply, override);
  }

  // Перезарядка потраченного действия в начале хода существа
  const recharge = parseActionRechargeRequestPayload(request.payload);

  if (recharge) {
    return promptActionRecharge(request, reply, recharge);
  }

  // Проверка характеристики или навыка — мастер попросил бросить
  const check = parseAbilityCheckRequestPayload(request.payload);

  if (check) {
    return promptAbilityCheck(request, reply, check);
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
    sourceCreatureType: payload.sourceCreatureType,
    sourceSpellSchool: payload.sourceSpellSchool,
    sourceDamageTypes: payload.sourceDamageTypes,
  };

  // Авто-спасброски: владелец не хочет окна на каждый спас — бросаем сразу,
  // бросок уходит в чат от его имени, инициатор получает готовый результат.
  // Провал владелец может превратить в успех, пока инициатор ждёт ответа.
  // Запрос без управляющих в сети получают все ведущие: ответил один — у
  // остальных вопрос закрывается, ресурс не тратится
  if (resolveAutoSaves(entity)) {
    answerWithSaveOverride(
      target,
      rollSavingThrow(target),
      (final) => {
        reply.answer(final);
      },
      reply.onCancelled,
    );

    return true;
  }

  openTrackedRequestModal(
    request,
    reply,
    (settle, modalKey, hide) =>
      openSavingThrowModal(target, {
        modalKey,
        takeover: request.takeover,
        onResult: (result) => {
          settle(() => {
            answerWithSaveOverride(
              target,
              result,
              (final) => {
                reply.answer(final);
              },
              reply.onCancelled,
            );
          });
        },
        onCancel: hide,
        onDecline: () => {
          settle(() => reply.decline());
        },
      }),
    REQUEST_MODAL_FAILURES.save,
  );

  return true;
}

/**
 * Бросок перезарядки в начале хода существа: окно к6 либо, при «кидать
 * автоматически», бросок без окна. Крестик окна только прячет его, запрос
 * ждёт; отказ — кнопка «Отказаться от броска», и тогда действие остаётся
 * потраченным до следующего хода.
 *
 * @param request - запрос от ядра
 * @param reply - ответ инициатору
 * @param payload - разобранная нагрузка перезарядки
 * @returns `true`, если бросок взяла система; `false` — существа нет, пусть
 *   ядро бросит формулу запроса само
 */
function promptActionRecharge(
  request: RequestedRollPrompt,
  reply: RequestedRollReply,
  payload: ActionRechargeRequestPayload,
): boolean {
  const entity = useWorldEntities().findCurrentDndEntity(request.entityId);

  if (!entity || !isDndCreature(entity)) {
    return false;
  }

  if (readAutoRecharge(entity)) {
    answerActionRechargeInTurn(entity, payload, reply);

    return true;
  }

  openTrackedRequestModal(
    request,
    reply,
    (settle, modalKey, hide) =>
      openActionRechargeModal(entity, payload, {
        modalKey,
        takeover: request.takeover,
        onResult: (answer) => {
          settle(() => reply.answer(answer));
        },
        onCancel: hide,
        onDecline: () => {
          settle(() => reply.decline());
        },
      }),
    REQUEST_MODAL_FAILURES.recharge,
  );

  return true;
}

/**
 * Открывает окно проверки по запросу мастера. Крестик окна только прячет его
 * (запрос ждёт), отказ — кнопка «Отказаться от броска», как и у спасброска;
 * бросок считается по своей сущности (флаги, «Наставление»).
 *
 * @param request - запрос от ядра
 * @param reply - ответ инициатору
 * @param payload - разобранная нагрузка проверки
 * @returns `true`, если окно открыто; `false` — сущности с данными системы
 *   нет, и пусть ядро бросит нейтральной формулой
 */
function promptAbilityCheck(
  request: RequestedRollPrompt,
  reply: RequestedRollReply,
  payload: AbilityCheckRequestPayload,
): boolean {
  const entity = useWorldEntities().findCurrentDndEntity(request.entityId);

  if (!entity) {
    return false;
  }

  openTrackedRequestModal(
    request,
    reply,
    (settle, modalKey, hide) =>
      openRequestedCheckModal(entity, payload, {
        modalKey,
        takeover: request.takeover,
        onResult: (result) => {
          settle(() => reply.answer(result));
        },
        onCancel: hide,
        onDecline: () => {
          settle(() => reply.decline());
        },
      }),
    REQUEST_MODAL_FAILURES.check,
  );

  return true;
}

/**
 * Выбор цели по чужому запросу — карточкой центра запросов ядра.
 *
 * Кандидатов считает инициатор — у него сцена; здесь их только показывают и
 * возвращают отмеченных. Отказ есть только у добровольного выбора — кнопка
 * «Отказаться» (пустой выбор, срабатывание не состоится); у обязательного
 * отказа нет. Крестик карточки ядро делает «спрятать»: запрос ждёт дальше.
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
  const {
    confirmActionId,
    confirmLabel,
    declineActionId,
    declineLabel,
    targetIcon,
    targetTextPrefix,
  } = REQUEST_CARD;

  const confirmAction: RequestCardAction = {
    id: confirmActionId,
    label: confirmLabel,
    color: 'primary',
    requiresPick: true,
  };

  const actions: RequestCardAction[] = payload.optional
    ? [confirmAction, { id: declineActionId, label: declineLabel }]
    : [confirmAction];

  presentTrackedRequestCard(reply, (settle) => ({
    icon: targetIcon,
    text: `${targetTextPrefix}${payload.count}`,
    details: formatSummaryDetails(payload.effectSummary),
    actions,
    pick: {
      options: payload.candidates.map(toPickOption),
      // Обязательный выбор — хотя бы одна цель, как и в окне выбора
      min: payload.optional ? 0 : 1,
      max: payload.count,
    },
    onAction: (actionId, pickedIds) => {
      const chosenIds = actionId === confirmActionId ? pickedIds : [];

      settle(() => {
        reply.answer({ chosenIds });

        postRequestAnswerToChat(
          request,
          describeChosenTargets(payload.candidates, chosenIds),
        );
      });
    },
  }));

  return true;
}

/**
 * Спрашивает ведущего, превратить ли проваленный спасбросок его существа в
 * успех. Чем платить и сколько осталось, считается здесь, по живой сущности:
 * между броском и вопросом её могли поменять. Согласие списывает ресурс тут же —
 * писать в существо ведущего вправе только он.
 *
 * @param request - запрос от ядра
 * @param reply - ответ инициатору
 * @param payload - разобранная нагрузка вопроса
 * @returns `true`, если запрос взят; `false` — сущности в мире нет
 */
function promptSaveOverride(
  request: RequestedRollPrompt,
  reply: RequestedRollReply,
  payload: SaveOverrideRequestPayload,
): boolean {
  const entity = useWorldEntities().findCurrentDndEntity(request.entityId);

  if (!entity) {
    return false;
  }

  const available = findSaveOverride(entity);

  if (!available) {
    reply.answer({ optionId: SAVE_OVERRIDE_DECLINE });

    return true;
  }

  presentTrackedRequestCard(reply, (settle) => ({
    icon: REQUEST_CARD.questionIcon,
    text: formatSaveOverrideQuestion(
      entity.name,
      payload.ability,
      available.source.label,
      available.remaining,
    ),
    actions: buildQuestionActions(SAVE_OVERRIDE_OPTIONS),
    onAction: (optionId) => {
      settle(() => {
        if (optionId === SAVE_OVERRIDE_ACCEPT) {
          spendEntitySaveOverride(entity, available);
        }

        reply.answer({ optionId });

        postRequestAnswerToChat(
          request,
          describeChosenOption(SAVE_OVERRIDE_OPTIONS, optionId),
        );
      });
    },
  }));

  return true;
}

/**
 * Вопрос человеку по чужому запросу — карточкой центра запросов ядра:
 * согласие ведущего («Разрешить / Запретить»), срабатывание, расход реакции.
 *
 * Варианты ответа приходят в нагрузке закрытым списком; инициатор сверяет
 * ответ с тем же списком, поэтому карточка только показывает их и возвращает
 * выбранный ключ. Ответ «нет» — одна из кнопок; крестик карточки ядро
 * делает «спрятать», запрос при этом ждёт.
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
  presentTrackedRequestCard(reply, (settle) => ({
    icon: REQUEST_CARD.questionIcon,
    text: payload.question,
    details: formatSummaryDetails(payload.effectSummary),
    actions: buildQuestionActions(payload.options),
    onAction: (optionId) => {
      settle(() => {
        reply.answer({ optionId });

        postRequestAnswerToChat(
          request,
          describeChosenOption(payload.options, optionId),
        );
      });
    },
  }));

  return true;
}
