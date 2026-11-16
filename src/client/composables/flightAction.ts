/**
 * Кнопки «Полёт» и «Левитация» полки действий.
 *
 * Полёт и левитация — виды перемещения системы (`movementModes.ts`) со своей
 * Скоростью и правом менять высоту (VTTG 0.9.780). Кнопка есть, только когда
 * вид у героя есть: Скорость полёта (у существа или от эффекта «Полёт»), флаг
 * «Левитация». Нажатие включает вид СОСТОЯНИЕМ фишки
 * (`Token.activeMovementModeId`, `api.movementMode.setActive`): перетаскивание
 * меряется полётом, высота меняется, летун не падает.
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { ActionShelfButton } from './actionShelf';

import { useWorldStore } from '@/stores/worldStore';
import {
  buildVerticalMovementModes,
  FLY_MOVEMENT_MODE_ID,
  LEVITATE_MOVEMENT_MODE_ID,
  resolveMovementModesState,
} from '@vtt/shared/system/dnd.js';

import { ACTION_SHELF_BUTTONS } from '../ui/stealth/hideLabels';
import { findMovementModeControl } from './jumpAction';
import { resolveEntityStats } from './useResolvedStats';

/** Вид перемещения, которому полагается кнопка полки */
interface FlightButtonSpec {
  /** Id вида */
  modeId: string;
  /** Id кнопки */
  id: string;
  /** Значок */
  icon: string;
  /** Подпись */
  label: string;
  /** Подсказка выключенной кнопки */
  tooltip: string;
  /** Подсказка горящей */
  activeTooltip: string;
}

/** Кнопки полки по видам — в порядке на полке */
const FLIGHT_BUTTON_SPECS: readonly FlightButtonSpec[] = [
  {
    modeId: FLY_MOVEMENT_MODE_ID,
    id: ACTION_SHELF_BUTTONS.flyId,
    icon: ACTION_SHELF_BUTTONS.flyIcon,
    label: ACTION_SHELF_BUTTONS.fly,
    tooltip: ACTION_SHELF_BUTTONS.flyTooltip,
    activeTooltip: ACTION_SHELF_BUTTONS.flyActiveTooltip,
  },
  {
    modeId: LEVITATE_MOVEMENT_MODE_ID,
    id: ACTION_SHELF_BUTTONS.levitateId,
    icon: ACTION_SHELF_BUTTONS.levitateIcon,
    label: ACTION_SHELF_BUTTONS.levitate,
    tooltip: ACTION_SHELF_BUTTONS.levitateTooltip,
    activeTooltip: ACTION_SHELF_BUTTONS.levitateActiveTooltip,
  },
];

/**
 * Включение вида СОСТОЯНИЕМ фишки — члены `api.movementMode` ядра этажей
 * (этап 2): `setActive` и `activeOf`. Состояние живёт только в фишке
 * (`Token.activeMovementModeId`), сущность его не хранит.
 */
interface ActiveMovementModeControl {
  /** Включить вид у фишки; `null` — вид по умолчанию */
  setActive: (tokenId: string, modeId: string | null) => void;
  /** Включённый вид фишки; нет — `null` */
  activeOf: (tokenId: string) => string | null;
}

/**
 * Умеет ли ядро включать вид состоянием фишки.
 *
 * @param control - управление видом у ядра
 * @returns true, если оба члена есть
 */
function hasActiveModeControl(
  control: object,
): control is ActiveMovementModeControl {
  return (
    'setActive' in control
    && typeof control.setActive === 'function'
    && 'activeOf' in control
    && typeof control.activeOf === 'function'
  );
}

/**
 * Фишка героя на текущей сцене: выделенная, иначе первая.
 *
 * @param entityId - сущность
 * @param tokenId - выделенная фишка
 * @returns id фишки либо `undefined`
 */
function findEntityTokenId(
  entityId: string,
  tokenId: string | null,
): string | undefined {
  const tokens = useWorldStore().currentScene?.tokens ?? [];

  return (
    tokens.find((token) => token.id === tokenId && token.actorId === entityId)
    ?? tokens.find((token) => token.actorId === entityId)
  )?.id;
}

/**
 * Кнопки «Полёт» и «Левитация» для выделенного героя: только те виды, что у
 * него есть. Кнопка включает вид состоянием фишки — летун держится в воздухе
 * и меняет высоту; горящая — выключает, и фишку без опоры ядро уронит. Ядро
 * без включения состоянием кнопок не показывает: эффект «Полёт» там просто
 * даёт Скорость полёта.
 *
 * @param api - API ядра для системы
 * @param entity - выделенный герой
 * @param tokenId - его выделенная фишка
 * @returns кнопки полки; видов нет — пусто
 */
export function buildFlightShelfButtons(
  api: ClientSystemAPI,
  entity: DnDSceneEntity,
  tokenId: string | null,
): ActionShelfButton[] {
  const control = findMovementModeControl(api);
  const heroTokenId = findEntityTokenId(entity.id, tokenId);

  if (!control || !hasActiveModeControl(control) || !heroTokenId) {
    return [];
  }

  const modes = buildVerticalMovementModes(
    resolveMovementModesState(entity, resolveEntityStats(entity)),
  );

  const activeModeId = control.activeOf(heroTokenId);

  return FLIGHT_BUTTON_SPECS.flatMap((spec): ActionShelfButton[] => {
    if (!modes.some((mode) => mode.id === spec.modeId)) {
      return [];
    }

    const active = activeModeId === spec.modeId;

    return [
      {
        id: spec.id,
        icon: spec.icon,
        label: spec.label,
        tooltip: active ? spec.activeTooltip : spec.tooltip,
        active,
        // Горящая кнопка приземляет, а не включает заново
        onClick: async () => {
          await control.setActive(heroTokenId, active ? null : spec.modeId);
        },
      },
    ];
  });
}
