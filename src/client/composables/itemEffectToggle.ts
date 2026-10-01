/**
 * Переключатель эффекта предмета: «Язык пламени» зажигают и гасят командным
 * словом, «Ослепительное оружие» светит по желанию владельца.
 *
 * Эффект предмета лежит в инвентаре, а не среди эффектов листа, поэтому
 * включение — правка инвентаря обычным сохранением сущности (боевой канал
 * инвентаря не несёт). Включение проверяет запрет траты хода, берёт цену
 * ресурсом (заряды предмета — та же «Цена») и пишет трату в счёт хода;
 * выключение ничего не стоит.
 */

import type {
  DnDGameItem,
  DnDSceneEntity,
  EffectPaid,
} from '@vtt/shared/system/dnd.js';

import { emitEntityUpdate } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import {
  formatActionCostBlock,
  isDnDEffect,
  isToggleActivatedEffect,
  resolveActionCostBlock,
  switchItemToggle,
  usesPaidHitDiceRoll,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { ITEM_TOGGLE_LABELS } from '../ui/effect/constants';
import { recordEntityActionSpend } from './actionSpend';
import { runWithEffectPay } from './effectPayChoice';
import { listAmbientEffects } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/**
 * Записывает инвентарь сущности с переключённым эффектом предмета.
 *
 * @param entity - владелец предмета (уже с оплаченной ценой)
 * @param item - предмет
 * @param effectId - переключатель
 * @param on - включить или выключить
 * @param paid - потраченное ценой при включении
 */
function commitItemToggle(
  entity: DnDSceneEntity,
  item: DnDGameItem,
  effectId: string,
  on: boolean,
  paid?: EffectPaid,
): void {
  const socket = useChatStore().getSocket();

  if (!socket) {
    return;
  }

  // Новый объект: живую запись стора меняет только ответ сервера
  const updated: DnDSceneEntity = {
    ...entity,
    equipment: switchItemToggle(
      entity.equipment ?? [],
      item.id,
      effectId,
      on,
      paid,
    ),
  };

  emitEntityUpdate(socket, updated);
}

/**
 * Включает выключенный эффект предмета или выключает включённый.
 *
 * @param entityId - владелец предмета
 * @param itemId - предмет
 * @param effectId - эффект-переключатель предмета
 */
export function toggleEntityItemEffect(
  entityId: string,
  itemId: string,
  effectId: string,
): void {
  const entity = useWorldEntities().findCurrentDndEntity(entityId);
  const item = entity?.equipment?.find((candidate) => candidate.id === itemId);

  const effect = item?.activeEffects
    ?.filter(isDnDEffect)
    .find((candidate) => candidate.id === effectId);

  if (!entity || !item || !effect || !isToggleActivatedEffect(effect)) {
    return;
  }

  // Выключение ничего не стоит
  if (effect.disabled !== true) {
    commitItemToggle(entity, item, effectId, false);

    return;
  }

  const cost = effect.activation?.cost;

  const blocked = resolveActionCostBlock(
    entity,
    cost,
    listAmbientEffects(entityId),
  );

  if (blocked) {
    useSystemToastStore().add({
      title: `${ITEM_TOGGLE_LABELS.blockedTitle}: ${effect.name}`,
      description: formatActionCostBlock(blocked),
      color: 'warning',
    });

    return;
  }

  if (!effect.pay) {
    commitItemToggle(entity, item, effectId, true);
    recordEntityActionSpend(entityId, cost);

    return;
  }

  // Цена и включение — одним сохранением: два подряд затёрли бы друг друга
  let paidEntity = entity;

  runWithEffectPay(
    {
      payer: entity,
      pay: effect.pay,
      sourceName: `${item.name}: ${effect.name}`,
      context: { itemId, rollHitDice: usesPaidHitDiceRoll(effect) },
      commit: (settled) => {
        paidEntity = settled;
      },
    },
    (paid) => {
      commitItemToggle(paidEntity, item, effectId, true, paid);
      recordEntityActionSpend(entityId, cost);
    },
  );
}
