import type { DiceRollData } from './base.js';

/**
 * Запрос броска пользователю — адресный канал «попроси владельца сущности
 * бросить и дождись ответа».
 *
 * Ядро здесь НЕ знает правил: что именно бросается (спасбросок, проверка,
 * инициатива), с какими модификаторами и против какой сложности — всё это
 * лежит в непрозрачном `payload` запроса и в таком же непрозрачном `result`
 * ответа. Ядро лишь доставляет запрос владельцу сущности, хранит его до ответа
 * и возвращает исход инициатору.
 *
 * @module types/rollRequest
 */

/**
 * Исход запроса броска — то, что получает инициатор.
 *
 * Ответ приходит ВСЕГДА, ни один путь не оставляет инициатора ждать вечно:
 * закрытое окно — `declined`, вышедший из мира адресат — `noRecipient`,
 * истёкший срок — `timeout`, отказ сервера — `rejected`.
 */
export type RollRequestOutcome =
  /** Адресат бросил сам */
  | { status: 'answered'; result: unknown; respondedByUserId: string }
  /** За адресата бросил другой — ГМ или сам инициатор («бросить самому») */
  | { status: 'takenOver'; result: unknown; respondedByUserId: string }
  /** Адресат отказался или закрыл окно; либо запрос отозвали инициатор/ГМ */
  | { status: 'declined' }
  /** Истёк срок ожидания */
  | { status: 'timeout' }
  /** У сущности нет владельца, либо он не в сети (в том числе вышел, пока запрос висел) */
  | { status: 'noRecipient' }
  /** Сервер не принял запрос: нет права, сущность не найдена, нет соединения */
  | { status: 'rejected'; reason: string };

/** Статусы исхода запроса броска */
export type RollRequestStatus = RollRequestOutcome['status'];

/**
 * Что инициатор передаёт в `rollRequests.request(...)`.
 */
export interface RollRequestOptions {
  /** Сущность, ЧЕЙ владелец должен бросить */
  entityId: string;
  /**
   * Сущность, от имени которой совершается действие (атакующий, заклинатель).
   * Не-ГМ вправе слать запросы только от своей сущности — по ней сервер и
   * проверяет право. ГМу поле не требуется.
   */
  sourceEntityId?: string;
  /**
   * Короткая подпись запроса для нейтрального интерфейса ядра: плашки
   * «вас просят бросить», индикатора ожидания и списка ГМа. Например,
   * «Спасбросок Ловкости (СЛ 15)». Ядро показывает её как есть.
   */
  title?: string;
  /**
   * Формула для нейтрального броска ядра — на случай, если у адресата система
   * не дала своё окно (`promptRequestedRoll`). Без неё ядро бросает
   * `ROLL_REQUEST_DEFAULT_FALLBACK_FORMULA`.
   */
  fallbackFormula?: string;
  /** Непрозрачная для ядра нагрузка системы: её получит слот адресата как есть */
  payload: unknown;
  /**
   * Предел ожидания в миллисекундах. Не больше `ROLL_REQUEST_MAX_LIFETIME_MS`:
   * сервер режет большее значение до потолка, чтобы запрос не висел вечно.
   */
  timeoutMs?: number;
}

/**
 * Запрос в проводе: то, что клиент инициатора шлёт серверу в `roll-request:send`.
 */
export interface RollRequestSendInput extends RollRequestOptions {
  /** Идентификатор запроса — придумывает инициатор (`generateId('rreq')`) */
  requestId: string;
  /**
   * Идентификатор ЭКЗЕМПЛЯРА страницы инициатора. Нужен, чтобы отличить
   * обрыв связи (та же страница вернётся и продолжит ждать) от F5 (страница
   * новая, старый промис потерян, запрос надо снять у адресата).
   */
  clientId: string;
}

/**
 * Что получает адресат в `roll-request:incoming` (и слот `promptRequestedRoll`).
 */
export interface IncomingRollRequest {
  requestId: string;
  /** Сущность, за которую просят бросить */
  entityId: string;
  /** Имя сущности — для подписи окна и плашки */
  entityName: string;
  /** Подпись запроса от инициатора (см. `RollRequestOptions.title`) */
  title?: string;
  /** Формула нейтрального броска (см. `RollRequestOptions.fallbackFormula`) */
  fallbackFormula?: string;
  /** Непрозрачная нагрузка системы */
  payload: unknown;
  /** Кто просит */
  requesterUserId: string;
  requesterName: string;
  /** Метки времени сервера, мс */
  createdAt: number;
  expiresAt: number;
}

/**
 * Сводка висящего запроса — для списка ГМа и индикатора у инициатора.
 */
export interface PendingRollRequestSummary extends IncomingRollRequest {
  /** Кого просят (владелец сущности) */
  recipientUserId: string;
  recipientName: string;
  /** В сети ли адресат прямо сейчас */
  recipientOnline: boolean;
}

/**
 * Ответ сервера на `roll-request:send` (ack).
 *
 * Отказ приходит СРАЗУ и уже в форме исхода: инициатору не нужно ждать
 * отдельного события, чтобы узнать, что владельца нет в сети или права нет.
 */
export type RollRequestSendAck =
  | {
      accepted: true;
      recipientUserId: string;
      recipientName: string;
      entityName: string;
      expiresAt: number;
    }
  | { accepted: false; outcome: RollRequestOutcome };

/**
 * Почему запрос снят у адресата (`roll-request:cancelled`).
 *
 * - `answered` — на него ответили с другой вкладки того же пользователя;
 * - `takenOver` — за него бросил ГМ или инициатор;
 * - `cancelled` — инициатор/ГМ отозвал запрос либо инициатор ушёл из мира;
 * - `timeout` — истёк срок.
 */
export type RollRequestCancelReason =
  | 'answered'
  | 'takenOver'
  | 'cancelled'
  | 'timeout';

/**
 * Снимок исходящего запроса при переподключении: висит (`outcome: null`) или
 * уже завершён — результат мог уехать в обрыв связи, и сервер отдаёт его
 * повторно.
 */
export interface RollRequestOutgoingSnapshot {
  summary: PendingRollRequestSummary;
  outcome: RollRequestOutcome | null;
}

/**
 * Состояние запросов для клиента — ответ на `roll-request:request-state`.
 *
 * Шлётся при каждом подключении сокета: так запрос переживает F5 у адресата
 * (сервер переотдаёт его), а инициатор после обрыва связи получает результаты,
 * пришедшие в обрыв.
 */
export interface RollRequestState {
  /** Запросы, адресованные этому пользователю */
  incoming: IncomingRollRequest[];
  /** Запросы, отправленные этим пользователем: висящие и недавно завершённые */
  outgoing: RollRequestOutgoingSnapshot[];
  /** Все висящие запросы мира — только ГМу; игроку приходит пустой список */
  pending: PendingRollRequestSummary[];
}

/**
 * Ответ нейтрального окна ядра — когда у адресата не было слота системы.
 *
 * Система-инициатор обязана распознавать эту форму (`isNeutralRollAnswer`):
 * это единственный ответ, форму которого придумала не она.
 */
export interface RollRequestNeutralAnswer {
  neutral: true;
  formula: string;
  total: number;
  rollData: DiceRollData;
}
