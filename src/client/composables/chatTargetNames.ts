import type { ChatTarget } from '@vtt/shared/system/dnd.js';

import { findEntityInWorld } from '@/core/entityUtils';
import { useWorldStore } from '@/stores/worldStore';
import { resolvePublicEntityName } from '@vtt/shared/system/dnd.js';

/**
 * Имя сущности для текста чата, который получают все (`label`, `content`,
 * пометки): настоящее либо заглушка, если имя существа скрыто от игроков.
 *
 * Имя цели в блоке карточки сюда не относится — там оно настоящее и уходит
 * вместе с id сущности (`ChatTarget`), а кому его показать, решает ядро.
 *
 * @param entityId - id актёра или существа; нет — имя уйдёт как есть
 * @param name - имя, под которым сущность известна вызывающему
 * @returns имя для общего текста
 */
export function resolvePublicTargetName(
  entityId: string | null | undefined,
  name: string,
): string {
  const entity = findEntityInWorld(useWorldStore().currentWorld, entityId);

  // Сущности в мире уже нет — судить о её имени не по чему
  return entity ? resolvePublicEntityName(entity) : name;
}

/**
 * Цель для блока карточки чата: имя и id сущности, которой оно принадлежит.
 *
 * @param entityId - id актёра или существа
 * @param name - настоящее имя цели
 * @returns цель для сборщиков блоков
 */
export function toChatTarget(
  entityId: string | null | undefined,
  name: string,
): ChatTarget {
  return entityId ? { name, entityId } : { name };
}
