import type { Ref } from 'vue';

import type {
  ActiveEffect,
  DnDActor,
  DnDCreature,
  DnDSceneEntity,
  ResolvedActorStats,
} from '@vtt/shared/system/dnd.js';

import { computed } from 'vue';

import { useAuraStore } from '@/stores/auraStore';
import { systemRegistry } from '@vtt/shared';
import {
  collectActiveEffects,
  combineEffectsWithAmbient,
  isActiveEffect,
  isDnDEffect,
  resolveActorStats,
} from '@vtt/shared/system/dnd.js';

/**
 * Ауры карты, которые накрывают сущность, в форме D&D: контракт отдаёт их
 * нейтральной базой.
 *
 * @param entityId - сущность
 * @returns эффекты аур
 */
export function listAmbientEffects(entityId: string): ActiveEffect[] {
  return useAuraStore().getAmbientEffectsForActor(entityId).filter(isDnDEffect);
}

/**
 * Действующие эффекты сущности вместе с аурами карты.
 *
 * @param entity - сущность
 * @returns эффекты без дублей одноимённых
 */
export function collectEffectsWithAuras(
  entity: DnDSceneEntity,
): readonly ActiveEffect[] {
  return combineEffectsWithAmbient(
    collectActiveEffects(entity),
    listAmbientEffects(entity.id),
  );
}

/**
 * Хук для реактивного получения итоговых статов актера
 * с учетом всех Active Effects и базовых формул системы.
 *
 * @param actorRef - ссылка на актёра или существо листа
 * @returns итоговые статы и полный список действующих эффектов
 */
export function useResolvedStats(
  actorRef: Ref<DnDActor | DnDCreature | null | undefined>,
) {
  const combinedEffects = computed<ActiveEffect[]>(() => {
    const actor = actorRef.value;

    if (!actor) {
      return [];
    }

    const system = systemRegistry.getSystem();

    // Контракт отдаёт эффекты непрозрачным `unknown[]` — сужаем гвардом движка
    const nativeEffects = (
      system.collectActiveEffects ? system.collectActiveEffects(actor) : []
    ).filter(isActiveEffect);

    const ambientEffects = listAmbientEffects(actor.id);

    // Отсев дублей — правило движка «одноимённые эффекты не складываются»:
    // повторять его здесь нельзя, иначе две реализации разойдутся
    return combineEffectsWithAmbient(nativeEffects, ambientEffects);
  });

  /**
   * Итоговые вычисленные статы. Пересчитываются при изменении
   * базовых атрибутов актера или списка активных эффектов.
   */
  const resolvedStats = computed<ResolvedActorStats | undefined>(() => {
    const actor = actorRef.value;

    if (!actor) {
      return undefined;
    }

    try {
      return resolveActorStats(actor, combinedEffects.value);
    } catch (error: unknown) {
      console.error('[useResolvedStats] Ошибка разрешения эффектов:', error);

      return undefined;
    }
  });

  return {
    resolvedStats,
    combinedEffects,
  };
}
