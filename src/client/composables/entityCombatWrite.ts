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
 * над ней, а копия уходит с основой — снимок несёт разницу эффектов, и сервер
 * сливает её со своим списком (`combatEffectChanges.ts`).
 */

import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { recordEffectsBaseline } from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

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

  // Основа — список свежей сущности: от него и считалось преобразование
  recordEffectsBaseline(next, current.activeEffects ?? []);
  emitEntityCombatState(socket, next);

  return next;
}

/**
 * Отправляет копию, посчитанную заранее от известной основы: действие с ценой
 * прошло через вопросы человеку, и пересчитать его над свежей сущностью
 * нельзя — срабатывания уже бросили кости. Эффекты уходят разницей «основа →
 * копия», и сервер сливает её со своим списком: изменённое им за время
 * вопросов не откатывается.
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

  recordEffectsBaseline(computed, base.activeEffects ?? []);
  emitEntityCombatState(socket, computed);

  return true;
}
