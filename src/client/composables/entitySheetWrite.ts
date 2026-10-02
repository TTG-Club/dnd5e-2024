/**
 * Запись ресурсов листа во время игры — единственное место вне листов и окон
 * настройки, откуда система шлёт полную запись сущности (`emitEntityUpdate`).
 *
 * Полную запись сервер не сливает: `actor:updated` / `creature:updated`
 * заменяют сущность тем, что прислал клиент (README, § «Чего не хватает для
 * полноценного SDK»). Копия, захваченная раньше, — при открытии окна броска,
 * до вопроса о цене — возвращала хиты и эффекты, изменённые сервером за это
 * время. Здесь сущность берётся свежей в момент записи, преобразование меняет
 * только разделы листа, а стор правится тут же: следующая запись в том же
 * тике не возьмёт прежнее.
 *
 * Хиты и эффекты этим путём не меняются — их несёт боевой снимок
 * (`entityCombatWrite.ts`), который сервер сливает со своим состоянием.
 */

import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import { emitEntityUpdate } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { isActorEntity, isCreatureEntity } from '@vtt/shared';
import {
  resolveEntityCurrentHp,
  resolveEntityTempHp,
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

/**
 * Не тронуты ли хиты и эффекты: их меняет только боевой снимок. Полная запись
 * с другими хитами или эффектами затёрла бы то, что сервер изменил после
 * копии, — такую запись помощник не шлёт.
 *
 * @param current - сущность мира
 * @param next - новая сущность
 * @returns `true`, если хиты и эффекты те же
 */
function keepsCombatState(
  current: DnDSceneEntity,
  next: DnDSceneEntity,
): boolean {
  return (
    resolveEntityCurrentHp(next) === resolveEntityCurrentHp(current)
    && resolveEntityTempHp(next) === resolveEntityTempHp(current)
    && JSON.stringify(next.activeEffects ?? [])
      === JSON.stringify(current.activeEffects ?? [])
  );
}

/**
 * Меняет ресурсы листа сущности мира: ячейки, заряды, счётчики, предметы,
 * заклинания.
 *
 * Вызывающий отдаёт id и преобразование, а не готовую копию: сущность
 * перечитывается в момент записи. Ресурсы, посчитанные заранее (оплата цены
 * прошла через вопросы человеку), переносятся на свежую сущность
 * `withSheetResources(current, spent)`.
 *
 * @param entityId - сущность
 * @param change - новая сущность от свежей: НОВЫЙ объект с теми же хитами и
 *   эффектами; `null` — ничего не писать
 * @returns отправленная сущность; нет соединения, сущности, изменения или
 *   преобразование тронуло хиты и эффекты — `null`
 */
export function changeEntitySheet(
  entityId: string | null | undefined,
  change: (current: DnDSceneEntity) => DnDSceneEntity | null,
): DnDSceneEntity | null {
  const worldStore = useWorldStore();
  const worldId = worldStore.connectionState.currentWorldId;
  const socket = useChatStore().getSocket();
  const current = useWorldEntities().findCurrentDndEntity(entityId);

  if (!worldId || !socket || !current) {
    return null;
  }

  const next = change(current);

  if (!next || next === current) {
    return null;
  }

  if (!keepsCombatState(current, next)) {
    console.error(
      `[entitySheetWrite] ${current.name}: хиты и эффекты меняет боевой снимок, а не запись листа`,
    );

    return null;
  }

  // Стор — сразу: следующая запись в том же тике читает уже новые разделы.
  // Разделы листа — переменной: базовый тип актёра ядра инвентаря не знает
  const sections = {
    system: next.system,
    equipment: next.equipment,
    spells: next.spells,
  };

  if (isActorEntity(next)) {
    worldStore.updateActor(worldId, next.id, sections);
  } else if (isCreatureEntity(next)) {
    worldStore.updateCreature(worldId, next.id, sections);
  }

  emitEntityUpdate(socket, next);

  return next;
}
