/**
 * Фасад формы сетки: ЕДИНСТВЕННОЕ место, где подсистемы сцены спрашивают
 * «квадрат или гекс».
 *
 * Привязка курсора, привязка токена, отпечаток занимаемых клеток, соседи для
 * поиска пути и расстояние в клетках — всё это на квадратах и на гексах устроено
 * по-разному, но снаружи обязано выглядеть одинаково. Иначе форму сетки пришлось
 * бы разбирать в каждом из десятков мест, где сцена трогает геометрию, и любая
 * забытая ветка давала бы токены, стоящие мимо сетки.
 *
 * Правила D&D 2024 на гексовой сетке, зашитые здесь:
 * - один шаг между соседними гексами стоит `scale` единиц, диагоналей нет;
 * - существо Medium и мельче занимает 1 гекс, Large — 3, Huge — 7,
 *   Gargantuan — 12; у чётных габаритов точка привязки лежит не в центре гекса,
 *   а в ВЕРШИНЕ — на стыке трёх гексов.
 *
 * @module utils/grid
 */

import type { DiagonalRule, GridSettings } from '../types/index.js';
import type { Axial, HexPoint, HexRect } from './hexGrid.js';

import { resolveGridCellSize, resolveHexMetrics } from './gridMetrics.js';
import {
  axialBasisVectors,
  axialDelta,
  expandHexes,
  hexCorners,
  hexDistance,
  hexEdgeMidpoints,
  hexesInRect,
  hexesTouchingVertex,
  hexesWithin,
  hexRowStep,
  hexToPoint,
  nearestHexVertex,
  nearestPoint,
  pointToHex,
} from './hexGrid.js';

/** Точка в мировых координатах сцены */
export interface GridPointLike {
  x: number;
  y: number;
}

/**
 * Ссылка на клетку сетки в её собственных целочисленных координатах.
 *
 * На квадратной сетке это колонка и ряд, на гексовой — аксиальная пара `q`/`r`.
 * Смысл разный, но обращаются с ней всегда через функции этого модуля, поэтому
 * два поля вместо двух отдельных типов не мешают.
 */
export interface GridCellRef {
  col: number;
  row: number;
}

/** Клетка отпечатка токена — всё, что нужно и для рисования, и для занятости */
export interface GridFootprintCell extends GridCellRef {
  /** Ключ клетки для множеств и пересечений */
  key: string;
  /** Центр клетки в мировых координатах */
  centerX: number;
  /** Центр клетки в мировых координатах */
  centerY: number;
  /** Контур клетки: 4 точки у квадрата, 6 у гекса */
  polygon: GridPointLike[];
}

/**
 * Ключ клетки для множеств и словарей.
 *
 * @param cell - клетка сетки
 * @returns строковый ключ
 */
export function gridCellKey(cell: GridCellRef): string {
  return `${cell.col},${cell.row}`;
}

/**
 * Смещение сетки, приведённое к одной клетке.
 *
 * Смещение на целое число клеток сетку не двигает, поэтому хранить и сравнивать
 * удобнее остаток.
 *
 * @param offset - исходное смещение, px
 * @param step - шаг сетки, px
 * @returns смещение внутри одного шага
 */
function normalizeOffset(offset: number, step: number): number {
  return step > 0 ? offset % step : 0;
}

/**
 * Привязывает точку к квадратной сетке.
 *
 * @param x - координата X
 * @param y - координата Y
 * @param cellSize - размер клетки, px
 * @param offsetX - смещение сетки по X
 * @param offsetY - смещение сетки по Y
 * @param divisions - количество делений внутри клетки (1 — целая клетка)
 * @returns привязанные координаты
 */
export function snapSquarePoint(
  x: number,
  y: number,
  cellSize: number,
  offsetX: number = 0,
  offsetY: number = 0,
  divisions: number = 1,
): GridPointLike {
  const snapStep = cellSize / divisions;
  const gridOffsetX = normalizeOffset(offsetX, snapStep);
  const gridOffsetY = normalizeOffset(offsetY, snapStep);

  return {
    x: Math.round((x - gridOffsetX) / snapStep) * snapStep + gridOffsetX,
    y: Math.round((y - gridOffsetY) / snapStep) * snapStep + gridOffsetY,
  };
}

