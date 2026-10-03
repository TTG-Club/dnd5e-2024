/**
 * Снимок броска атаки: стороны удара и эффекты, которые бросок израсходовал.
 *
 * Окно броска расходует одноразовые эффекты до броска и отдаёт снимок
 * обработчикам урона (`onRoll`, `onRollParts`, `onProjectileAttack`,
 * `onHit`). Разбор удара считает стороны по свежей сущности мира с
 * израсходованными эффектами поверх (`withHeldAttackEffects`) — одинаково на
 * всех путях: в одном тике с броском и после показа броска, когда ответ
 * сервера эффект из мира уже убрал.
 *
 * Сущности для разбора удара берут только отсюда
 * ({@link listAttackResolutionEntities}, {@link resolveSelectedAttackTarget},
 * {@link withAttackHeldEffects}): место, читающее цель удара мимо снимка,
 * считает удар по миру после расхода.
 */

import type { SceneEntity } from '@vtt/shared';
import type {
  DnDSceneEntity,
  HeldAttackEffect,
} from '@vtt/shared/system/dnd.js';

import { useTargetStore } from '@/stores/targetStore';
import {
  isDndSceneEntity,
  withHeldAttackEffects,
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

/** Что бросок атаки знает о своих сторонах */
export interface AttackRollSnapshot {
  /** Кто атакует */
  attackerId: string;
  /** Цели броска — для сообщения серверу после урона */
  targetIds: readonly string[];
  /**
   * Эффекты сторон, израсходованные этим броском, — по id сущности: какими
   * они были до расхода. Сторона без расхода в снимок не входит
   */
  held: ReadonlyMap<string, readonly HeldAttackEffect[]>;
}

/**
 * Сущность, какой её видит расчёт этого удара: свежая, с эффектами, которые
 * израсходовал бросок этой атаки.
 *
 * @param entity - свежая сущность мира
 * @param attack - снимок броска; нет — удара без броска атаки
 * @returns сущность для расчёта
 */
export function withAttackHeldEffects<Entity extends DnDSceneEntity>(
  entity: Entity,
  attack: AttackRollSnapshot | undefined,
): Entity {
  return withHeldAttackEffects(entity, attack?.held.get(entity.id));
}

/**
 * Сущности мира для разбора удара: стороны атаки — с эффектами, которые
 * израсходовал её бросок. Читается в момент разбора (после ожиданий), поэтому
 * остальное состояние сторон свежее.
 *
 * @param attack - снимок броска; нет — сущности мира как есть
 * @returns сущности мира
 */
export function listAttackResolutionEntities(
  attack: AttackRollSnapshot | undefined,
): SceneEntity[] {
  const entities = useWorldEntities().getCurrentWorldEntities();

  if (!attack || attack.held.size === 0) {
    return entities;
  }

  return entities.map((entity) =>
    isDndSceneEntity(entity) ? withAttackHeldEffects(entity, attack) : entity,
  );
}

/**
 * Выбранная цель удара — из сущностей разбора, а не напрямую из стора целей:
 * запись стора не знает об эффектах, израсходованных броском.
 *
 * @param entities - сущности разбора ({@link listAttackResolutionEntities})
 * @returns цель либо `null`, если цель не выбрана
 */
export function resolveSelectedAttackTarget(
  entities: readonly SceneEntity[],
): SceneEntity | null {
  const target = useTargetStore().getTargetActor();

  if (!target) {
    return null;
  }

  return entities.find((entity) => entity.id === target.id) ?? target;
}
