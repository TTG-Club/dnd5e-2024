/**
 * Принудительное перемещение фишки: толчок, притягивание, телепортация.
 *
 * Правила сплошь и рядом двигают не своей волей: «Волна грома» отталкивает на
 * 10 футов, «Ледяной нож» притягивает, «Туманный шаг» переносит. Считает
 * перемещение система — здесь, по фишкам сцены и её сетке; ставит фишку ядро
 * ({@link module:system/dnd/dnd5eSystem} отдаёт ему готовую точку через
 * `SystemTriggerContext.moveToken`, VTTG 0.9.532+).
 *
 * Препятствия не учитываются: ядро только прижимает фишку к краю сцены, стены
 * геометрия перемещения не видит. Это записано в каталоге сценариев — толчок
 * пройдёт сквозь стену.
 *
 * @module system/dnd/forcedMovement
 */

import type { GridSettings, SystemSceneSurroundings, Token } from '@vtt/shared';

import type { EffectTriggerMoveAction } from './effectTriggerTypes.js';

import {
  getTokenAnchor,
  resolveGridCellSize,
  resolveGridPixelsPerUnit,
} from '@vtt/shared';

import { DEFAULT_TRIGGER_MOVE_ORIGIN } from './effectTriggerTypes.js';

/** Точка на сцене, px */
export interface ScenePosition {
  x: number;
  y: number;
}

/** Смещение на сцене, px */
export interface SceneOffset {
  dx: number;
  dy: number;
}

/**
 * Точка, которой фишка стоит на сетке, — её центр. Считает ядро: на
 * фиксированной сетке и на гексах размер клетки берётся не из поля сцены.
 *
 * @param token - фишка
 * @param gridSettings - сетка сцены
 * @returns центр фишки
 */
export function resolveTokenAnchor(
  token: Token,
  gridSettings: GridSettings,
): ScenePosition {
  return getTokenAnchor(gridSettings, token.x, token.y, token.scale);
}

/**
 * Смещение точки по прямой через опору: от опоры или к ней. К опоре точка не
 * проходит дальше самой опоры — иначе «на 30 футов к себе» выбрасывало бы её
 * за спину.
 *
 * @param moving - точка, которую двигают
 * @param anchor - опора
 * @param stepPx - на сколько, px
 * @param toward - к опоре, а не от неё
 * @returns смещение либо `null`, если точки совпали и направления нет
 */
export function shiftAlongLine(
  moving: ScenePosition,
  anchor: ScenePosition,
  stepPx: number,
  toward: boolean,
): SceneOffset | null {
  const deltaX = moving.x - anchor.x;
  const deltaY = moving.y - anchor.y;
  const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  if (length === 0) {
    return null;
  }

  const shift = toward ? -Math.min(stepPx, length) : stepPx;

  return { dx: (deltaX / length) * shift, dy: (deltaY / length) * shift };
}

/** Кого двигают и от чего отсчитывают направление */
export interface ForcedMoveScene {
  /** Фишка, которую двигают */
  target: Token;
  /** Фишка, от которой считают направление (толкающий или цель) */
  origin: Token;
  /** Сетка сцены */
  gridSettings: GridSettings;
  /** Действующие флаги того, кого двигают */
  targetFlags?: ReadonlySet<string>;
}

/** Флаг «не может телепортироваться» */
export const TELEPORT_BLOCKED_FLAG = 'movement.teleportBlocked';

/** Виды перемещения, которые считаются телепортацией */
const TELEPORT_MOVE_KINDS: readonly EffectTriggerMoveAction['kind'][] = [
  'teleport',
  'bring',
];

/**
 * На сколько пикселей фишка идёт к опоре, чтобы встать к ней вплотную: центры
 * расходятся на полуразмеры обеих фишек. Уже стоит вплотную — ноль.
 *
 * @param scene - кого двигают и к кому
 * @param targetAnchor - центр фишки, которую двигают
 * @param originAnchor - центр опоры
 * @returns шаг в пикселях
 */