/**
 * Собирает точки привязки гексовой сетки вокруг заданной точки.
 *
 * Деления читаются как НАБОР точек, а не как дробление шага: на гексе нет
 * «четверти клетки», зато есть три осмысленных семейства точек — центры,
 * вершины и середины рёбер.
 *
 * @param gridSettings - настройки сетки сцены
 * @param x - координата X
 * @param y - координата Y
 * @param divisions - деления привязки инструмента
 * @returns точки-кандидаты
 */
function collectHexSnapCandidates(
  gridSettings: GridSettings,
  x: number,
  y: number,
  divisions: number,
): HexPoint[] {
  const metrics = resolveHexMetrics(gridSettings);
  const center = pointToHex(metrics, x, y);
  const neighborhood = [center, ...hexesWithin(center, 1)];

  const candidates: HexPoint[] = neighborhood.map((hex) =>
    hexToPoint(metrics, hex),
  );

  if (divisions <= 1) {
    return candidates;
  }

  for (const hex of neighborhood) {
    candidates.push(...hexCorners(metrics, hex));
  }

  if (divisions >= 4) {
    for (const hex of neighborhood) {
      candidates.push(...hexEdgeMidpoints(metrics, hex));
    }
  }

  // Более мелкие деления дробят рёбра: восьмушки и шестнадцатые доли клетки
  // на гексе честно не выражаются, но точки вдоль ребра дают ту же свободу
  // при обводке стен и областей.
  if (divisions >= 8) {
    const parts = divisions / 4;

    for (const hex of neighborhood) {
      const corners = hexCorners(metrics, hex);

      for (let index = 0; index < corners.length; index++) {
        const from = corners[index];
        const to = corners[(index + 1) % corners.length];

        for (let part = 1; part < parts; part++) {
          const ratio = part / parts;

          candidates.push({
            x: from.x + (to.x - from.x) * ratio,
            y: from.y + (to.y - from.y) * ratio,
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Привязывает произвольную точку к сетке сцены с учётом её формы.
 *
 * @param gridSettings - настройки сетки сцены
 * @param x - координата X
 * @param y - координата Y
 * @param divisions - деления привязки инструмента (1 — целая клетка)
 * @returns привязанные координаты
 */
export function snapPointToGrid(
  gridSettings: GridSettings,
  x: number,
  y: number,
  divisions: number = 1,
): GridPointLike {
  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    return snapSquarePoint(
      x,
      y,
      resolveGridCellSize(gridSettings),
      gridSettings.offsetX ?? 0,
      gridSettings.offsetY ?? 0,
      divisions,
    );
  }

  return nearestPoint(
    x,
    y,
    collectHexSnapCandidates(gridSettings, x, y, divisions),
  );
}

/**
 * Сколько клеток по стороне занимает токен заданного габарита.
 *
 * Габариты меньше клетки (Tiny) всё равно занимают одну: делить клетку между
 * существами правила не разрешают.
 *
 * @param scale - масштаб токена
 * @returns целое число клеток, минимум 1
 */
export function resolveFootprintSpan(scale: number): number {
  return Math.max(1, Math.round(scale));
}

/**
 * Вычисляет отступ, центрирующий токен внутри занимаемых им клеток.
 *
 * Токен занимает `span` клеток, но рисуется размером `scale`. У токенов мельче
 * клетки (scale < 1) остаётся зазор — его половина и есть отступ от угла клетки.
 * Для scale >= 1 отступ нулевой, поэтому забытое центрирование заметно
 * ИСКЛЮЧИТЕЛЬНО на мелких токенах.
 *
 * На гексовой сетке отступа нет вовсе: там позиция задаётся якорем (центром
 * гекса или его вершиной), и токен уже центрирован по построению.
 *
 * @param scale - масштаб токена
 * @param gridSize - размер клетки в пикселях
 * @returns отступ по обеим осям
 */
export function getTokenCenteringOffset(
  scale: number,
  gridSize: number,
): { x: number; y: number } {
  const offset =
    (resolveFootprintSpan(scale) * gridSize - scale * gridSize) / 2;

  return { x: offset, y: offset };
}

/**
 * Якорь токена — точка, которой он «стоит» на сетке.
 *
 * Это центр нарисованного токена: на квадратной сетке — центр его отпечатка,
 * на гексовой — центр гекса (нечётный габарит) либо вершина на стыке трёх
 * гексов (чётный габарит). Позиция токена в модели по-прежнему хранится левым
 * верхним углом, поэтому якорь считается, а не хранится.
 *
 * @param gridSettings - настройки сетки сцены
 * @param x - X левого верхнего угла токена
 * @param y - Y левого верхнего угла токена
 * @param scale - масштаб токена
 * @returns координаты якоря
 */
export function getTokenAnchor(
  gridSettings: GridSettings,
  x: number,
  y: number,
  scale: number,
): GridPointLike {
  const half = (resolveGridCellSize(gridSettings) * scale) / 2;

  return { x: x + half, y: y + half };
}

/**
 * Округляет смещение до целого числа шагов сетки.
 *
 * Нужно там, где группа объектов едет ЦЕЛИКОМ: округлив общее смещение один
 * раз, взаимное расположение сохраняется в точности. Если же привязывать каждый
 * объект отдельно, соседи с разным дробным остатком разъезжаются на клетку.
 *
 * @param gridSettings - настройки сетки сцены
 * @param deltaX - смещение по X, px
 * @param deltaY - смещение по Y, px
 * @returns смещение, кратное шагу сетки
 */
export function snapGridDelta(
  gridSettings: GridSettings,
  deltaX: number,
  deltaY: number,
): GridPointLike {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    return {
      x: Math.round(deltaX / cellSize) * cellSize,
      y: Math.round(deltaY / cellSize) * cellSize,
    };
  }

  const metrics = resolveHexMetrics(gridSettings);
  const basis = axialBasisVectors(metrics);

  // Смещение раскладывается по косым осям гекса и округляется в них: округление
  // по X и Y по отдельности увело бы группу с решётки.
  const step = axialDelta(
    metrics,
    { x: metrics.offsetX, y: metrics.offsetY },
    { x: metrics.offsetX + deltaX, y: metrics.offsetY + deltaY },
  );

  return {
    x: step.q * basis.q.x + step.r * basis.r.x,
    y: step.q * basis.q.y + step.r * basis.r.y,
  };
}

/**
 * Переводит якорь обратно в позицию токена (левый верхний угол).
 *
 * @param gridSettings - настройки сетки сцены
 * @param anchorX - X якоря
 * @param anchorY - Y якоря
 * @param scale - масштаб токена
 * @returns координаты левого верхнего угла
 */
function anchorToTopLeft(
  gridSettings: GridSettings,
  anchorX: number,
  anchorY: number,
  scale: number,
): GridPointLike {
  const half = (resolveGridCellSize(gridSettings) * scale) / 2;

  return { x: anchorX - half, y: anchorY - half };
}

/**
 * Привязывает якорь токена к сетке.
 *
 * @param gridSettings - настройки сетки сцены
 * @param anchorX - желаемый X якоря
 * @param anchorY - желаемый Y якоря
 * @param scale - масштаб токена
 * @returns координаты привязанного якоря
 */
export function snapTokenAnchor(
  gridSettings: GridSettings,
  anchorX: number,
  anchorY: number,
  scale: number,
): GridPointLike {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const span = resolveFootprintSpan(scale);
    const halfSpan = (span * cellSize) / 2;

    const snappedCorner = snapSquarePoint(
      anchorX - halfSpan,
      anchorY - halfSpan,
      cellSize,
      gridSettings.offsetX ?? 0,
      gridSettings.offsetY ?? 0,
    );

    return { x: snappedCorner.x + halfSpan, y: snappedCorner.y + halfSpan };
  }

  const metrics = resolveHexMetrics(gridSettings);

  // Чётный габарит стоит на стыке трёх гексов, нечётный — в центре гекса.
  // Именно это чередование и даёт счёт занятых гексов 1 / 3 / 7 / 12.
  return resolveFootprintSpan(scale) % 2 === 0
    ? nearestHexVertex(metrics, anchorX, anchorY)
    : hexToPoint(metrics, pointToHex(metrics, anchorX, anchorY));
}

/**
 * Привязывает токен к сетке по желаемому положению его левого верхнего угла.
 *
 * @param gridSettings - настройки сетки сцены
 * @param x - желаемый X левого верхнего угла
 * @param y - желаемый Y левого верхнего угла
 * @param scale - масштаб токена
 * @returns привязанные координаты левого верхнего угла
 */
export function snapTokenTopLeft(
  gridSettings: GridSettings,
  x: number,
  y: number,
  scale: number,
): GridPointLike {
  const anchor = getTokenAnchor(gridSettings, x, y, scale);
  const snapped = snapTokenAnchor(gridSettings, anchor.x, anchor.y, scale);

  return anchorToTopLeft(gridSettings, snapped.x, snapped.y, scale);
}

/**
 * Привязывает токен к клетке ПОД УКАЗАТЕЛЕМ.
 *
 * Отличается от {@link snapTokenTopLeft} тем, что за отправную точку берётся не
 * угол токена, а сама точка указателя: крупный токен встаёт так, чтобы клетка
 * под курсором была его первой клеткой (квадрат) или чтобы курсор попал в его
 * отпечаток (гекс). Так перетаскивание не «убегает» от курсора у Large и крупнее.
 *
 * @param gridSettings - настройки сетки сцены
 * @param pointerX - X указателя в мировых координатах
 * @param pointerY - Y указателя в мировых координатах
 * @param scale - масштаб токена
 * @returns координаты левого верхнего угла токена
 */
export function snapTokenTopLeftAtPointer(
  gridSettings: GridSettings,
  pointerX: number,
  pointerY: number,
  scale: number,
): GridPointLike {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const offsetX = normalizeOffset(gridSettings.offsetX ?? 0, cellSize);
    const offsetY = normalizeOffset(gridSettings.offsetY ?? 0, cellSize);

    const cellX =
      Math.floor((pointerX - offsetX) / cellSize) * cellSize + offsetX;

    const cellY =
      Math.floor((pointerY - offsetY) / cellSize) * cellSize + offsetY;

    const centering = getTokenCenteringOffset(scale, cellSize);

    return { x: cellX + centering.x, y: cellY + centering.y };
  }

  const anchor = snapTokenAnchor(gridSettings, pointerX, pointerY, scale);

  return anchorToTopLeft(gridSettings, anchor.x, anchor.y, scale);
}

/**
 * Расстояние между центрами СОСЕДНИХ клеток вдоль каждой оси экрана.
 *
 * У квадратной сетки шаг по обеим осям равен размеру клетки. У гексовой одна ось
 * идёт по ряду (шаг = размер клетки), а поперёк рядов клетки стоят плотнее —
 * шаг там `cellSize · √3/2`. Без этого различия «уместить N клеток в сторону
 * сцены» промахивается почти на 14% по одной из осей.
 *
 * @param gridSettings - настройки сетки сцены
 * @returns шаг по горизонтали и вертикали, px
 */
export function getGridAxisStep(gridSettings: GridSettings): GridPointLike {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    return { x: cellSize, y: cellSize };
  }

  const metrics = resolveHexMetrics(gridSettings);
  const rowStep = hexRowStep(metrics);

  return metrics.orientation === 'flat'
    ? { x: rowStep, y: cellSize }
    : { x: cellSize, y: rowStep };
}

/** Направление шага стрелками клавиатуры */
export type GridArrowDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Соответствие стрелок осям гексовой сетки.
 *
 * У гекса шесть направлений, а стрелок четыре, поэтому две оси остаются
 * «диагональными» — они набираются комбинацией нажатий, как и раньше на
 * квадратной сетке. Пары противоположны, так что «вверх, затем вниз» всегда
 * возвращает токен на место.
 *
 * У остроконечных гексов ряды горизонтальны: влево-вправо идут вдоль ряда, а
 * вверх — по ближайшей к вертикали оси (вверх-вправо). У плоских наоборот:
 * вертикаль точная, а горизонталь ближайшая.
 */
const HEX_ARROW_STEPS: Record<
  'pointy' | 'flat',
  Record<GridArrowDirection, Axial>
> = {
  pointy: {
    left: { q: -1, r: 0 },
    right: { q: 1, r: 0 },
    up: { q: 1, r: -1 },
    down: { q: -1, r: 1 },
  },
  flat: {
    left: { q: -1, r: 0 },
    right: { q: 1, r: 0 },
    up: { q: 0, r: -1 },
    down: { q: 0, r: 1 },
  },
};

/**
 * Смещение токена на заданное число клеток в направлении стрелки.
 *
 * @param gridSettings - настройки сетки сцены
 * @param direction - направление
 * @param steps - сколько клеток пройти
 * @returns смещение в пикселях сцены
 */
export function getGridArrowStep(
  gridSettings: GridSettings,
  direction: GridArrowDirection,
  steps: number = 1,
): GridPointLike {
  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const distance = resolveGridCellSize(gridSettings) * steps;

    switch (direction) {
      case 'up':
        return { x: 0, y: -distance };
      case 'down':
        return { x: 0, y: distance };
      case 'left':
        return { x: -distance, y: 0 };
      default:
        return { x: distance, y: 0 };
    }
  }

  const metrics = resolveHexMetrics(gridSettings);
  const basis = axialBasisVectors(metrics);
  const step = HEX_ARROW_STEPS[metrics.orientation][direction];

  return {
    x: (step.q * basis.q.x + step.r * basis.r.x) * steps,
    y: (step.q * basis.q.y + step.r * basis.r.y) * steps,
  };
}

/**
 * Считает новое положение перетаскиваемого токена.
 *
 * Токен смещается ровно на столько клеток, на сколько уехал курсор — «хват» за
 * произвольную клетку крупного токена сохраняется, а не сбрасывается в центр.
 *
 * На гексовой сетке смещение обязано быть ЦЕЛЫМ в осях сетки: у существ чётного
 * габарита якорь стоит в вершине, и вершины делятся на две подрешётки. Прыжок
 * на ближайшую вершину мог бы увести токен в другую подрешётку — отпечаток
 * перевернулся бы, а построение маршрута и подсчёт футов, которые считают
 * смещение целым, начали бы врать. Разность номеров гексов под курсором такого
 * прыжка не допускает по построению.
 *
 * @param gridSettings - настройки сетки сцены
 * @param startX - X левого верхнего угла токена в начале перетаскивания
 * @param startY - Y левого верхнего угла токена в начале перетаскивания
 * @param scale - масштаб токена
 * @param dragStartPointerX - X курсора в начале перетаскивания
 * @param dragStartPointerY - Y курсора в начале перетаскивания
 * @param pointerX - текущий X курсора
 * @param pointerY - текущий Y курсора
 * @returns привязанные координаты левого верхнего угла токена
 */
export function snapTokenDragTopLeft(
  gridSettings: GridSettings,
  startX: number,
  startY: number,
  scale: number,
  dragStartPointerX: number,
  dragStartPointerY: number,
  pointerX: number,
  pointerY: number,
): GridPointLike {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const offsetX = normalizeOffset(gridSettings.offsetX ?? 0, cellSize);
    const offsetY = normalizeOffset(gridSettings.offsetY ?? 0, cellSize);
    const centering = getTokenCenteringOffset(scale, cellSize);

    const cursorCell = (position: number, offset: number): number =>
      Math.floor((position - offset) / cellSize) * cellSize + offset;

    // Смещение хвата в целых клетках: где стоял курсор относительно клетки токена
    const grabOffsetX =
      cursorCell(dragStartPointerX, offsetX) - (startX - centering.x);

    const grabOffsetY =
      cursorCell(dragStartPointerY, offsetY) - (startY - centering.y);

    return {
      x: cursorCell(pointerX, offsetX) - grabOffsetX + centering.x,
      y: cursorCell(pointerY, offsetY) - grabOffsetY + centering.y,
    };
  }

  const metrics = resolveHexMetrics(gridSettings);
  const basis = axialBasisVectors(metrics);

  const startHex = pointToHex(metrics, dragStartPointerX, dragStartPointerY);
  const currentHex = pointToHex(metrics, pointerX, pointerY);

  const stepQ = currentHex.q - startHex.q;
  const stepR = currentHex.r - startHex.r;

  const startAnchor = getTokenAnchor(gridSettings, startX, startY, scale);

  const snappedStart = snapTokenAnchor(
    gridSettings,
    startAnchor.x,
    startAnchor.y,
    scale,
  );

  return anchorToTopLeft(
    gridSettings,
    snappedStart.x + stepQ * basis.q.x + stepR * basis.r.x,
    snappedStart.y + stepQ * basis.q.y + stepR * basis.r.y,
    scale,
  );
}

