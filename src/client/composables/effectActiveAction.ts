/**
 * Кнопка «При действии» действующего эффекта — на листе и без него.
 *
 * Срабатывания «При действии» выполняет клиент: цена ресурсом спрашивается
 * плашкой, хиты и эффекты уходят боевым каналом, ресурсы листа — обычным
 * сохранением, а сводка (урон, лечение, строки «Сообщить», списанная цена) — в
 * чат. Сервер такую сводку собирает сам, клиенту её приходится писать руками.
 */

import {
  bindLivePaid,
  buildEffectActionEvent,
  listEffectActiveActions,
  listEffectSelfActions,
  listEffectServerActions,
  planEffectPay,
  resolveEffectActionTemplate,
  runEffectActiveAction,
  toUseAreaOfEffect,
  usesPaidHitDiceRoll,
} from '@vtt/shared/system/dnd.js';

import { recordEntityActionSpend } from './actionSpend';
import { placeAreaTemplate } from './areaTemplateTargets';
import {
  choosePayOptions,
  emitActedEntity,
  sendSelfTriggerReport,
  warnPayShortfall,
} from './effectPayChoice';
import { resolveCombatRound } from './encounterTurn';
import { emitSystemClientEvent } from './systemClientEvents';
import { useWorldEntities } from './useWorldEntities';

/**
 * Запускает действие действующего эффекта сущности мира: цена срабатывания,
 * трата хода, сами срабатывания и сводка в чат.
 *
 * Запрет траты хода («нет реакций») проверяет вызывающий — у него есть куда
 * показать причину.
 *
 * @param entityId - носитель эффекта
 * @param effectId - эффект, чьё действие запускают
 */
export function runEntityEffectAction(
  entityId: string,
  effectId: string,
): void {
  const worldEntities = useWorldEntities();
  const entity = worldEntities.findCurrentDndEntity(entityId);
  const effect = entity?.activeEffects?.find((entry) => entry.id === effectId);

  if (!entity || !effect) {
    return;
  }

  // Цена считается по формулам с потраченным при включении — как и действия
  const boundEffect = bindLivePaid(effect);
  const [action] = listEffectActiveActions(boundEffect);

  // Действия другим (всем в радиусе, под шаблоном, наложившему) выполняет
  // сервер: он знает сцену и просит спасброски у владельцев. О цене таких
  // срабатываний он спрашивает сам
  const hasServerActions = listEffectServerActions(boundEffect).length > 0;
  const actions = listEffectSelfActions(boundEffect);
  const paying = actions.find((trigger) => trigger.pay !== undefined);

  /**
   * Отдаёт серверу срабатывания с действиями другим. Шаблон кнопки ставит
   * нажавший — серверу уходят те, кого он накрыл.
   */
  const runServerActions = (): void => {
    if (!hasServerActions) {
      return;
    }

    const template = resolveEffectActionTemplate(boundEffect);

    if (!template) {
      emitSystemClientEvent(buildEffectActionEvent(entityId, effectId));

      return;
    }

    // Шаблон ставится от фишки носителя, без предела расстояния
    placeAreaTemplate(
      toUseAreaOfEffect(template),
      entityId,
      null,
      (targetIds) => {
        emitSystemClientEvent(
          buildEffectActionEvent(entityId, effectId, targetIds),
        );
      },
    );
  };

  /**
   * Выполняет срабатывания «При действии».
   *
   * @param payPickIds - выбранные варианты цены; нет — цены с выбором нет
   */
  const run = (payPickIds?: ReadonlySet<string>): void => {
    // Носитель перечитывается: пока выбирали, лист мог измениться
    const current = worldEntities.findCurrentDndEntity(entityId);

    if (!current) {
      return;
    }

    recordEntityActionSpend(entityId, action?.cost);

    const report = { notes: [], results: [] };

    const acted = runEffectActiveAction(
      current,
      effectId,
      resolveCombatRound(),
      { ...(payPickIds ? { payPickIds } : {}), report },
    );

    emitActedEntity(current, acted);

    sendSelfTriggerReport(current.name, report);

    runServerActions();
  };

  if (!paying?.pay) {
    run();

    return;
  }

  const plan = planEffectPay(entity, paying.pay, {
    ...(effect.carriedItemId ? { itemId: effect.carriedItemId } : {}),
    rollHitDice: usesPaidHitDiceRoll(paying),
  });

  if (plan.shortfall !== null) {
    warnPayShortfall(effect.name, plan.shortfall);

    return;
  }

  choosePayOptions(plan, effect.name, run);
}
