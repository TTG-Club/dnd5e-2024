/**
 * Запись боевого состояния сущности — единственное место, откуда система шлёт
 * боевой канал ядра (`emitEntityCombatState`).
 *
 * Раньше каждый путь собирал копию сам и слал её целиком: список эффектов,
 * посчитанный от копии, затирал то, что сервер изменил после неё. Конец
 * прежнего каста снимал эффекты с цели — следом снимок нового каста,
 * собранный из стора до ответа сервера, возвращал их обратно; метка
 * концентрации, записанная листом, пропадала под снимком без неё.
 *
 * Здесь сущность берётся свежей в момент записи, преобразование выполняется
 * над ней, а копия уходит с основой — снимок несёт разницу эффектов и журнала
 * срабатываний, и сервер сливает её со своим состоянием
 * (`combatEffectChanges.ts`).
 *
 * Журнал срабатываний едет ТОЛЬКО этим каналом и ровно один раз на действие:
 * расход считает тот, кто делал действие, разницей «до → после»
 * ({@link changeEntityCombatState}, {@link sendComputedCombatState},
 * {@link sendTriggerUsageSpend}). Запись листа журнал не шлёт и из
 * преобразования не берёт (`entitySheetWrite.ts`).
 *
 * Журнал, посланный снимком, помнится, пока стор его не догнал
 * ({@link readSentTriggerUsage}): полная запись листа берёт его отсюда, а не
 * из стора, где расхода ещё нет, — иначе она вернула бы серверу прежний
 * журнал.
 */

import type {
  DnDSceneEntity,
  EffectTriggerUsageLedger,
} from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import {
  applyTriggerUsageChanges,
  diffTriggerUsage,
  hasTriggerUsageChanges,
  readTriggerUsage,
  recordCombatBaseline,
  withTriggerUsage,
} from '@vtt/shared/system/dnd.js';

import { resolveTurnStamp } from './encounterTurn';
import { useWorldEntities } from './useWorldEntities';

/**
 * Сколько помнится посланный журнал, если стор его так и не догнал: снимок
 * мог не лечь (пауза, нет прав), и без срока запись листа носила бы расход,
 * которого на сервере нет
 */
const SENT_USAGE_TTL_MS = 5000;

/** Журнал, посланный боевыми снимками, пока стор его не догнал */
interface SentTriggerUsage {
  /** Журнал сервера после всех посланных снимков */
  ledger: EffectTriggerUsageLedger;
  /** Ключи, снятые посланными снимками */
  removedKeys: readonly string[];
  /**
   * Ход боя в момент отправки. Конец хода сбрасывает счётчики хода и раунда
   * на сервере: журнал, посланный в прошлом ходу, вернул бы их обратно
   */
  turnStamp: string;
  /** Когда ушёл последний снимок, мс */
  sentAt: number;
}

/** Посланные журналы по id сущности */
const sentTriggerUsage = new Map<string, SentTriggerUsage>();

/**
 * Догнал ли стор посланное: по каждому посланному ключу в журнале стора не
 * меньше, а снятых ключей в нём нет. Сверка по содержимому, а не по смене
 * объекта `system`: ответ сервера на БОЛЕЕ РАННЕЕ сообщение тоже меняет
 * объект, но расхода ещё не несёт.
 *
 * @param storeLedger - журнал записи стора
 * @param sent - посланное
 * @returns `true`, если помнить больше нечего
 */
function coversSentTriggerUsage(
  storeLedger: EffectTriggerUsageLedger,
  sent: SentTriggerUsage,
): boolean {
  return (
    Object.entries(sent.ledger).every(
      ([key, entry]) => (storeLedger[key]?.used ?? 0) >= entry.used,
    )
    && sent.removedKeys.every(
      (key) => key in sent.ledger || !(key in storeLedger),
    )
  );
}

/**
 * Забывает посланные журналы, которые уже не действуют: вышел срок или
 * сменился ход. Зовётся на каждом чтении и на каждой отправке — память не
 * копит сущности, к которым больше не обращаются.
 *
 * @param now - текущее время, мс
 */
function forgetStaleSentTriggerUsage(now: number): void {
  const turnStamp = resolveTurnStamp();

  for (const [entityId, sent] of sentTriggerUsage) {
    if (now - sent.sentAt > SENT_USAGE_TTL_MS || sent.turnStamp !== turnStamp) {
      sentTriggerUsage.delete(entityId);
    }
  }
}

/**
 * Журнал сущности с расходом, который ушёл боевым снимком, но в стор ещё не
 * вернулся. Его берёт полная запись листа: она заменяет сущность целиком, и
 * журнал из стора стёр бы только что посланный расход.
 *
 * Пока стор посланного не догнал, по каждому ключу берётся большее из стора и
 * посланного: расход, записанный сервером по чужому снимку, тоже остаётся.
 *
 * @param storeEntity - запись стора
 * @returns журнал для записи
 */