/**
 * Контур квадратной клетки.
 *
 * @param x - X левого верхнего угла
 * @param y - Y левого верхнего угла
 * @param size - сторона клетки
 * @returns четыре точки контура
 */
function squarePolygon(x: number, y: number, size: number): GridPointLike[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

/**
 * Клетки, занимаемые токеном.
 *
 * ЕДИНСТВЕННЫЙ источник отпечатка: на нём держатся занятость клеток, подсветка
 * следа при перемещении, серверный телепорт и расстояние между краями существ.
 * Разъехавшиеся реализации отпечатка означали бы, что клиент и сервер по-разному
 * отвечают на вопрос «влезет ли токен сюда».
 *
 * На гексовой сетке счёт клеток идёт по правилам D&D 2024: 1 / 3 / 7 / 12 для
 * Medium / Large / Huge / Gargantuan.
 *
 * @param gridSettings - настройки сетки сцены
 * @param x - X левого верхнего угла токена
 * @param y - Y левого верхнего угла токена
 * @param scale - масштаб токена
 * @returns занятые клетки
 */
export function getTokenFootprintCells(
  gridSettings: GridSettings,
  x: number,
  y: number,
  scale: number,
): GridFootprintCell[] {
  const cellSize = resolveGridCellSize(gridSettings);
  const span = resolveFootprintSpan(scale);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const centering = getTokenCenteringOffset(scale, cellSize);
    const originX = x - centering.x;
    const originY = y - centering.y;

    const offsetX = normalizeOffset(gridSettings.offsetX ?? 0, cellSize);
    const offsetY = normalizeOffset(gridSettings.offsetY ?? 0, cellSize);

    const cells: GridFootprintCell[] = [];

    for (let column = 0; column < span; column++) {
      for (let row = 0; row < span; row++) {
        const cellX = originX + column * cellSize;
        const cellY = originY + row * cellSize;

        const ref: GridCellRef = {
          col: Math.round((cellX - offsetX) / cellSize),
          row: Math.round((cellY - offsetY) / cellSize),
        };

        cells.push({
          ...ref,
          key: gridCellKey(ref),
          centerX: cellX + cellSize / 2,
          centerY: cellY + cellSize / 2,
          polygon: squarePolygon(cellX, cellY, cellSize),
        });
      }
    }

    return cells;
  }

  const metrics = resolveHexMetrics(gridSettings);
  const anchor = getTokenAnchor(gridSettings, x, y, scale);

  const hexes: Axial[] =
    span % 2 === 0
      ? expandHexes(hexesTouchingVertex(metrics, anchor), (span - 2) / 2)
      : hexesWithin(pointToHex(metrics, anchor.x, anchor.y), (span - 1) / 2);

  return hexes.map((hex) => {
    const center = hexToPoint(metrics, hex);
    const ref: GridCellRef = { col: hex.q, row: hex.r };

    return {
      ...ref,
      key: gridCellKey(ref),
      centerX: center.x,
      centerY: center.y,
      polygon: hexCorners(metrics, hex),
    };
  });
}

