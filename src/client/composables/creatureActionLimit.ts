/**
 * Перезарядка и «раз в N ходов» на клиенте: доступно ли действие, отметка
 * траты и «Восстановить». Правила — в движке (`actionLimit.ts`); здесь только
 * бой по трекеру клиента, подписи и запись журнала боевым каналом.
 */

import type {
  ActionLimit,
  ActionLimitState,
  CreatureAction,
  CreatureSpellGroup,
  DnDCreature,
} from '@vtt/shared/system/dnd.js';

import {
  ACTION_LIMIT_READY_STATE,
  buildActionLimitKey,
  buildSpellGroupLimitKey,
  formatRechargeRange,
  isRolledRecharge,
  readActionLimitState,
  readTriggerUsage,
  resolveActionLimit,
  resolveSpellGroupLimit,
  restoreActionLimit,
  spendActionLimit,
  withTriggerUsage,
} from '@vtt/shared/system/dnd.js';

import {
  CREATURE_ACTION_LIMIT_LABELS,
  formatTurnCount,
} from '../ui/creature/constants';
import { isEntityInCombat } from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import { refuseWhileSheetEditing } from './sheetEditLock';

/** Ключ журнала и ограничение записи либо группы */
export interface LimitedTarget {
  key: string;
  limit: ActionLimit;
}

/**
 * Ключ и ограничение записи статблока. Записи без `id` (не прошла
 * нормализацию) не учитываются: держаться ей в журнале не за что.
 *
 * @param action - запись статблока
 * @returns ключ и ограничение либо `undefined`
 */
export function resolveActionLimitTarget(
  action: CreatureAction,
): LimitedTarget | undefined {
  const limit = resolveActionLimit(action);

  return action.id && limit
    ? { key: buildActionLimitKey(action.id), limit }
    : undefined;
}

/**
 * Ключ и ограничение группы заклинаний.
 *
 * @param group - группа
 * @returns ключ и ограничение либо `undefined`
 */
export function resolveSpellGroupLimitTarget(
  group: CreatureSpellGroup,
): LimitedTarget | undefined {
  const limit = resolveSpellGroupLimit(group);

  return limit ? { key: buildSpellGroupLimitKey(group.id), limit } : undefined;
}

/**
 * Состояние записи или группы у существа сейчас.
 *
 * @param creature - существо
 * @param target - ключ и ограничение
 * @returns состояние
 */
export function readLimitedTargetState(
  creature: DnDCreature,
  target: LimitedTarget | undefined,
): ActionLimitState {
  return target
    ? readActionLimitState(
        readTriggerUsage(creature),
        target.key,
        target.limit,
        isEntityInCombat(creature.id),
      )
    : ACTION_LIMIT_READY_STATE;
}

/**
 * Почему действие сейчас не применить — словами.
 *
 * @param state - состояние ограничения
 * @returns причина либо `null`, если доступно
 */
export function formatActionLimitBlock(state: ActionLimitState): string | null {
  if (state.status === 'ready') {
    return null;
  }

  if (state.status === 'cooldown') {
    return `${CREATURE_ACTION_LIMIT_LABELS.cooldownWaitPrefix}${formatTurnCount(state.turnsLeft)}`;
  }

  return isRolledRecharge(state.recharge)
    ? `${CREATURE_ACTION_LIMIT_LABELS.rechargingPrefix}(${formatRechargeRange(state.recharge)})${CREATURE_ACTION_LIMIT_LABELS.rechargingSuffix}`
    : CREATURE_ACTION_LIMIT_LABELS.restRecharge;
}

/**
 * Почему запись статблока сейчас не применить по своему ограничению.
 *
 * @param creature - существо
 * @param action - запись статблока
 * @returns причина либо `null`
 */
export function findActionLimitBlock(
  creature: DnDCreature,
  action: CreatureAction,
): string | null {
  return formatActionLimitBlock(
    readLimitedTargetState(creature, resolveActionLimitTarget(action)),
  );
}

/**
 * Почему из группы заклинаний сейчас не колдовать по её ограничению.
 *
 * @param creature - существо
 * @param group - группа каста; нет — ограничения нет
 * @returns причина либо `null`
 */
export function findSpellGroupLimitBlock(
  creature: DnDCreature,
  group: CreatureSpellGroup | undefined,
): string | null {
  return group
    ? formatActionLimitBlock(
        readLimitedTargetState(creature, resolveSpellGroupLimitTarget(group)),
      )
    : null;
}

/**
 * Отмечает применение: действие потрачено. Журнал едет боевым каналом —
 * листом его не записать.
 *
 * @param creatureId - существо
 * @param target - ключ и ограничение; нет — отмечать нечего
 */
export function spendLimitedTarget(
  creatureId: string,
  target: LimitedTarget | undefined,
): void {
  if (!target) {
    return;
  }

  changeEntityCombatState(creatureId, (current) => {
    const ledger = spendActionLimit(
      readTriggerUsage(current),
      target.key,
      target.limit,
      isEntityInCombat(current.id),
    );

    return ledger ? withTriggerUsage(current, ledger) : null;
  });
}

/**
 * Снимает отметку траты — «Восстановить» с листа.
 *
 * @param creatureId - существо
 * @param target - ключ и ограничение
 */
export function restoreLimitedTarget(
  creatureId: string,
  target: LimitedTarget | undefined,
): void {
  // Лист существа в режиме правки — отметка ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(creatureId)) {
    return;
  }

  if (!target) {
    return;
  }

  changeEntityCombatState(creatureId, (current) => {
    const ledger = restoreActionLimit(readTriggerUsage(current), target.key);

    return ledger ? withTriggerUsage(current, ledger) : null;
  });
}
