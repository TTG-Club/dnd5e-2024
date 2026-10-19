/**
 * Начало хода существа для ограничений действий: «раз в N ходов» отсчитывает
 * ход, потраченные перезарядки просят бросок к6.
 *
 * Бросок перезарядки не кидает сервер: его кидает мастер или хозяин существа
 * в своём окне и сам выбирает, кому показать результат. Сообщение сервера в
 * чате скрыть нельзя — у ядра нет видимости для `chatSummary`/`chatRolls`
 * (README, § «Чего не хватает», п. 11), а у существа мастера бросок должен
 * видеть только мастер. Поэтому даже «кидать
 * автоматически» отвечает клиент адресата, без окна. Сервер бросает сам, только
 * когда спросить некого.
 */

import type {
  RollRequestOutcome,
  SceneEntity,
  ServerRollRequester,
  SystemDeferredTrigger,
  SystemDeferredTriggerResult,
  SystemTriggerContext,
} from '@vtt/shared';

import type { SpentRecharge } from './actionLimit.js';
import type { DnDCreature } from './dndEntities.js';

import {
  advanceActionCooldowns,
  buildActionRechargeRequest,
  formatRechargeOutcome,
  isRechargeSuccess,
  listSpentRecharges,
  readActionRechargeAnswer,
  RECHARGE_ROLL_FORMULA,
  restoreActionLimit,
} from './actionLimit.js';
import { rollDamageFormula } from './diceFormula.js';
import { readTriggerUsage, writeTriggerUsage } from './effectTriggerUsage.js';
import { isDndCreature } from './entityGuards.js';

/** Разделитель частей ключа ожидания ответа */
const PENDING_KEY_SEPARATOR = ':';

/** Начало ключа ожидания ответа у перезарядки */
const PENDING_KEY_PREFIX = 'recharge';

/** Пометка строки чата, если бросил сервер */
const SERVER_ROLL_NOTE = ' (бросок сервера: спросить было некого)';

/**
 * Что бросило к6: ответ человека, бросок сервера либо ничего. Адресат закрыл
 * окно, истёк срок, ответ негоден — действие остаётся потраченным до
 * следующего хода. Адресата нет в сети или сервер не принял запрос — бросает
 * сервер: спросить некого будет и в следующий ход, и действие не вернулось бы
 * до отдыха.
 *
 * @param outcome - исход запроса
 * @returns значение к6 и бросил ли сервер; `null` — броска нет
 */
function resolveRechargeTotal(
  outcome: RollRequestOutcome,
): { total: number; byServer: boolean } | null {
  if (outcome.status === 'answered' || outcome.status === 'takenOver') {
    const total = readActionRechargeAnswer(outcome.result);

    return total === null ? null : { total, byServer: false };
  }

  if (outcome.status === 'noRecipient' || outcome.status === 'rejected') {
    return {
      total: rollDamageFormula(RECHARGE_ROLL_FORMULA).total,
      byServer: true,
    };
  }

  return null;
}

/**
 * Применение броска к живой сущности: успех снимает отметку действия.
 *
 * @param entity - живая сущность на момент ответа
 * @param spent - потраченное действие
 * @param total - выпавшее на к6
 * @param byServer - бросил сервер
 * @returns исход для ядра
 */
function applyRechargeRoll(
  entity: SceneEntity,
  spent: SpentRecharge,
  total: number,
  byServer: boolean,
): SystemDeferredTriggerResult {
  if (!isDndCreature(entity)) {
    return { changed: false, chatSummary: null };
  }

  const ledger = readTriggerUsage(entity);

  const restored = isRechargeSuccess(total, spent.recharge)
    ? restoreActionLimit(ledger, spent.key)
    : null;

  if (restored) {
    writeTriggerUsage(entity, restored);
  }

  // Строка в чат только от сервера: человек, бросивший в окне, уже показал
  // свой бросок тем, кому выбрал, — общая строка раскрыла бы его всем
  return {
    changed: restored !== null,
    chatSummary: byServer
      ? `${formatRechargeOutcome(entity.name, spent.name, spent.recharge, total)}${SERVER_ROLL_NOTE}`
      : null,
  };
}

/**
 * Запрос броска одной перезарядки.
 *
 * @param creature - существо
 * @param spent - потраченное действие
 * @param requestRoll - запрос броска от ядра
 * @returns отложенное срабатывание
 */
function requestRecharge(
  creature: DnDCreature,
  spent: SpentRecharge,
  requestRoll: ServerRollRequester,
): SystemDeferredTrigger {
  const resolution = requestRoll(
    buildActionRechargeRequest(creature, spent),
  ).then(
    (outcome) => {
      const rolled = resolveRechargeTotal(outcome);

      return rolled
        ? (entity: SceneEntity) =>
            applyRechargeRoll(entity, spent, rolled.total, rolled.byServer)
        : null;
    },
    () => null,
  );

  return { entityId: creature.id, blocksMovement: false, resolution };
}

/**
 * Начало хода существа: отсчёт «раз в N ходов» и запросы перезарядки.
 *
 * Без запроса броска от ядра (старое ядро) перезарядку бросает сервер сразу.
 *
 * @param entity - сущность, чей ход начался (мутируется: это рабочая копия ядра)
 * @param context - возможности ядра
 * @param pendingKeys - запросы, уже ждущие ответа
 * @returns исход для ядра
 */
export function settleActionLimitsOnTurnStart(
  entity: SceneEntity,
  context: SystemTriggerContext | undefined,
  pendingKeys: Set<string>,
): SystemDeferredTriggerResult {
  if (!isDndCreature(entity)) {
    return { changed: false, chatSummary: null };
  }

  const advanced = advanceActionCooldowns(readTriggerUsage(entity));

  if (advanced) {
    writeTriggerUsage(entity, advanced);
  }

  const spentList = listSpentRecharges(entity, readTriggerUsage(entity));
  const requestRoll = context?.requestRoll;

  if (!requestRoll) {
    const results = spentList.map((spent) =>
      applyRechargeRoll(
        entity,
        spent,
        rollDamageFormula(RECHARGE_ROLL_FORMULA).total,
        true,
      ),
    );

    const summaries = results.flatMap((result) =>
      result.chatSummary ? [result.chatSummary] : [],
    );

    return {
      changed: advanced !== null || results.some((result) => result.changed),
      chatSummary: summaries.join('\n') || null,
    };
  }

  const deferred = spentList.flatMap((spent) => {
    const pendingKey = [PENDING_KEY_PREFIX, entity.id, spent.key].join(
      PENDING_KEY_SEPARATOR,
    );

    // Прежний запрос этого действия ещё ждёт ответа — второй не нужен
    if (pendingKeys.has(pendingKey)) {
      return [];
    }

    pendingKeys.add(pendingKey);

    const trigger = requestRecharge(entity, spent, requestRoll);

    void trigger.resolution.finally(() => {
      pendingKeys.delete(pendingKey);
    });

    return [trigger];
  });

  return {
    changed: advanced !== null,
    chatSummary: null,
    ...(deferred.length > 0 ? { deferred } : {}),
  };
}