/**
 * Пересекаются ли отпечатки двух токенов.
 *
 * @param first - клетки первого отпечатка
 * @param second - клетки второго отпечатка
 * @returns true, если есть общая клетка
 */
export function doFootprintsOverlap(
  first: ReadonlyArray<GridFootprintCell>,
  second: ReadonlyArray<GridFootprintCell>,
): boolean {
  const keys = new Set(first.map((cell) => cell.key));

  return second.some((cell) => keys.has(cell.key));
}

/**
 * Вычисляет расстояние в клетках между двумя величинами по осям.
 *
 * @param cellsX - расстояние по оси X (в клетках)
 * @param cellsY - расстояние по оси Y (в клетках)
 * @param rule - правило расчёта диагонали
 * @returns расстояние в клетках
 */
export function computeSquareDistanceInCells(
  cellsX: number,
  cellsY: number,
  rule: DiagonalRule | undefined,
): number {
  switch (rule) {
    case 'chebyshev': {
      // D&D 5e: диагональ = 1 клетка (max из двух осей)
      return Math.max(cellsX, cellsY);
    }
    case 'alternating': {
      // D&D 3.5e / Pathfinder: каждая вторая диагональ стоит 2 клетки
      const straight = Math.abs(cellsX - cellsY);
      const diagonal = Math.min(cellsX, cellsY);
      const doubleDiagonals = Math.floor(diagonal / 2);

      return straight + diagonal + doubleDiagonals;
    }
    case 'euclidean':
    default: {
      // Геометрическое расстояние
      return Math.sqrt(cellsX * cellsX + cellsY * cellsY);
    }
  }
}

