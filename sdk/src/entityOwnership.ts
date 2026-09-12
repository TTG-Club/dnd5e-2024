import type { EntityOwnership } from './types/base.js';

/** Возвращает управляющих; старый владелец учитывается только при отсутствии списка. */
export function getEntityOwnerIds(
  entity: EntityOwnership | null | undefined,
): readonly string[] {
  return entity?.ownerIds ?? (entity?.ownerId ? [entity.ownerId] : []);
}

/** Проверяет управление сущностью без предоставления доступа неавторизованному клиенту. */
export function isEntityOwner(
  entity: EntityOwnership | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!entity || !userId) {
    return false;
  }

  return entity.ownerIds !== undefined
    ? entity.ownerIds.includes(userId)
    : entity.ownerId === userId;
}
