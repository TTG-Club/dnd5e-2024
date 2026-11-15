/**
 * Имя другой сущности в чате: цель атаки, урона, заклинания.
 *
 * Имя существа без «Показывать имя» игрокам знать не положено: его нет ни под
 * фишкой, ни в трекере инициативы — и карточка удара по такому существу не
 * должна его называть. В блоке карточки рядом с именем цели уходит её id:
 * ядро (VTTG 0.9.840) отдаёт настоящее имя только мастеру и тем, кто существом
 * управляет, остальным — заглушку. Обычный текст (`label`, `content`, пометки)
 * получают все как есть, поэтому в него скрытое имя не пишется вовсе.
 *
 * Правило и заглушка — те же, что у ядра (`isEntityNameHidden`,
 * `HIDDEN_ENTITY_NAME` в `@vtt/shared`). Свои копии — чтобы система работала
 * и на приложении, где их ещё нет.
 *
 * @module system/dnd/chatTargets
 */

import type { ChatBlock, SceneEntity } from '@vtt/shared';

/** Что игрок видит вместо скрытого имени существа */
export const HIDDEN_ENTITY_NAME = 'Неизвестный';

/** Что нужно знать о сущности, чтобы решить, скрыто ли её имя */
type NamedEntity = Pick<SceneEntity, 'entityType' | 'token' | 'name'>;

/**
 * Скрыто ли имя сущности от игроков: существо без явно включённого
 * «Показывать имя». Имена персонажей известны и так.
 *
 * @param entity - сущность мира
 * @returns `true`, если игрокам имя показывать нельзя
 */
export function isEntityNameHidden(
  entity: Pick<NamedEntity, 'entityType' | 'token'>,
): boolean {
  return entity.entityType === 'creature' && entity.token?.showName !== true;
}

/**
 * Имя сущности для текста, который получают все: настоящее либо заглушка,
 * если имя от игроков скрыто.
 *
 * @param entity - сущность мира
 * @returns имя для общего текста
 */
export function resolvePublicEntityName(entity: NamedEntity): string {
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
