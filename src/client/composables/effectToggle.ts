/**
 * Включение и выключение эффекта сущности без листа — кнопкой панели быстрого
 * доступа («Ярость»).
 *
 * Включение делает то же, что переключатель на вкладке «Эффекты»: тратит
 * ресурс листа, включает эффект и будит его срабатывания «при включении».
 * Одно включение горит одним эффектом: включение другого варианта или копии
 * «Ярости» при горящем включении его сменяет и ресурс не тратит.
 * Ресурс и эффект уходят разными каналами: боевой канал несёт хиты и эффекты,
 * а счётчики листа в него не входят — их пишет обычное сохранение сущности.
 * Порядок важен: сначала ресурс, потом эффект — полное сохранение несёт и
 * эффекты, и, пришедшее вторым, оно вернуло бы эффект выключенным.
 */

import type {
  ActiveEffect,
  ActorCounterState,
  DnDSceneEntity,
  EffectPaid,
} from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';
import { isActorEntity } from '@vtt/shared';
import {
  activateEffectOnEntity,
  buildEffectToggleChoice,
  canSwitchOnEffect,
  collectEffectToggleGroup,
  findBurningActivationPeer,
  needsActivationPayment,
  payActivation,
  stampEffectPaid,
  usesPaidHitDiceRoll,
  withSheetResources,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { EFFECT_USE_LABELS, ITEM_TOGGLE_LABELS } from '../ui/effect/constants';
import { recordEntityActionSpend, warnActionCostBlocked } from './actionSpend';
import {
  emitActedEntity,
  runWithEffectPay,
  sendSelfTriggerReport,
} from './effectPayChoice';
import { runWithEffectVariants } from './effectVariantChoice';
import { resolveCombatRound } from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import { changeEntitySheet } from './entitySheetWrite';
import { refuseWhileSheetEditing } from './sheetEditLock';
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
 * Сущность после оплаты включения или применения: ресурс списан. Эффект без
 * расхода ресурса сущность не меняет.
 *
 * @param entity - сущность
 * @param effect - включаемый или применяемый эффект
 * @returns сущность с новыми счётчиками либо та же сущность
 */
export function payEntityActivation(
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
 * Предупреждает, что ресурса на включение или применение не хватает.
 *
 * @param counterKey - ресурс включения
 */
export function warnNoCounter(counterKey: string): void {
  useSystemToastStore().add({
    title: EFFECT_USE_LABELS.noCounterTitle,
    description: `${EFFECT_USE_LABELS.noCounterPrefix}${counterKey}${EFFECT_USE_LABELS.noCounterSuffix}`,
    color: 'warning',
  });
}

/**
 * Включает выключенный эффект сущности мира или выключает включённый.
 *
 * Варианты одного переключателя («Ярость диких земель»: Медведь, Орёл, Волк)
 * — одна кнопка: включён любой из них — выключаются все, выключены все —
 * вариант выбирают плашкой (или бросают случайно), и включается он один.
 *
 * @param entityId - сущность
 * @param effectId - эффект
 */
export function toggleEntityEffect(entityId: string, effectId: string): void {
  // Лист в режиме правки — переключатель ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(entityId)) {
    return;
  }

  const socket = useChatStore().getSocket();
  const entity = useWorldEntities().findCurrentDndEntity(entityId);
  const effects = entity?.activeEffects ?? [];
  const effect = effects.find((entry) => entry.id === effectId);

  if (!socket || !entity || !effect) {
    return;
  }

  const group = collectEffectToggleGroup(effects, effect);

  const switchedOnIds = new Set(
    group.filter((entry) => !entry.disabled).map((entry) => entry.id),
  );

  if (switchedOnIds.size > 0) {
    changeEntityCombatState(entityId, (current) => ({
      ...current,
      activeEffects: (current.activeEffects ?? []).map((entry) =>
        switchedOnIds.has(entry.id) ? switchOffEffect(entry) : entry,
      ),
    }));

    return;
  }

  // Не хватить может только ресурса: без счётчика включение бесплатно, а
  // при горящем включении («Ярость» класса) смена на вариант — тоже.
  // Ресурс у вариантов общий — он входит в ключ группы
  const counterKey = effect.activation?.counter;

  if (
    counterKey
    && !canSwitchOnEffect(readEntityCounters(entity), effects, effect)
  ) {
    warnNoCounter(counterKey);

    return;
  }

  // Запрет траты хода («нет бонусных действий») — до выбора варианта
  if (
    warnActionCostBlocked(
      entity,
      effect.activation?.cost,
      `${ITEM_TOGGLE_LABELS.blockedTitle}: ${effect.name}`,
    )
  ) {
    return;
  }

  runWithEffectVariants(buildEffectToggleChoice(group), (chosen) => {
    const [picked] = chosen.activeEffects;

    if (picked) {
      switchOnEntityEffect(entityId, picked.id);
    }
  });
}

/**
 * Выключенный переключатель: потраченное при включении (`paid`) с ним не
 * остаётся — следующее включение заплатит заново и получит свои числа.
 *
 * @param effect - включённый эффект
 * @returns выключенный эффект
 */
function switchOffEffect(effect: ActiveEffect): ActiveEffect {
  const { paid: _paid, ...switchedOff } = effect;

  return { ...switchedOff, disabled: true };
}

/**
 * Включает эффект: тратит ресурс и цену (если включение не горит) и будит
 * срабатывания «при включении».
 * Сущность перечитывается — между нажатием и выбором варианта она могла
 * измениться.
 *
 * @param entityId - сущность
 * @param effectId - включаемый эффект
 */
function switchOnEntityEffect(entityId: string, effectId: string): void {
  const socket = useChatStore().getSocket();
  const entity = useWorldEntities().findCurrentDndEntity(entityId);
  const effects = entity?.activeEffects ?? [];
  const effect = effects.find((entry) => entry.id === effectId);

  if (!socket || !entity || !effect) {
    return;
  }

  // Смена эффекта внутри горящего включения — то же включение, без траты
  const paysCounter = needsActivationPayment(effects, effect);

  const pay =
    findBurningActivationPeer(effects, effect) === undefined
      ? effect.pay
      : undefined;

  /**
   * Включает эффект на уже оплаченной сущности и шлёт сводку в чат.
   *
   * @param paidEntity - сущность со списанными ресурсами
   * @param paid - потраченное ценой; нет — цены не было
   */
  const activate = (paidEntity: DnDSceneEntity, paid?: EffectPaid): void => {
    const report = { notes: [], results: [] };

    const activated = activateEffectOnEntity(
      paidEntity,
      effectId,
      (switched) =>
        stampEffectOnApply(
          // Переключатель остаётся шаблоном: числа потраченного — полем `paid`
          paid ? stampEffectPaid(switched, paid, true) : switched,
          { carrierId: entity.id, sourceId: entity.id },
        ),
      resolveCombatRound(),
      { report },
    );

    emitActedEntity(paidEntity, activated);

    // Включение состоялось — трата хода в счёт («Замедление»)
    recordEntityActionSpend(entityId, effect.activation?.cost);

    sendSelfTriggerReport(entity.name, report);
  };

  if (!pay) {
    const paidEntity = paysCounter
      ? payEntityActivation(entity, effect)
      : entity;

    if (paidEntity !== entity) {
      changeEntitySheet(entityId, (current) =>
        withSheetResources(current, paidEntity),
      );
    }

    activate(paidEntity);

    return;
  }

  let paidEntity = entity;

  runWithEffectPay(
    {
      payer: entity,
      pay,
      sourceName: effect.name,
      context: { rollHitDice: usesPaidHitDiceRoll(effect) },
      // Цена и счётчик включения — одним сохранением: два подряд затёрли бы
      // друг друга
      commit: (settled) => {
        paidEntity = paysCounter
          ? payEntityActivation(settled, effect)
          : settled;

        const spent = paidEntity;

        // Цена спрошена у человека: ресурсы переносятся на свежую сущность
        changeEntitySheet(entityId, (current) =>
          withSheetResources(current, spent),
        );
      },
    },
    (paid) => {
      activate(paidEntity, paid);
    },
  );
}