/**
 * Расстояние между двумя клетками сетки в шагах.
 *
 * @param gridSettings - настройки сетки сцены
 * @param from - первая клетка
 * @param to - вторая клетка
 * @returns число шагов
 */
export function getGridCellDistance(
  gridSettings: GridSettings,
  from: GridCellRef,
  to: GridCellRef,
): number {
  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    return computeSquareDistanceInCells(
      Math.abs(to.col - from.col),
      Math.abs(to.row - from.row),
      gridSettings.diagonalRule,
    );
  }

  return hexDistance({ q: from.col, r: from.row }, { q: to.col, r: to.row });
}

/** Восемь направлений к соседям квадратной клетки */
const SQUARE_NEIGHBOR_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Шесть направлений к соседям гекса */
const HEX_NEIGHBOR_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/**
 * Направления к соседним клеткам: восемь у квадрата, шесть у гекса.
 *
 * Порядок сохранён из поиска пути: сначала диагонали, потом ортогонали — на этом
 * держится выбор «диагональ раньше, прямой отрезок в конце» среди равных
 * маршрутов. У гекса все шесть направлений равноправны.
 *
 * @param gridSettings - настройки сетки сцены
 * @returns смещения к соседям в координатах клеток
 */
export function getGridNeighborDirections(
  gridSettings: GridSettings,
): ReadonlyArray<readonly [number, number]> {
  return gridSettings.shape === undefined || gridSettings.shape === 'square'
    ? SQUARE_NEIGHBOR_DIRECTIONS
    : HEX_NEIGHBOR_DIRECTIONS;
}

