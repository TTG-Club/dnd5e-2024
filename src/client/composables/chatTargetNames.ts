import type {
  AttackDamageRecord,
  AttackDamageTarget,
  ChatTarget,
} from '@vtt/shared/system/dnd.js';

import { findEntityInWorld } from '@/core/entityUtils';
import { useWorldStore } from '@/stores/worldStore';
import {
  resolvePublicEntityName,
  serializeAttackDamageRecord,
} from '@vtt/shared/system/dnd.js';

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

/**
 * Цель записи об уроне для блока карточки. В записи имя общее (см.
 * {@link serializeChatDamageRecord}), а блоку нужно настоящее — оно берётся
 * из мира; сущности уже нет — остаётся имя из записи.
 *
 * @param target - цель записи об уроне
 * @returns цель для сборщиков блоков
 */
export function toRecordChatTarget(
  target: Pick<AttackDamageTarget, 'entityId' | 'name'>,
): ChatTarget {
  const entity = findEntityInWorld(
    useWorldStore().currentWorld,
    target.entityId,
  );

  return { name: entity?.name ?? target.name, entityId: target.entityId };
}

/**
 * Запись об уроне для дополнения чата (`payload`). Дополнение получают все,
 * кто видит сообщение, и ядро в данные системы не заглядывает — поэтому имена
 * целей в записи общие: скрытое от игроков имя существа в неё не попадает.
 *
 * @param record - запись об уроне
 * @returns строка для `payload` дополнения
 */
export function serializeChatDamageRecord(record: AttackDamageRecord): string {
  return serializeAttackDamageRecord({
    ...record,
    targets: record.targets.map((target) => ({
      ...target,
      name: resolvePublicTargetName(target.entityId, target.name),
    })),
  });
}
