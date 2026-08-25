import type { GridSettings } from '../types/index.js';

import {
  computeSquareDistanceInCells,
  getTokenFootprintCells,
} from './grid.js';
import {
  DEFAULT_DIAGONAL_RULE,
  DEFAULT_GRID_SCALE,
  isHexGrid,
  resolveGridCellSize,
  resolveHexMetrics,
} from './gridMetrics.js';
import { hexDistance, pointDistanceInHexes } from './hexGrid.js';

/**
 * Вычисляет расстояние между двумя точками на сцене в единицах сетки.
 *
 * Универсальная pure-функция, не зависит от системы правил.
 * Результат в тех же единицах, что задан в gridSettings (футы, метры и т.д.).
 *
 * На квадратной сетке поддерживает три режима расчёта диагонали
 * (`diagonalRule`):
 * - `chebyshev` (по умолчанию в D&D 5e): диагональ = 1 клетка
 * - `alternating` (D&D 3.5e/PF): 5-10-5-10 за каждую диагональную клетку
 * - `euclidean`: реальное геометрическое расстояние
 *
 * На гексовой сетке диагоналей нет: все шесть соседей равноудалены, и правило
 * диагонали не применяется.
 *
 * @param pointA - координаты первой точки (в пикселях сцены)
 * @param pointA.x - координата X первой точки
 * @param pointA.y - координата Y первой точки
 * @param pointB - координаты второй точки (в пикселях сцены)
 * @param pointB.x - координата X второй точки
 * @param pointB.y - координата Y второй точки
 * @param gridSettings - настройки сетки сцены
 * @returns расстояние в единицах сетки (например, в футах)
 */
export function getTokenDistance(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  gridSettings: GridSettings,
): number {
  const scale = gridSettings.scale ?? DEFAULT_GRID_SCALE;

  if (isHexGrid(gridSettings)) {
    return (
      pointDistanceInHexes(resolveHexMetrics(gridSettings), pointA, pointB)
      * scale
    );
  }

  const cellSize = resolveGridCellSize(gridSettings);
  const rule = gridSettings.diagonalRule ?? DEFAULT_DIAGONAL_RULE;

  const cellsX = Math.abs(pointB.x - pointA.x) / cellSize;
  const cellsY = Math.abs(pointB.y - pointA.y) / cellSize;

  return computeSquareDistanceInCells(cellsX, cellsY, rule) * scale;
}

/** Носитель настроек токена — сущность сцены (актёр или существо) */
interface TokenScaleSource {
  token?: { scale?: number };
}

/**
 * Определяет фактический масштаб токена на сцене.
 *
 * Приоритет: настройки сущности (`entity.token.scale`) → масштаб самого токена
 * сцены → 1. Значение в токене — лишь кэш: сервер обновляет его при правке
 * сущности, но до этого момента (и для сущностей без синхронизации) актуален
 * именно масштаб сущности.
 *
 * ЕДИНСТВЕННОЕ место, где это правило записано: клиент и сервер обязаны считать
 * габарит токена одинаково, иначе коллизии и телепорт разъезжаются между ними.
 *
 * @param token - токен сцены (может отсутствовать)
 * @param entity - сущность токена: актёр или существо (может отсутствовать)
 * @returns масштаб токена (1 = Medium, 2 = Large, 3 = Huge и т.д.)
 */
export function resolveTokenScale(
  token: { scale?: number } | null | undefined,
  entity: TokenScaleSource | null | undefined,
): number {
  return entity?.token?.scale ?? token?.scale ?? 1;
}

/** Токен с координатами и размером для расчёта досягаемости */
export interface TokenBounds {
  /** Координата X верхнего левого угла (в пикселях) */
  x: number;
  /** Координата Y верхнего левого угла (в пикселях) */
  y: number;
  /** Масштаб токена (1 = 1×1 клетка, 2 = Large (2×2), 3 = Huge (3×3) и т.д.) */
  scale: number;
}

/**
 * Вычисляет расстояние между ближайшими краями двух токенов в единицах сетки.
 *
 * В D&D расстояние между существами измеряется от ближайшего края одного
 * существа до ближайшего края другого. Для больших (Large) и более крупных
 * существ это критически важно: досягаемость атаки отмеряется от края
 * занимаемой области, а не от одной точки.
 *
 * На квадратной сетке считается зазор между прямоугольниками по каждой оси
 * с применением правила диагонали. На гексовой — минимальное число шагов между
 * занятыми гексами двух отпечатков: у гексов нет осей, вдоль которых можно
 * мерить зазор по отдельности.
 *
 * @param tokenA - первый токен (с координатами и масштабом)
 * @param tokenB - второй токен (с координатами и масштабом)
 * @param gridSettings - настройки сетки сцены
 * @returns расстояние в единицах сетки (например, в футах); 0 если токены перекрываются
 */
export function getTokenEdgeDistance(
  tokenA: TokenBounds,
  tokenB: TokenBounds,
  gridSettings: GridSettings,
): number {
  const scale = gridSettings.scale ?? DEFAULT_GRID_SCALE;

  if (isHexGrid(gridSettings)) {
    const cellsA = getTokenFootprintCells(
      gridSettings,
      tokenA.x,
      tokenA.y,
      tokenA.scale,
    );

    const cellsB = getTokenFootprintCells(
      gridSettings,
      tokenB.x,
      tokenB.y,
      tokenB.scale,
    );

    let nearest = Number.POSITIVE_INFINITY;

    for (const cellA of cellsA) {
      for (const cellB of cellsB) {
        const steps = hexDistance(
          { q: cellA.col, r: cellA.row },
          { q: cellB.col, r: cellB.row },
        );

        if (steps < nearest) {
          nearest = steps;
        }
      }
    }

    return Number.isFinite(nearest) ? nearest * scale : 0;
  }

  const cellSize = resolveGridCellSize(gridSettings);
  const rule = gridSettings.diagonalRule ?? DEFAULT_DIAGONAL_RULE;

  // Определяем количество клеток, которые занимают токены
  // Используем Math.round для scale, так как токен D&D занимает целое число клеток
  const sizeA = Math.max(1, Math.round(tokenA.scale));
  const sizeB = Math.max(1, Math.round(tokenB.scale));

  const gridOffsetX = gridSettings.offsetX ?? 0;
  const gridOffsetY = gridSettings.offsetY ?? 0;

  // Определяем индексы ячеек, которые занимают токены
  // Вычитаем смещение сетки и используем Math.round для надежного определения клетки,
  // даже если координаты имеют небольшую погрешность или токен отцентрирован (scale < 1)
  const startColA = Math.round((tokenA.x - gridOffsetX) / cellSize);
  const startRowA = Math.round((tokenA.y - gridOffsetY) / cellSize);
  const endColA = startColA + sizeA - 1;
  const endRowA = startRowA + sizeA - 1;

  const startColB = Math.round((tokenB.x - gridOffsetX) / cellSize);
  const startRowB = Math.round((tokenB.y - gridOffsetY) / cellSize);
  const endColB = startColB + sizeB - 1;
  const endRowB = startRowB + sizeB - 1;

  // Расстояние в ячейках по каждой оси
  // Если токены пересекаются по оси, разница будет 0
  const cellsX = Math.max(
    0,
    Math.max(startColA, startColB) - Math.min(endColA, endColB),
  );

  const cellsY = Math.max(
    0,
    Math.max(startRowA, startRowB) - Math.min(endRowA, endRowB),
  );

  return computeSquareDistanceInCells(cellsX, cellsY, rule) * scale;
}