function resolveBringStep(
  scene: ForcedMoveScene,
  targetAnchor: ScenePosition,
  originAnchor: ScenePosition,
): number {
  const { target, origin, gridSettings } = scene;
  const cell = resolveGridCellSize(gridSettings);

  const reach = (((target.scale ?? 1) + (origin.scale ?? 1)) * cell) / 2;

  const length = Math.hypot(
    targetAnchor.x - originAnchor.x,
    targetAnchor.y - originAnchor.y,
  );

  return Math.max(0, length - reach);
}

/**
 * Куда встанет фишка после принудительного перемещения.
 *
 * Направление — по прямой между центрами фишек: от опорной к цели у толчка и
 * переноса, к опорной у притягивания. Перенос ложится на сцену как толчок — на
 * названное расстояние от опорной; отличает его запрет «не может
 * телепортироваться».
 *
 * Фишки стоят в одной точке — направления нет, и перемещение не состоится:
 * толкать «в никуда» система не станет.
 *
 * @param action - действие «Переместить»
 * @param scene - кого двигают и от чего считают
 * @returns новая точка либо `null`, если двигать некуда
 */
export function resolveForcedMovePosition(
  action: EffectTriggerMoveAction,
  scene: ForcedMoveScene,
): ScenePosition | null {
  const { target, origin, gridSettings } = scene;
  const perFoot = resolveGridPixelsPerUnit(gridSettings);
  const isBring = action.kind === 'bring';

  if (perFoot <= 0 || (!isBring && action.distance <= 0)) {
    return null;
  }

  // «Не может телепортироваться» («Цепи Белета»): перенос не состоится, а
  // толчок и притягивание — обычное перемещение, их запрет не касается
  if (
    TELEPORT_MOVE_KINDS.includes(action.kind)
    && scene.targetFlags?.has(TELEPORT_BLOCKED_FLAG) === true
  ) {
    return null;
  }

  const targetAnchor = resolveTokenAnchor(target, gridSettings);
  const originAnchor = resolveTokenAnchor(origin, gridSettings);

  const offset = isBring
    ? shiftAlongLine(
        targetAnchor,
        originAnchor,
        resolveBringStep(scene, targetAnchor, originAnchor),
        true,
      )
    : shiftAlongLine(
        targetAnchor,
        originAnchor,
        action.distance * perFoot,
        // «На выбор» без выбора (спросить было некого) толкает от опоры
        action.kind === 'pull',
      );

  return offset ? { x: target.x + offset.dx, y: target.y + offset.dy } : null;
}

/**
 * Фишка, от которой считают направление: наложившего эффект или самого
 * субъекта.
 *
 * @param action - действие «Переместить»
 * @param surroundings - сцена вокруг субъекта
 * @param sourceId - кто наложил эффект
 * @returns фишка опоры либо `null`, если её нет на сцене
 */
export function resolveForcedMoveOrigin(
  action: EffectTriggerMoveAction,
  surroundings: SystemSceneSurroundings,
  sourceId: string | undefined,
): Token | null {
  if ((action.from ?? DEFAULT_TRIGGER_MOVE_ORIGIN) === 'subject') {
    return surroundings.token;
  }

  return sourceId ? findSceneToken(surroundings, sourceId) : null;
}

/**
 * Фишка получателя на сцене вокруг субъекта.
 *
 * @param surroundings - сцена вокруг субъекта
 * @param entityId - чью фишку ищут
 * @returns фишка либо `null`, если её на сцене нет
 */
export function findSceneToken(
  surroundings: SystemSceneSurroundings,
  entityId: string,
): Token | null {
  if (surroundings.token.actorId === entityId) {
    return surroundings.token;
  }

  return (
    surroundings.neighbors.find(
      (neighbor) => neighbor.token.actorId === entityId,
    )?.token ?? null
  );
}
