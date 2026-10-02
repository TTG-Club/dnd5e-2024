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
 * Журнал, посланный снимком, помнится до ответа сервера
 * ({@link readSentTriggerUsage}): полная запись листа в том же тике берёт его
 * отсюда, а не из стора, где расхода ещё нет, — иначе она вернула бы серверу
 * прежний журнал.
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
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

/** Журнал, посланный боевым снимком, пока сервер его не вернул */
interface SentTriggerUsage {
  /**
   * Раздел `system` записи стора в момент отправки. Ответ сервера заменяет
   * раздел целиком (`Object.assign` стора хоста), и другой объект значит:
   * стор догнал сервер, помнить больше нечего
   */
  storeSystem: DnDSceneEntity['system'];
  /** Журнал после всех посланных снимков */
  ledger: EffectTriggerUsageLedger;
}

/** Посланные журналы по id сущности */
const sentTriggerUsage = new Map<string, SentTriggerUsage>();

/**
 * Журнал сущности с расходом, который ушёл боевым снимком, но в стор ещё не
 * вернулся. Его берёт полная запись листа: она заменяет сущность целиком, и
 * журнал из стора стёр бы только что посланный расход.
 *
 * @param storeEntity - запись стора
 * @returns журнал для записи
 */
export function readSentTriggerUsage(
  storeEntity: DnDSceneEntity,
): EffectTriggerUsageLedger {
  const sent = sentTriggerUsage.get(storeEntity.id);

  if (sent && sent.storeSystem === storeEntity.system) {
    return sent.ledger;
  }

  sentTriggerUsage.delete(storeEntity.id);

  return readTriggerUsage(storeEntity);
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

  sentTriggerUsage.set(storeEntity.id, {
    storeSystem: storeEntity.system,
    ledger: applyTriggerUsageChanges(
      readSentTriggerUsage(storeEntity),
      changes,
    ),
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
