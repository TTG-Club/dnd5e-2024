/**
 * Кнопка «Прыжок» полки действий: включает у ядра вид перемещения «Прыжок»
 * (`api.movementMode`, VTTG 0.9.751+). Дальше всё делает ядро: под мышкой —
 * прыжок из клетки в клетку дугой и подпись «Прыжок с разбегом · 10 фт»;
 * если с места не допрыгнуть, сначала путь подхода по клеткам и «Сначала
 * пройти …» (VTTG 0.9.754+). Щелчок по клетке — подход и прыжок, Escape или
 * правый щелчок — выход из режима. Числа и подписи вида отдаёт движок
 * (`movementModes.ts`) через `getMovementModes`.
 *
 * Режим локальный: у других участников ничего не рисуется.
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { ActionShelfButton } from './actionShelf';

import {
  JUMP_MOVEMENT_MODE_ID,
  resolveJumpDistances,
  resolveTurnSpeed,
} from '@vtt/shared/system/dnd.js';

import { ACTION_SHELF_BUTTONS } from '../ui/stealth/hideLabels';
import { resolveEntityStats } from './useResolvedStats';

/** Управление режимом вида перемещения — член `ClientSystemAPI` с VTTG 0.9.751 */
type MovementModeControl = ClientSystemAPI['movementMode'];

/**
 * Управление режимом вида перемещения, если ядро его умеет. Тип приложения
 * объявляет член обязательным, но старое приложение (до VTTG 0.9.751) его не
 * даёт — поэтому проверка по факту, как у полки (`actionShelf.ts`).
 *
 * @param api - API ядра для системы
 * @returns управление режимом либо `undefined` на старом приложении
 */
function findMovementModeControl(
  api: ClientSystemAPI,
): MovementModeControl | undefined {
  if (!('movementMode' in api)) {
    return undefined;
  }

  const control = api.movementMode;

  return typeof control === 'object' && typeof control.set === 'function'
    ? control
    : undefined;
}

/**
 * Подсказка кнопки: докуда прыгает герой. Высота — второй строкой подписи у
 * курсора, здесь только длина.
 *
 * @param entity - сущность героя
 * @returns подсказка либо `undefined`, если прыгнуть некуда
 */
function describeJump(entity: DnDSceneEntity): string | undefined {
  const stats = resolveEntityStats(entity);
  const jump = resolveJumpDistances(stats, resolveTurnSpeed(entity, stats));

  if (jump.standingLong <= 0) {
    return undefined;
  }

  if (jump.fixedCost !== undefined) {
    return ACTION_SHELF_BUTTONS.jumpFixedCostTooltip(
      jump.standingLong,
      jump.fixedCost,
    );
  }

  return jump.runningLong > jump.standingLong
    ? ACTION_SHELF_BUTTONS.jumpTooltip(jump.standingLong, jump.runningLong)
    : ACTION_SHELF_BUTTONS.jumpStandingTooltip(jump.standingLong);
}

/**
 * Неизменная часть кнопки «Прыжок»: она же у погашенной кнопки, пока не выбран
 * свой герой (`modules/stealth/register.ts`).
 */
export const JUMP_SHELF_BUTTON_BASE = {
  id: ACTION_SHELF_BUTTONS.jumpId,
  icon: ACTION_SHELF_BUTTONS.jumpIcon,
  label: ACTION_SHELF_BUTTONS.jump,
  hotkey: ACTION_SHELF_BUTTONS.jumpHotkey,
} satisfies ActionShelfButton;

/**
 * Кнопка «Прыжок» для выделенного героя.
 *
 * Горит, пока режим прыжка включён для этой сущности; нажатие на горящую
 * выключает режим. Гаснет, если ход на прыжок не остался (Скорость 0, ход
 * отдан действию) или приложение режима не умеет.
 *
 * @param api - API ядра для системы
 * @param entity - выделенный герой
 * @returns кнопка полки
 */
export function buildJumpShelfButton(
  api: ClientSystemAPI,
  entity: DnDSceneEntity,
): ActionShelfButton {
  const control = findMovementModeControl(api);

  if (!control) {
    return {
      ...JUMP_SHELF_BUTTON_BASE,
      disabled: true,
      disabledReason: ACTION_SHELF_BUTTONS.jumpNeedsHost,
    };
  }

  const tooltip = describeJump(entity);

  if (!tooltip) {
    return {
      ...JUMP_SHELF_BUTTON_BASE,
      disabled: true,
      disabledReason: ACTION_SHELF_BUTTONS.jumpNoMovement,
    };
  }

  const current = control.current();

  const active =
    current?.entityId === entity.id && current.modeId === JUMP_MOVEMENT_MODE_ID;

  return {
    ...JUMP_SHELF_BUTTON_BASE,
    tooltip: active ? ACTION_SHELF_BUTTONS.jumpActiveTooltip : tooltip,
    active,
    // Горящая кнопка выключает режим, а не включает заново
    onClick: () =>
      control.set(
        active ? null : { entityId: entity.id, modeId: JUMP_MOVEMENT_MODE_ID },
      ),
  };
}
