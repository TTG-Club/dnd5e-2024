/**
 * Запрет лечения: «не может восстанавливать хиты» и «не может получать
 * временные хиты» («Борода» бородатого дьявола, «Леденящее касание»).
 *
 * Флаги читает одна функция, а зовут её все пути восстановления хитов: лечение
 * по цели, лечение и временные хиты срабатываний и урона каждый ход, отдых.
 * Ручная правка хитов и кнопки ГМа запрет не проверяют — это решение ведущего,
 * а не правило.
 */

import type { DnDSceneEntity } from './dndEntities.js';

import { resolveActorStats } from './effectPipeline.js';

/** Флаг «не может восстанавливать хиты» */
export const HEALING_BLOCKED_FLAG = 'healing.blocked';

/** Флаг «не может получать временные хиты» */
export const TEMP_HEALING_BLOCKED_FLAG = 'healing.tempBlocked';

/** Сколько хитов и временных хитов сущность получает */
export interface HealingAmounts {
  /** Восстановленные хиты */
  hitPoints: number;
  /** Выданные временные хиты */
  temporary: number;
}

/**
 * Лечение, которое пропускают флаги запрета.
 *
 * @param flags - активные флаги получателя
 * @param amounts - лечение до запрета
 * @returns лечение после запрета
 */
export function limitHealingByFlags(
  flags: ReadonlySet<string>,
  amounts: HealingAmounts,
): HealingAmounts {
  return {
    hitPoints: flags.has(HEALING_BLOCKED_FLAG) ? 0 : amounts.hitPoints,
    temporary: flags.has(TEMP_HEALING_BLOCKED_FLAG) ? 0 : amounts.temporary,
  };
}

/**
 * Лечение, которое сущность может получить со своими эффектами.
 *
 * @param entity - получатель
 * @param amounts - лечение до запрета
 * @returns лечение после запрета
 */
export function limitEntityHealing(
  entity: DnDSceneEntity,
  amounts: HealingAmounts,
): HealingAmounts {
  if (amounts.hitPoints <= 0 && amounts.temporary <= 0) {
    return amounts;
  }

  return limitHealingByFlags(resolveActorStats(entity).activeFlags, amounts);
}

/**
 * Может ли сущность восстанавливать хиты: отдых не поднимает хиты тому, кому
 * лечение запрещено.
 *
 * @param entity - сущность
 * @returns `true`, если хиты восстанавливаются
 */
export function canEntityRegainHitPoints(entity: DnDSceneEntity): boolean {
  return !resolveActorStats(entity).activeFlags.has(HEALING_BLOCKED_FLAG);
}
