/**
 * Имя другой сущности в чате: цель атаки, урона, заклинания.
 *
 * Имя существа без «Показывать имя» игрокам знать не положено: его нет ни под
 * фишкой, ни в трекере инициативы — и карточка удара по такому существу не
 * должна его называть. В блоке карточки рядом с именем цели уходит её id:
 * ядро отдаёт настоящее имя только мастеру и тем, кто существом управляет,
 * остальным — заглушку. Обычный текст (`label`, `content`, пометки) получают
 * все как есть, поэтому в него скрытое имя не пишется вовсе.
 *
 * Само правило и заглушка — у ядра (`isEntityNameHidden`, `HIDDEN_ENTITY_NAME`
 * в `@vtt/shared`, VTTG 0.9.840): здесь только то, как ими пользуются
 * карточки системы.
 *
 * @module system/dnd/chatTargets
 */

import type { ChatBlock, SceneEntity } from '@vtt/shared';

import { HIDDEN_ENTITY_NAME, isEntityNameHidden } from '@vtt/shared';

/**
 * Имя сущности для текста, который получают все: настоящее либо заглушка,
 * если имя от игроков скрыто.
 *
 * @param entity - сущность мира
 * @returns имя для общего текста
 */
export function resolvePublicEntityName(
  entity: Pick<SceneEntity, 'entityType' | 'token' | 'name'>,
): string {
  return isEntityNameHidden(entity) ? HIDDEN_ENTITY_NAME : entity.name;
}

/** Цель в блоке карточки чата: имя и сущность, которой оно принадлежит */
export interface ChatTarget {
  /** Настоящее имя цели: кому его не положено знать, решает ядро по `entityId` */
  name: string;
  /** id актёра или существа; нет — имя уйдёт всем как написано */
  entityId?: string;
}

/**
 * Поля цели для шапки блока или его строки: имя и id сущности.
 *
 * @param target - цель; нет — полей нет
 * @returns поля `target` и `targetEntityId` блока или строки
 */
export function buildChatTargetFields(
  target: ChatTarget | undefined,
): Pick<ChatBlock, 'target' | 'targetEntityId'> {
  if (!target?.name) {
    return {};
  }

  return {
    target: target.name,
    ...(target.entityId ? { targetEntityId: target.entityId } : {}),
  };
}
