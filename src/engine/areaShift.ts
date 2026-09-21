/**
 * Сдвиг зоны заклинания по правилам: «Облако смерти» уходит на 10 футов от
 * заклинателя в начале его хода, «Тьма» на предмете в руке идёт за носителем.
 *
 * Считает смещение система — здесь, по вершинам зоны, фишке получателя и
 * сетке сцены; переносит вершины ядро (`SystemTriggerContext.moveArea`,
 * VTTG 0.9.533+). Форма зоны не меняется. Границы сцены и препятствия не
 * учитываются — как и у толчка фишки ({@link module:system/dnd/forcedMovement}).
 *
 * @module system/dnd/areaShift
 */

import type { CustomArea, GridSettings, Token } from '@vtt/shared';

import type { EffectTriggerMoveAreaAction } from './effectTriggerTypes.js';
import type { SceneOffset, ScenePosition } from './forcedMovement.js';

import { resolveGridPixelsPerUnit } from '@vtt/shared';

import { DEFAULT_TRIGGER_MOVE_DISTANCE } from './effectTriggerTypes.js';
import { resolveTokenAnchor, shiftAlongLine } from './forcedMovement.js';

/** Смещение зоны в координатах сцены, px */
export type AreaShiftOffset = SceneOffset;

/** Что известно для сдвига зоны */
export interface AreaShiftScene {
  /** Фишка получателя: от неё и к ней сдвигается зона */
  recipient?: Token;
  /** Смещение фишки носителя за это перемещение — у события пути */
  movementOffset?: AreaShiftOffset;
  /** Сетка сцены */
  gridSettings: GridSettings;
}

/**
 * Середина зоны: среднее вершин. Зоны заклинаний — выпуклые фигуры шаблона
 * (круг, конус, луч), и для них среднее вершин лежит внутри.
 *
 * @param area - зона
 * @returns середина либо `null`, если вершин нет
 */
export function resolveAreaCenter(area: CustomArea): ScenePosition | null {
  if (area.points.length === 0) {
    return null;
  }

  const sum = area.points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );

  return { x: sum.x / area.points.length, y: sum.y / area.points.length };
}

/**
 * На сколько сдвинуть зону.
 *
 * «Идёт за носителем» повторяет смещение его фишки. «От получателя» и «к
 * получателю» идут по прямой между серединой зоны и центром фишки получателя;
 * «к получателю» не проходит дальше его фишки. Направления нет (середина зоны
 * и фишка в одной точке) или нет данных — зона стоит.
 *
 * @param action - действие «Сдвинуть зону»
 * @param area - зона
 * @param scene - фишка получателя, смещение носителя и сетка
 * @returns смещение либо `null`, если сдвигать некуда
 */
export function resolveAreaShift(
  action: EffectTriggerMoveAreaAction,
  area: CustomArea,
  scene: AreaShiftScene,
): AreaShiftOffset | null {
  if (action.kind === 'follow') {
    const offset = scene.movementOffset;

    return offset && (offset.dx !== 0 || offset.dy !== 0) ? offset : null;
  }

  const perFoot = resolveGridPixelsPerUnit(scene.gridSettings);
  const distance = action.distance ?? DEFAULT_TRIGGER_MOVE_DISTANCE;
  const center = resolveAreaCenter(area);

  if (!scene.recipient || !center || perFoot <= 0 || distance <= 0) {
    return null;
  }

  // «К получателю» останавливается на нём, а не пролетает насквозь
  return shiftAlongLine(
    center,
    resolveTokenAnchor(scene.recipient, scene.gridSettings),
    distance * perFoot,
    action.kind === 'toward',
  );
}
