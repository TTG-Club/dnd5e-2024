/**
 * Чистая математика гексовой сетки.
 *
 * Модуль НЕ знает про `GridSettings` и работает только с {@link HexMetrics} —
 * так он остаётся нижним слоем без циклов импорта и легко покрывается тестами.
 *
 * Система координат — аксиальная (`q`, `r`). Внутри всё считается в геометрии
 * гекса ОСТРИЁМ ВВЕРХ (pointy), а плоская ориентация (flat) получается зеркалом
 * относительно диагонали `y = x`: у неё меняются местами и оси координат, и оси
 * аксиальной пары. Это позволяет держать ОДНУ реализацию каждой формулы вместо
 * двух почти одинаковых.
 *
 * Свойства, на которых держится вся остальная геометрия сцены:
 * - у любого гекса ШЕСТЬ равноудалённых соседей на расстоянии `cellSize`;
 * - расстояние в гексах — целое число шагов, правило диагоналей не применяется;
 * - вершина гекса — общая точка ровно ТРЁХ гексов; именно она служит точкой
 *   привязки для существ чётного габарита и точкой отсчёта областей эффекта.
 *
 * @module utils/hexGrid
 */

import type { HexMetrics } from './gridMetrics.js';

/** Точка в мировых координатах сцены */
export interface HexPoint {
  x: number;
  y: number;
}

/** Клетка гексовой сетки в аксиальных координатах */
export interface Axial {
  q: number;
  r: number;
}

/** Прямоугольник в мировых координатах сцены */
export interface HexRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Шесть направлений к соседям в аксиальных координатах */
const HEX_DIRECTIONS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/**
 * Ключ клетки для множеств и словарей.
 *
 * @param hex - клетка
 * @returns строковый ключ вида `q,r`
 */
export function hexKey(hex: Axial): string {
  return `${hex.q},${hex.r}`;
}

/**
 * Доля радиуса описанной окружности, на которую отстоят соседние РЯДЫ гексов.
 *
 * Поперёк рядов клетки стоят плотнее, чем вдоль ряда: там шаг равен полутора
 * радиусам, а не размеру клетки.
 */
const HEX_ROW_STEP_RATIO = 1.5;

/**
 * Шаг между рядами гексов (вдоль «острой» оси).
 *
 * ЕДИНСТВЕННОЕ место, где живёт это число: шаг ряда нужен и привязке, и
 * подгонке числа клеток, и редактору сетки — разойдясь, они дали бы три разные
 * сетки на одной сцене.
 *
 * @param metrics - метрики гексовой сетки
 * @returns расстояние между соседними рядами, px
 */
export function hexRowStep(metrics: HexMetrics): number {
  return metrics.circumradius * HEX_ROW_STEP_RATIO;
}

/**
 * Переводит мировую точку в локальные координаты pointy-геометрии.
 *
 * @param metrics - метрики гексовой сетки
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @returns точка в локальных координатах (смещение снято, оси при необходимости переставлены)
 */
function toLocal(metrics: HexMetrics, x: number, y: number): HexPoint {
  const localX = x - metrics.offsetX;
  const localY = y - metrics.offsetY;

  return metrics.orientation === 'flat'
    ? { x: localY, y: localX }
    : { x: localX, y: localY };
}

/**
 * Переводит локальную точку pointy-геометрии обратно в мировые координаты.
 *
 * @param metrics - метрики гексовой сетки
 * @param x - локальная координата X
 * @param y - локальная координата Y
 * @returns точка в мировых координатах сцены
 */
function toWorld(metrics: HexMetrics, x: number, y: number): HexPoint {
  const isFlat = metrics.orientation === 'flat';

  return {
    x: (isFlat ? y : x) + metrics.offsetX,
    y: (isFlat ? x : y) + metrics.offsetY,
  };
}

/**
 * Переставляет аксиальную пару под pointy-геометрию.
 *
 * Операция обратна сама себе, поэтому годится и для прямого, и для обратного
 * перевода.
 *
 * @param metrics - метрики гексовой сетки
 * @param hex - клетка
 * @returns клетка в аксиальных координатах pointy-геометрии
 */
function swapAxial(metrics: HexMetrics, hex: Axial): Axial {
  return metrics.orientation === 'flat' ? { q: hex.r, r: hex.q } : hex;
}

/**
 * Центр гекса в мировых координатах.
 *
 * @param metrics - метрики гексовой сетки
 * @param hex - клетка
 * @returns координаты центра гекса
 */
export function hexToPoint(metrics: HexMetrics, hex: Axial): HexPoint {
  const { q, r } = swapAxial(metrics, hex);

  return toWorld(
    metrics,
    metrics.cellSize * (q + r / 2),
    hexRowStep(metrics) * r,
  );
}