/**
 * Клетка, в которой лежит мировая точка.
 *
 * @param gridSettings - настройки сетки сцены
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @returns координаты клетки
 */
export function getGridCellAtPoint(
  gridSettings: GridSettings,
  x: number,
  y: number,
): GridCellRef {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const offsetX = normalizeOffset(gridSettings.offsetX ?? 0, cellSize);
    const offsetY = normalizeOffset(gridSettings.offsetY ?? 0, cellSize);

    return {
      col: Math.floor((x - offsetX) / cellSize),
      row: Math.floor((y - offsetY) / cellSize),
    };
  }

  const hex = pointToHex(resolveHexMetrics(gridSettings), x, y);

  return { col: hex.q, row: hex.r };
}

/**
 * Центр клетки в мировых координатах.
 *
 * @param gridSettings - настройки сетки сцены
 * @param cell - клетка
 * @returns координаты центра
 */
export function getGridCellCenter(
  gridSettings: GridSettings,
  cell: GridCellRef,
): GridPointLike {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const offsetX = normalizeOffset(gridSettings.offsetX ?? 0, cellSize);
    const offsetY = normalizeOffset(gridSettings.offsetY ?? 0, cellSize);

    return {
      x: cell.col * cellSize + offsetX + cellSize / 2,
      y: cell.row * cellSize + offsetY + cellSize / 2,
    };
  }

  return hexToPoint(resolveHexMetrics(gridSettings), {
    q: cell.col,
    r: cell.row,
  });
}

