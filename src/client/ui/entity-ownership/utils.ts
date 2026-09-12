import type { EntityOwnership } from '@vtt/shared';

/** Исключает права из обычного сохранения листа: назначение меняется только в настройках. */
export function withoutEntityOwnership<Entity extends EntityOwnership>(
  entity: Entity,
): Omit<Entity, 'ownerId' | 'ownerIds'> {
  const { ownerId: _ownerId, ownerIds: _ownerIds, ...entityContent } = entity;

  return entityContent;
}