export function readSentTriggerUsage(
  storeEntity: DnDSceneEntity,
): EffectTriggerUsageLedger {
  forgetStaleSentTriggerUsage(Date.now());

  const storeLedger = readTriggerUsage(storeEntity);
  const sent = sentTriggerUsage.get(storeEntity.id);

  if (!sent) {
    return storeLedger;
  }

  if (coversSentTriggerUsage(storeLedger, sent)) {
    sentTriggerUsage.delete(storeEntity.id);

    return storeLedger;
  }

  const removed = new Set(sent.removedKeys);

  const kept = Object.fromEntries(
    Object.entries(storeLedger).filter(([key]) => !removed.has(key)),
  );

  return Object.entries(sent.ledger).reduce<EffectTriggerUsageLedger>(
    (ledger, [key, entry]) =>
      entry.used > (ledger[key]?.used ?? 0)
        ? { ...ledger, [key]: entry }
        : ledger,
    kept,
  );
}

/**
 * Запоминает расход журнала, ушедший снимком: поверх журнала, ещё не
 * вернувшегося от сервера, — два снимка в одном тике складываются.
 *
 * @param storeEntity - запись стора
 * @param base - сущность, от которой считали снимок
 * @param sent - отправленная копия
 */
function rememberSentTriggerUsage(
  storeEntity: DnDSceneEntity,
  base: DnDSceneEntity,
  sent: DnDSceneEntity,
): void {
  const changes = diffTriggerUsage(
    readTriggerUsage(base),
    readTriggerUsage(sent),
  );

  if (!hasTriggerUsageChanges(changes)) {
    return;
  }

  // Чтение раньше записи: оно же забывает устаревшее
  const ledger = applyTriggerUsageChanges(
    readSentTriggerUsage(storeEntity),
    changes,
  );

  const pending = sentTriggerUsage.get(storeEntity.id);

  sentTriggerUsage.set(storeEntity.id, {
    ledger,
    removedKeys: [
      ...new Set([...(pending?.removedKeys ?? []), ...changes.removeKeys]),
    ],
    turnStamp: resolveTurnStamp(),
    sentAt: Date.now(),
  });
}

/**
 * Меняет боевое состояние сущности мира: хиты, эффекты, счётчики
 * срабатываний.
 *
 * Вызывающий отдаёт id и преобразование, а не готовую копию: сущность
 * перечитывается из мира в момент записи, и копия, снятая раньше (до окна
 * спасброска, до ответа сервера на конец каста), уйти не может.
 *
 * @param entityId - сущность
 * @param change - новое состояние от свежей сущности: НОВЫЙ объект (живую
 *   запись стора меняет только ответ сервера); `null` — ничего не слать
 * @returns отправленная копия; нет соединения, сущности или изменения — `null`
 */
export function changeEntityCombatState(
  entityId: string | null | undefined,
  change: (current: DnDSceneEntity) => DnDSceneEntity | null,
): DnDSceneEntity | null {
  const socket = useChatStore().getSocket();
  const current = useWorldEntities().findCurrentDndEntity(entityId);

  if (!socket || !current) {
    return null;
  }

  const changed = change(current);

  if (!changed) {
    return null;
  }

  // Основа живёт на объекте снимка: запиши её на запись стора — она пережила
  // бы эту запись и испортила следующую
  const next = changed === current ? { ...changed } : changed;

  // Основа — свежая сущность: от неё и считалось преобразование
  recordCombatBaseline(next, current);
  emitEntityCombatState(socket, next);
  rememberSentTriggerUsage(current, current, next);

  return next;
}

/**
 * Отправляет копию, посчитанную заранее от известной основы: действие с ценой
 * прошло через вопросы человеку, и пересчитать его над свежей сущностью
 * нельзя — срабатывания уже бросили кости. Эффекты уходят разницей «основа →
 * копия», и сервер сливает её со своим списком: изменённое им за время
 * вопросов не откатывается; журнал срабатываний — так же.
 *
 * Где преобразование можно выполнить в момент записи — только
 * {@link changeEntityCombatState}.
 *
 * @param base - сущность, от которой считали копию
 * @param computed - копия после действия (не запись стора)
 * @returns `true`, если снимок ушёл
 */
export function sendComputedCombatState(
  base: DnDSceneEntity,
  computed: DnDSceneEntity,
): boolean {
  const socket = useChatStore().getSocket();

  if (!socket) {
    return false;
  }

  recordCombatBaseline(computed, base);
  emitEntityCombatState(socket, computed);

  const storeEntity = useWorldEntities().findCurrentDndEntity(computed.id);

  if (storeEntity) {
    rememberSentTriggerUsage(storeEntity, base, computed);
  }

  return true;
}

/**
 * Шлёт расход журнала срабатываний, посчитанный на копии, — и только его:
 * хиты и эффекты остаются как у свежей сущности. Так уходит отметка оплаты
 * (бесплатная кость): ресурсы листа после вопросов человеку несёт запись
 * листа, а журнал она не шлёт.
 *
 * Расход — разница «основа → копия», а не журнал копии: сервер прибавит её к
 * своему журналу, и то, что он записал за время вопросов, остаётся.
 *
 * @param base - сущность, от которой считали копию
 * @param computed - копия после действия
 * @returns `true`, если расход был и ушёл
 */
export function sendTriggerUsageSpend(
  base: DnDSceneEntity,
  computed: DnDSceneEntity,
): boolean {
  const changes = diffTriggerUsage(
    readTriggerUsage(base),
    readTriggerUsage(computed),
  );

  if (!hasTriggerUsageChanges(changes)) {
    return false;
  }

  return (
    changeEntityCombatState(computed.id, (current) =>
      withTriggerUsage(
        current,
        applyTriggerUsageChanges(readTriggerUsage(current), changes),
      ),
    ) !== null
  );
}
