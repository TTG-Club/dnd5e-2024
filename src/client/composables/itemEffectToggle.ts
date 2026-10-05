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

import {
  isDnDEffect,
  isToggleActivatedEffect,
  switchItemToggle,
  usesPaidHitDiceRoll,
  withSheetResources,
} from '@vtt/shared/system/dnd.js';

import { ITEM_TOGGLE_LABELS } from '../ui/effect/constants';
import { recordEntityActionSpend, warnActionCostBlocked } from './actionSpend';
import { runWithEffectPay } from './effectPayChoice';
import { changeEntitySheet } from './entitySheetWrite';
import { refuseWhileSheetEditing } from './sheetEditLock';
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
  // Новый объект: живую запись стора меняет только ответ сервера
  const toggled: DnDSceneEntity = {
    ...entity,
    equipment: switchItemToggle(
      entity.equipment ?? [],
      item.id,
      effectId,
      on,
      paid,
    ),
  };

  // Оплата могла пройти через вопросы: ресурсы и предметы переносятся на
  // свежую сущность, хиты и эффекты остаются её
  changeEntitySheet(entity.id, (current) =>
    withSheetResources(current, toggled),
  );
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
  // Лист в режиме правки — переключатель ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(entityId)) {
    return;
  }

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

  if (
    warnActionCostBlocked(
      entity,
      cost,
      `${ITEM_TOGGLE_LABELS.blockedTitle}: ${effect.name}`,
    )
  ) {
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
