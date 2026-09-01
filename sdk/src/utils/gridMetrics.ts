/**
 * Базовые метрики сетки сцены: размер клетки, форма, перевод дистанций в пиксели.
 *
 * Самый нижний слой геометрии сетки — НИЧЕГО не импортирует, кроме типов.
 * На него опираются `hexGrid.ts` (чистая гекс-математика), `grid.ts` (привязка и
 * отпечатки токенов) и `getTokenDistance.ts` (дистанции), поэтому держать его
 * без зависимостей обязательно: иначе получается цикл импортов.
 */

import type { DiagonalRule, GridSettings, GridShape } from '../types/index.js';

/** Размер клетки по умолчанию (в пикселях) */
export const DEFAULT_CELL_SIZE = 50;

/** Масштаб клетки по умолчанию (единиц на клетку) */
export const DEFAULT_GRID_SCALE = 5;

/** Правило расчёта диагоналей по умолчанию (D&D 5e) */
export const DEFAULT_DIAGONAL_RULE: DiagonalRule = 'chebyshev';

/**
 * Форма сетки по умолчанию.
 *
 * Сцены, созданные до появления гексов, поля `shape` не имеют — и обязаны
 * открываться квадратными.
 */
export const DEFAULT_GRID_SHAPE: GridShape = 'square';

/** √3 — отношение шага гекса к радиусу его описанной окружности */
export const SQRT3 = Math.sqrt(3);

/**
 * Извлекает размер клетки из настроек сетки.
 *
 * На гексовой сетке это расстояние между центрами СОСЕДНИХ гексов (оно же
 * ширина «плоскость-плоскость»), а не сторона и не радиус: только при таком
 * определении один шаг по сетке стоит ровно `scale` единиц на любой форме.
 *
 * @param gridSettings - настройки сетки сцены
 * @returns размер клетки в пикселях
 */
export function resolveGridCellSize(gridSettings: GridSettings): number {
  return gridSettings.type === 'fixed'
    ? DEFAULT_CELL_SIZE
    : gridSettings.cellSize;
}

/**
 * Сколько пикселей сцены приходится на одну единицу дистанции (обычно фут).
 *
 * ЕДИНСТВЕННОЕ место перевода дистанций сцены в пиксели: радиусы зрения,
 * тёмного зрения и света обязаны считаться одинаково, иначе подсистемы
 * расходятся. Так и было: туман делил размер клетки на `scale` сцены,
 * а проверка видимости объектов держала жёсткую пятёрку футов на клетку —
 * на сцене с другим масштабом радиус тумана и радиус видимости не совпадали.
 *
 * Формула одна на все формы сетки: шаг между соседними клетками (и квадратными,
 * и гексовыми) равен `cellSize` пикселей и стоит `scale` единиц.
 *
 * @param gridSettings - настройки сетки сцены
 * @returns пикселей на единицу дистанции (0 при вырожденном масштабе)
 */
export function resolveGridPixelsPerUnit(gridSettings: GridSettings): number {
  const scale = gridSettings.scale ?? DEFAULT_GRID_SCALE;

  return scale > 0 ? resolveGridCellSize(gridSettings) / scale : 0;
}

/**
 * Форма клетки сцены.
 *
 * @param gridSettings - настройки сетки сцены
 * @returns форма сетки; для сцен без поля `shape` — квадратная
 */
export function resolveGridShape(gridSettings: GridSettings): GridShape {
  return gridSettings.shape ?? DEFAULT_GRID_SHAPE;
}

/**
 * Гексовая ли сетка у сцены.
 *
 * @param gridSettings - настройки сетки сцены
 * @returns true для любой из гексовых форм
 */
export function isHexGrid(gridSettings: GridSettings): boolean {
  return resolveGridShape(gridSettings) !== 'square';
}

/** Ориентация гекса: остриём вверх или плоской стороной вверх */
export type HexOrientation = 'pointy' | 'flat';

/** Разложенная геометрия гексовой сетки — вход для всей гекс-математики */
export interface HexMetrics {
  /** Ориентация гекса */
  orientation: HexOrientation;
  /** Расстояние между центрами соседних гексов, px */
  cellSize: number;
  /** Радиус описанной окружности (центр → вершина), px */
  circumradius: number;
  /** Смещение сетки по горизонтали, px */
  offsetX: number;
  /** Смещение сетки по вертикали, px */
  offsetY: number;
}

/**
 * Раскладывает настройки сетки в геометрию гексов.
 *
 * Вызывать только для гексовой сцены (`isHexGrid`); для квадратной вернёт
 * метрики pointy-top, которые ни к чему не применимы.
 *
 * @param gridSettings - настройки сетки сцены
 * @returns метрики гексовой сетки
 */
export function resolveHexMetrics(gridSettings: GridSettings): HexMetrics {
  const cellSize = resolveGridCellSize(gridSettings);

  return {
    orientation:
      resolveGridShape(gridSettings) === 'hexFlat' ? 'flat' : 'pointy',
    cellSize,
    circumradius: cellSize / SQRT3,
    offsetX: gridSettings.offsetX ?? 0,
    offsetY: gridSettings.offsetY ?? 0,
  };
}