/**
 * Контур клетки в мировых координатах.
 *
 * @param gridSettings - настройки сетки сцены
 * @param cell - клетка
 * @returns точки контура: четыре у квадрата, шесть у гекса
 */
export function getGridCellPolygon(
  gridSettings: GridSettings,
  cell: GridCellRef,
): GridPointLike[] {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const center = getGridCellCenter(gridSettings, cell);

    return squarePolygon(
      center.x - cellSize / 2,
      center.y - cellSize / 2,
      cellSize,
    );
  }

  return hexCorners(resolveHexMetrics(gridSettings), {
    q: cell.col,
    r: cell.row,
  });
}

/**
 * Точка, которой клетка записывается в данные сцены (зоны перехода).
 *
 * На квадратной сетке это исторически ЛЕВЫЙ ВЕРХНИЙ УГОЛ клетки — так лежат
 * данные всех уже созданных миров, и менять формат ради гексов нельзя. У гекса
 * угла нет, поэтому там записывается ЦЕНТР. Пара с
 * {@link getGridCellFromStoredPoint} — единственное место, где это соглашение
 * записано; разъехавшись, они превратили бы зоны перехода в набор клеток
 * со сдвигом на полклетки.
 *
 * @param gridSettings - настройки сетки сцены
 * @param cell - клетка
 * @returns точка для записи в данные сцены
 */
