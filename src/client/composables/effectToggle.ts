/**
 * Включение и выключение эффекта сущности без листа — кнопкой панели быстрого
 * доступа («Ярость»).
 *
 * Включение делает то же, что переключатель на вкладке «Эффекты»: тратит
 * ресурс листа, включает эффект и будит его срабатывания «при включении».
 * Ресурс и эффект уходят разными каналами: боевой канал несёт хиты и эффекты,
 * а счётчики листа в него не входят — их пишет обычное сохранение сущности.
 * Порядок важен: сначала ресурс, потом эффект — полное сохранение несёт и
 * эффекты, и, пришедшее вторым, оно вернуло бы эффект выключенным.
 */

import type {
  ActiveEffect,
  ActorCounterState,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState, emitEntityUpdate } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { isActorEntity } from '@vtt/shared';
import {
  activateEffectOnEntity,
  canPayActivation,
  payActivation,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { EFFECT_USE_LABELS } from '../ui/effect/constants';
import { resolveCombatRound } from './encounterTurn';
import { stampEffectOnApply } from './spellResolutionShared';
import { useWorldEntities } from './useWorldEntities';

/**
 * Ресурсы листа, которые тратит включение. У существа их нет.
 *
 * @param entity - сущность
 * @returns счётчики листа
 */
export function readEntityCounters(
  entity: DnDSceneEntity,
): readonly ActorCounterState[] {
  return isActorEntity(entity) ? (entity.system.classCounters ?? []) : [];
}

/**
 * Сущность после оплаты включения: ресурс списан. Эффект без расхода ресурса
 * сущность не меняет.
 *
 * @param entity - сущность
 * @param effect - включаемый эффект
 * @returns сущность с новыми счётчиками либо та же сущность
 */
function payEntityActivation(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
): DnDSceneEntity {
  if (!effect.activation?.counter || !isActorEntity(entity)) {
    return entity;
  }

  return {
    ...entity,
    system: {
      ...entity.system,
      classCounters: payActivation(
        entity.system.classCounters ?? [],
        effect.activation,
      ),
    },
  };
}

/**
 * Предупреждает, что ресурса на включение не хватает.
 *
 * @param counterKey - ресурс включения
 */
function warnNoCounter(counterKey: string): void {
  useSystemToastStore().add({
    title: EFFECT_USE_LABELS.noCounterTitle,
    description: `${EFFECT_USE_LABELS.noCounterPrefix}${counterKey}${EFFECT_USE_LABELS.noCounterSuffix}`,
    color: 'warning',
  });
}

/**
 * Включает выключенный эффект сущности мира или выключает включённый.
 *
 * @param entityId - сущность
 * @param effectId - эффект
 */
export function toggleEntityEffect(entityId: string, effectId: string): void {
  const socket = useChatStore().getSocket();
  const entity = useWorldEntities().findCurrentDndEntity(entityId);
  const effect = entity?.activeEffects?.find((entry) => entry.id === effectId);

  if (!socket || !entity || !effect) {
    return;
  }

  if (!effect.disabled) {
    emitEntityCombatState(socket, {
      ...entity,
      activeEffects: (entity.activeEffects ?? []).map((entry) =>
        entry.id === effectId ? { ...entry, disabled: true } : entry,
      ),
    });

    return;
  }

  // Не хватить может только ресурса: без счётчика включение бесплатно
  const counterKey = effect.activation?.counter;

  if (
    counterKey
    && !canPayActivation(readEntityCounters(entity), effect.activation)
  ) {
    warnNoCounter(counterKey);

    return;
  }

  const paid = payEntityActivation(entity, effect);

  if (paid !== entity) {
    emitEntityUpdate(socket, paid);
  }

  emitEntityCombatState(
    socket,
    activateEffectOnEntity(
      paid,
      effectId,
      (activated) =>
        stampEffectOnApply(activated, {
          carrierId: entity.id,
          sourceId: entity.id,
        }),
      resolveCombatRound(),
    ),
  );
}