/**
 * Дробные аксиальные координаты мировой точки.
 *
 * Нужны там, где округление до клетки испортило бы результат: непрерывное
 * измерение дистанции линейкой и метки шаблонов.
 *
 * @param metrics - метрики гексовой сетки
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @returns дробная аксиальная пара
 */
export function pointToAxialFractional(
  metrics: HexMetrics,
  x: number,
  y: number,
): { q: number; r: number } {
  const local = toLocal(metrics, x, y);

  const r = local.y / hexRowStep(metrics);
  const q = local.x / metrics.cellSize - r / 2;

  return metrics.orientation === 'flat' ? { q: r, r: q } : { q, r };
}

/**
 * Округляет дробную аксиальную пару до ближайшего гекса.
 *
 * Округление идёт через кубические координаты: из трёх осей округляется каждая,
 * а самая «испорченная» пересчитывается из двух других — иначе сумма координат
 * перестаёт быть нулём и точка уезжает в соседний гекс.
 *
 * @param q - дробная координата q
 * @param r - дробная координата r
 * @returns целочисленные аксиальные координаты
 */
export function axialRound(q: number, r: number): Axial {
  const cubeX = q;
  const cubeZ = r;
  const cubeY = -cubeX - cubeZ;

  let roundedX = Math.round(cubeX);
  let roundedY = Math.round(cubeY);
  let roundedZ = Math.round(cubeZ);

  const diffX = Math.abs(roundedX - cubeX);
  const diffY = Math.abs(roundedY - cubeY);
  const diffZ = Math.abs(roundedZ - cubeZ);

  if (diffX > diffY && diffX > diffZ) {
    roundedX = -roundedY - roundedZ;
  } else if (diffY > diffZ) {
    roundedY = -roundedX - roundedZ;
  } else {
    roundedZ = -roundedX - roundedY;
  }

  return { q: roundedX, r: roundedZ };
}

/**
 * Гекс, внутри которого лежит мировая точка.
 *
 * @param metrics - метрики гексовой сетки
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @returns аксиальные координаты гекса
 */
export function pointToHex(metrics: HexMetrics, x: number, y: number): Axial {
  const fractional = pointToAxialFractional(metrics, x, y);

  return axialRound(fractional.q, fractional.r);
}

/**
 * Базисные векторы аксиальных осей в пикселях.
 *
 * Смещение центра на `dq` шагов по оси `q` и `dr` по оси `r` равно
 * `dq * basis.q + dr * basis.r` — линейно и БЕЗ смещения сетки. Это позволяет
 * строить маршруты и поиск пути в целочисленных координатах клеток, а в пиксели
 * переводить одним умножением, не привязываясь к тому, стоит ли токен в центре
 * гекса или в его вершине.
 *
 * @param metrics - метрики гексовой сетки
 * @returns пиксельные векторы осей q и r
 */
export function axialBasisVectors(metrics: HexMetrics): {
  q: HexPoint;
  r: HexPoint;
} {
  const step = hexRowStep(metrics);

  return metrics.orientation === 'flat'
    ? {
        q: { x: step, y: metrics.cellSize / 2 },
        r: { x: 0, y: metrics.cellSize },
      }
    : {
        q: { x: metrics.cellSize, y: 0 },
        r: { x: metrics.cellSize / 2, y: step },
      };
}

/**
 * Смещение между двумя точками, выраженное в целых шагах сетки.
 *
 * Обе точки обязаны стоять на одной решётке (оба центры гексов либо обе вершины
 * одной подрешётки) — тогда разность аксиальных координат целочисленная.
 *
 * @param metrics - метрики гексовой сетки
 * @param from - начальная точка
 * @param to - конечная точка
 * @returns целочисленное смещение в аксиальных координатах
 */
export function axialDelta(
  metrics: HexMetrics,
  from: HexPoint,
  to: HexPoint,
): Axial {
  const start = pointToAxialFractional(metrics, from.x, from.y);
  const end = pointToAxialFractional(metrics, to.x, to.y);

  return axialRound(end.q - start.q, end.r - start.r);
}

/**
 * Прямая линия из гексов между двумя клетками (включая обе).
 *
 * Линейная интерполяция в кубических координатах с микроскопическим сдвигом:
 * без него точки, ровно попадающие на границу двух гексов, округлялись бы
 * непредсказуемо и линия «дрожала» бы от кадра к кадру.
 *
 * @param from - начальная клетка
 * @param to - конечная клетка
 * @returns клетки вдоль прямой, шаг за шагом
 */
