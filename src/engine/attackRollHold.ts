/**
 * Эффекты, израсходованные броском атаки, — для расчёта этого же удара.
 *
 * Одноразовый эффект («до следующей атаки по носителю», «на своей следующей
 * атаке») расходуется броском атаки: снимается или теряет заряд. По правилам
 * он действует на эту атаку целиком — бросок, урон, защиты цели — и уходит
 * после неё. Расход уезжает на сервер сразу, а урон атаки считается позже
 * (после показа броска, ожидания конца прежней концентрации): к этому времени
 * ответ сервера эффект из мира уже убрал либо ещё нет — и итог зависел от
 * задержки сети.
 *
 * Здесь расход отделён от расчёта: бросок запоминает израсходованные эффекты,
 * какими они были до расхода, и расчёт удара кладёт их поверх свежей
 * сущности. Остальное состояние сущности — свежее: держатся только эффекты,
 * которые израсходовал сам этот бросок.
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { diffEffects } from './combatEffectChanges.js';

/** Эффект, израсходованный броском атаки, и его место в списке носителя */
export interface HeldAttackEffect {
  /** Эффект, каким он был до расхода */
  effect: ActiveEffect;
  /**
   * Место в списке эффектов носителя до расхода: порядок эффектов значим
   * (последняя «установка» одного приоритета побеждает), и удар считается с
   * тем же порядком, пришёл ответ сервера или нет
   */
  index: number;
}

/**
 * Эффекты, которые израсходовал бросок атаки: снятые и изменённые (потерявшие
 * заряд) — какими они были до расхода.
 *
 * @param before - эффекты носителя до броска
 * @param after - эффекты носителя после расхода
 * @returns израсходованные эффекты с местами в списке
 */
export function listHeldAttackEffects(
  before: readonly ActiveEffect[],
  after: readonly ActiveEffect[],
): HeldAttackEffect[] {
  const changes = diffEffects(before, after);

  const consumedIds = new Set([
    ...changes.removeIds,
    ...changes.update.map((effect) => effect.id),
  ]);

  return before.flatMap((effect, index) =>
    consumedIds.has(effect.id) ? [{ effect, index }] : [],
  );
}

/**
 * Сущность с эффектами, израсходованными этой атакой: по ней считается удар.
 * Эффекты встают на прежние места и в прежнем виде — одинаково, успел ответ
 * сервера убрать их из мира или нет. Запись сущности идёт от свежей: сюда
 * она не возвращается.
 *
 * @param entity - свежая сущность мира
 * @param held - эффекты, израсходованные броском этой атаки
 * @returns сущность для расчёта; держать нечего — та же сущность
 */
export function withHeldAttackEffects<Entity extends DnDSceneEntity>(
  entity: Entity,
  held: readonly HeldAttackEffect[] | undefined,
): Entity {
  if (!held || held.length === 0) {
    return entity;
  }

  const heldIds = new Set(held.map((entry) => entry.effect.id));

  const kept = (entity.activeEffects ?? []).filter(
    (effect) => !heldIds.has(effect.id),
  );

  const activeEffects = [...held]
    .sort((left, right) => left.index - right.index)
    .reduce<ActiveEffect[]>(
      (effects, entry) => [
        ...effects.slice(0, entry.index),
        entry.effect,
        ...effects.slice(entry.index),
      ],
      kept,
    );

  return { ...entity, activeEffects };
}