export function getGridCellStoredPoint(
  gridSettings: GridSettings,
  cell: GridCellRef,
): GridPointLike {
  const center = getGridCellCenter(gridSettings, cell);

  if (gridSettings.shape !== undefined && gridSettings.shape !== 'square') {
    return center;
  }

  const half = resolveGridCellSize(gridSettings) / 2;

  return { x: center.x - half, y: center.y - half };
}

/**
 * Обратный перевод: из записанной точки — в клетку сетки.
 *
 * @param gridSettings - настройки сетки сцены
 * @param point - точка из данных сцены
 * @returns клетка
 */
export function getGridCellFromStoredPoint(
  gridSettings: GridSettings,
  point: GridPointLike,
): GridCellRef {
  if (gridSettings.shape !== undefined && gridSettings.shape !== 'square') {
    return getGridCellAtPoint(gridSettings, point.x, point.y);
  }

  const half = resolveGridCellSize(gridSettings) / 2;

  return getGridCellAtPoint(gridSettings, point.x + half, point.y + half);
}

/**
 * Клетки, попадающие в прямоугольную область сцены.
 *
 * @param gridSettings - настройки сетки сцены
 * @param rect - прямоугольник в мировых координатах
 * @returns клетки области
 */
export function getGridCellsInRect(
  gridSettings: GridSettings,
  rect: HexRect,
): GridCellRef[] {
  const cellSize = resolveGridCellSize(gridSettings);

  if (gridSettings.shape === undefined || gridSettings.shape === 'square') {
    const offsetX = normalizeOffset(gridSettings.offsetX ?? 0, cellSize);
    const offsetY = normalizeOffset(gridSettings.offsetY ?? 0, cellSize);

    const minColumn = Math.floor((rect.x - offsetX) / cellSize);
    const maxColumn = Math.ceil((rect.x + rect.width - offsetX) / cellSize);
    const minRow = Math.floor((rect.y - offsetY) / cellSize);
    const maxRow = Math.ceil((rect.y + rect.height - offsetY) / cellSize);

    const cells: GridCellRef[] = [];

    for (let row = minRow; row < maxRow; row++) {
      for (let column = minColumn; column < maxColumn; column++) {
        cells.push({ col: column, row });
      }
    }

    return cells;
  }

  return hexesInRect(resolveHexMetrics(gridSettings), rect).map((hex) => ({
    col: hex.q,
    row: hex.r,
  }));
}