export function hexLine(from: Axial, to: Axial): Axial[] {
  const steps = hexDistance(from, to);

  if (steps === 0) {
    return [{ q: from.q, r: from.r }];
  }

  const nudge = 1e-6;
  const line: Axial[] = [];

  for (let step = 0; step <= steps; step++) {
    const ratio = step / steps;

    line.push(
      axialRound(
        from.q + nudge + (to.q - from.q + nudge * 2) * ratio,
        from.r + nudge + (to.r - from.r + nudge * 2) * ratio,
      ),
    );
  }

  return line;
}

/**
 * Расстояние между гексами в шагах.
 *
 * @param from - первая клетка
 * @param to - вторая клетка
 * @returns число шагов между клетками
 */
export function hexDistance(from: Axial, to: Axial): number {
  const deltaQ = from.q - to.q;
  const deltaR = from.r - to.r;

  return (Math.abs(deltaQ) + Math.abs(deltaQ + deltaR) + Math.abs(deltaR)) / 2;
}

/**
 * Непрерывное расстояние между двумя мировыми точками, выраженное в гексах.
 *
 * В центрах гексов совпадает с {@link hexDistance}, между ними растёт плавно —
 * поэтому годится и для линейки, и для меток шаблонов.
 *
 * @param metrics - метрики гексовой сетки
 * @param from - первая точка
 * @param to - вторая точка
 * @returns дробное число гексов
 */
export function pointDistanceInHexes(
  metrics: HexMetrics,
  from: HexPoint,
  to: HexPoint,
): number {
  const start = pointToAxialFractional(metrics, from.x, from.y);
  const end = pointToAxialFractional(metrics, to.x, to.y);

  const deltaQ = start.q - end.q;
  const deltaR = start.r - end.r;

  return (Math.abs(deltaQ) + Math.abs(deltaQ + deltaR) + Math.abs(deltaR)) / 2;
}

/**
 * Соседи клетки — все шесть.
 *
 * @param hex - клетка
 * @returns массив из шести соседних клеток
 */
export function hexNeighbors(hex: Axial): Axial[] {
  return HEX_DIRECTIONS.map((direction) => ({
    q: hex.q + direction.q,
    r: hex.r + direction.r,
  }));
}

/**
 * Все клетки в радиусе `radius` шагов от центральной (включая её саму).
 *
 * Даёт ряд 1, 7, 19, 37… — отпечаток существа НЕЧЁТНОГО габарита на гексах.
 *
 * @param center - центральная клетка
 * @param radius - радиус в шагах (0 — только сама клетка)
 * @returns массив клеток
 */
export function hexesWithin(center: Axial, radius: number): Axial[] {
  const result: Axial[] = [];

  for (let deltaQ = -radius; deltaQ <= radius; deltaQ++) {
    const minDeltaR = Math.max(-radius, -deltaQ - radius);
    const maxDeltaR = Math.min(radius, -deltaQ + radius);

    for (let deltaR = minDeltaR; deltaR <= maxDeltaR; deltaR++) {
      result.push({ q: center.q + deltaQ, r: center.r + deltaR });
    }
  }

  return result;
}

/**
 * Расширяет набор клеток на `steps` колец соседей.
 *
 * @param hexes - исходный набор клеток
 * @param steps - сколько раз добавить кольцо соседей
 * @returns новый набор клеток без дублей
 */
export function expandHexes(
  hexes: ReadonlyArray<Axial>,
  steps: number,
): Axial[] {
  let current = new Map<string, Axial>(hexes.map((hex) => [hexKey(hex), hex]));

  for (let step = 0; step < steps; step++) {
    const next = new Map(current);

    for (const hex of current.values()) {
      for (const neighbor of hexNeighbors(hex)) {
        next.set(hexKey(neighbor), neighbor);
      }
    }

    current = next;
  }

  return [...current.values()];
}

/**
 * Шесть вершин гекса в мировых координатах.
 *
 * @param metrics - метрики гексовой сетки
 * @param hex - клетка
 * @returns массив из шести точек
 */
export function hexCorners(metrics: HexMetrics, hex: Axial): HexPoint[] {
  const center = hexToPoint(metrics, hex);
  const radius = metrics.circumradius;
  const baseAngle = metrics.orientation === 'flat' ? 0 : Math.PI / 6;

  const corners: HexPoint[] = [];

  for (let index = 0; index < 6; index++) {
    const angle = baseAngle + (Math.PI / 3) * index;

    corners.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }

  return corners;
}

/**
 * Середины шести рёбер гекса.
 *
 * @param metrics - метрики гексовой сетки
 * @param hex - клетка
 * @returns массив из шести точек
 */
export function hexEdgeMidpoints(metrics: HexMetrics, hex: Axial): HexPoint[] {
  const corners = hexCorners(metrics, hex);

  return corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length];

    return { x: (corner.x + next.x) / 2, y: (corner.y + next.y) / 2 };
  });
}

