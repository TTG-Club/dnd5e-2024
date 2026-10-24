/**
 * Кнопки «Полёт» и «Левитация» полки действий.
 *
 * Полёт и левитация — виды перемещения системы (`movementModes.ts`) со своей
 * Скоростью и правом менять высоту (VTTG 0.9.780). Кнопка есть, только когда
 * вид у героя есть: Скорость полёта (у существа или от эффекта «Полёт»), флаг
 * «Левитация». Нажатие включает вид у ядра (`api.movementMode`) на следующее
 * перемещение: перетаскивание меряется полётом, высота меняется. Включённый
 * СОСТОЯНИЕМ вид фишки (`Token.activeMovementModeId`) кнопка показывает
 * горящей; переключать состояние ядро системе пока не даёт (README, пробелы
 * ядра).
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { Token } from '@vtt/shared';
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
 * Фишка сущности на текущей сцене: выделенная, иначе первая.
 *
 * @param entityId - сущность
 * @param tokenId - выделенная фишка
 * @returns фишка либо `undefined`
 */
function findEntityToken(
  entityId: string,
  tokenId: string | null,
): Token | undefined {
  const tokens = useWorldStore().currentScene?.tokens ?? [];

  return (
    tokens.find((token) => token.id === tokenId && token.actorId === entityId)
    ?? tokens.find((token) => token.actorId === entityId)
  );
}

/**
 * Кнопки «Полёт» и «Левитация» для выделенного героя: только те виды, что у
 * него есть. Горит, пока вид включён у ядра на перемещение или состоянием
 * фишки; нажатие на горящую выключает разовый вид.
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

  // Без режима вида у ядра (VTTG до 0.9.751) включать нечего
  if (!control) {
    return [];
  }

  const stats = resolveEntityStats(entity);

  const modes = buildVerticalMovementModes(
    resolveMovementModesState(entity, stats),
  );

  const current = control.current();

  const persistentModeId = findEntityToken(
    entity.id,
    tokenId,
  )?.activeMovementModeId;

  return FLIGHT_BUTTON_SPECS.flatMap((spec): ActionShelfButton[] => {
    const mode = modes.find((entry) => entry.id === spec.modeId);

    if (!mode) {
      return [];
    }

    const selected =
      current?.entityId === entity.id && current.modeId === spec.modeId;

    const active = selected || persistentModeId === spec.modeId;

    return [
      {
        id: spec.id,
        icon: spec.icon,
        label: spec.label,
        tooltip: active ? spec.activeTooltip : spec.tooltip,
        active,
        // Горящая кнопка выключает разовый вид, а не включает заново
        onClick: () =>
          control.set(
            selected ? null : { entityId: entity.id, modeId: spec.modeId },
          ),
      },
    ];
  });
}