/**
 * Все гексы, чьи центры попадают в прямоугольник, плюс запас в одну клетку.
 *
 * Запас нужен, чтобы гексы, вылезающие в область только краем, тоже попали в
 * выборку: иначе у границы видимой части сцены появлялась бы полоса
 * недорисованной сетки.
 *
 * @param metrics - метрики гексовой сетки
 * @param rect - прямоугольник в мировых координатах
 * @returns массив клеток
 */
export function hexesInRect(metrics: HexMetrics, rect: HexRect): Axial[] {
  const corners: HexPoint[] = [
    toLocal(metrics, rect.x, rect.y),
    toLocal(metrics, rect.x + rect.width, rect.y),
    toLocal(metrics, rect.x, rect.y + rect.height),
    toLocal(metrics, rect.x + rect.width, rect.y + rect.height),
  ];

  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxY = Math.max(...corners.map((corner) => corner.y));

  const step = hexRowStep(metrics);
  const minRow = Math.floor(minY / step) - 1;
  const maxRow = Math.ceil(maxY / step) + 1;

  const result: Axial[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    const minColumn = Math.floor(minX / metrics.cellSize - row / 2) - 1;
    const maxColumn = Math.ceil(maxX / metrics.cellSize - row / 2) + 1;

    for (let column = minColumn; column <= maxColumn; column++) {
      result.push(
        metrics.orientation === 'flat'
          ? { q: row, r: column }
          : { q: column, r: row },
      );
    }
  }

  return result;
}

/**
 * Гекс под точкой и все его соседи — рабочая окрестность для поиска ближайших
 * вершин и середин рёбер.
 *
 * @param metrics - метрики гексовой сетки
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @returns семь клеток: центральная и шесть соседних
 */
function hexNeighborhood(metrics: HexMetrics, x: number, y: number): Axial[] {
  const center = pointToHex(metrics, x, y);

  return [center, ...hexNeighbors(center)];
}

/**
 * Ближайшая к точке точка из набора.
 *
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @param candidates - точки-кандидаты (набор не должен быть пустым)
 * @returns ближайшая точка
 */
export function nearestPoint(
  x: number,
  y: number,
  candidates: ReadonlyArray<HexPoint>,
): HexPoint {
  let best = candidates[0];
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const deltaX = candidate.x - x;
    const deltaY = candidate.y - y;
    const distanceSq = deltaX * deltaX + deltaY * deltaY;

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = candidate;
    }
  }

  return best;
}

/**
 * Ближайшая к точке вершина гексовой сетки.
 *
 * Кандидаты собираются по гексу под точкой и его соседям: перебрать четыре
 * десятка вершин дешевле, чем доказывать, что хватит шести своих, и надёжнее
 * у самой границы клетки.
 *
 * @param metrics - метрики гексовой сетки
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @returns координаты вершины
 */
export function nearestHexVertex(
  metrics: HexMetrics,
  x: number,
  y: number,
): HexPoint {
  const candidates = hexNeighborhood(metrics, x, y).flatMap((hex) =>
    hexCorners(metrics, hex),
  );

  return nearestPoint(x, y, candidates);
}

/**
 * Ближайшая к точке середина ребра гексовой сетки.
 *
 * @param metrics - метрики гексовой сетки
 * @param x - мировая координата X
 * @param y - мировая координата Y
 * @returns координаты середины ребра
 */
export function nearestHexEdgeMidpoint(
  metrics: HexMetrics,
  x: number,
  y: number,
): HexPoint {
  const candidates = hexNeighborhood(metrics, x, y).flatMap((hex) =>
    hexEdgeMidpoints(metrics, hex),
  );

  return nearestPoint(x, y, candidates);
}

/**
 * Три гекса, сходящиеся в заданной вершине.
 *
 * Это основа отпечатка существа ЧЁТНОГО габарита: Large стоит не в клетке, а на
 * стыке трёх клеток.
 *
 * @param metrics - метрики гексовой сетки
 * @param vertex - точка вершины (достаточно приблизительной)
 * @returns три ближайшие к вершине клетки
 */
export function hexesTouchingVertex(
  metrics: HexMetrics,
  vertex: HexPoint,
): Axial[] {
  const withDistance = hexNeighborhood(metrics, vertex.x, vertex.y).map(
    (hex) => {
      const center = hexToPoint(metrics, hex);
      const deltaX = center.x - vertex.x;
      const deltaY = center.y - vertex.y;

      return { hex, distanceSq: deltaX * deltaX + deltaY * deltaY };
    },
  );

  withDistance.sort((left, right) => left.distanceSq - right.distanceSq);

  return withDistance.slice(0, 3).map((entry) => entry.hex);
}
